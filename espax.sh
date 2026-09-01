#!/usr/bin/env bash
# ==================================================
# ESPax Tools - utilitario de instalacao/configuracao
# Procura um ESP32 pela porta serial USB, detecta se e um
# ESPax, instala, configura e gerencia o dispositivo.
# ==================================================
set -u

BAUD=115200
C_YELLOW='\e[33m'; C_CYAN='\e[36m'; C_GREEN='\e[32m'; C_RED='\e[31m'; C_BOLD='\e[1m'; C_NC='\e[0m'

info()  { echo -e "${C_CYAN}[*]${C_NC} $*"; }
ok()    { echo -e "${C_GREEN}[+]${C_NC} $*"; }
warn()  { echo -e "${C_YELLOW}[!]${C_NC} $*"; }
fail()  { echo -e "${C_RED}[-]${C_NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GH_REPO="victorbillyph/espax"
TMP_DIR=""

# --------------------------------------------------
# Detectar PlatformIO
# --------------------------------------------------
find_pio() {
  if command -v pio >/dev/null 2>&1; then
    echo "pio"; return 0
  fi
  if [ -x "$SCRIPT_DIR/.venv/bin/pio" ]; then
    echo "$SCRIPT_DIR/.venv/bin/pio"; return 0
  fi
  return 1
}

# --------------------------------------------------
# Serial: abrir/configurar porta
# --------------------------------------------------
select_port() {
  local candidates=()
  while IFS= read -r p; do candidates+=("$p"); done < <(ls /dev/ttyUSB* /dev/ttyACM* 2>/dev/null)

  if [ "${#candidates[@]}" -eq 0 ]; then
    fail "Nenhuma porta serial USB encontrada (/dev/ttyUSB* ou /dev/ttyACM*)."
    fail "Conecte o ESP32 por USB e tente novamente."
    return 1
  fi

  if [ "${#candidates[@]}" -eq 1 ]; then
    PORT="${candidates[0]}"
    info "Porta serial detectada: $PORT"
    return 0
  fi

  info "Varias portas seriais encontradas:"
  local i
  for i in "${!candidates[@]}"; do
    echo "  [$((i+1))] ${candidates[$i]}"
  done
  local choice
  read -rp "Escolha a porta [1-${#candidates[@]}]: " choice
  if ! [[ "$choice" =~ ^[0-9]+$ ]] || [ "$choice" -lt 1 ] || [ "$choice" -gt "${#candidates[@]}" ]; then
    fail "Escolha invalida."; return 1
  fi
  PORT="${candidates[$((choice-1))]}"
  return 0
}

# Acha um python com pyserial
find_python() {
  if [ -x "$SCRIPT_DIR/.venv/bin/python" ]; then
    if "$SCRIPT_DIR/.venv/bin/python" -c "import serial" 2>/dev/null; then
      echo "$SCRIPT_DIR/.venv/bin/python"; return 0
    fi
  fi
  if command -v python3 >/dev/null 2>&1 && python3 -c "import serial" 2>/dev/null; then
    echo "python3"; return 0
  fi
  return 1
}

SERIAL_HELPER="$SCRIPT_DIR/espax-serial.py"

# Sessao serial persistente (coproc)
SER_COPRUN=""
SER_IN=""   # fd para escrever comandos ao helper
SER_OUT=""  # fd para ler respostas do helper

serial_start() {
  local py
  py="$(find_python)" || { fail "pyserial nao encontrado (pip install pyserial)."; return 1; }
  coproc SER_COPRUN { "$py" "$SERIAL_HELPER" "$PORT" --serve; }
  SER_IN=${SER_COPRUN[1]}
  SER_OUT=${SER_COPRUN[0]}
  # aguarda o helper ficar pronto
  local t0=$(date +%s)
  while ! IFS= read -r -t 1 -u "$SER_OUT" _x; do
    :  # aguarda primeiro output (__READY__)
  done
  return 0
}

serial_stop() {
  if [ -n "$SER_IN" ]; then
    exec {SER_IN}>&-
    exec {SER_OUT}<&-
    wait "$SER_COPRUN" 2>/dev/null
  fi
}

serial_cmd() {
  local cmd="$1"; local timeout="${2:-3}"
  [ -z "$SER_IN" ] && { fail "sessao serial nao iniciada."; return 1; }
  printf '%s %s\n' "$timeout" "$cmd" >&"$SER_IN"
  local out=""
  local l
  while IFS= read -r -u "$SER_OUT" l; do
    if [ "$l" == "__ESPEND__" ]; then break; fi
    out+="$l"$'\n'
  done
  printf '%s' "$out"
  return 0
}

# --------------------------------------------------
# Detectar dispositivo: responde ping? e ESPax?
# --------------------------------------------------
probe_device() {
  local out
  out="$(serial_cmd "ping" 2 2>/dev/null)"
  if echo "$out" | grep -q "\[ESPax\] pong"; then
    echo "ESPax"
  elif [ -n "$out" ]; then
    # alguma resposta, mas nao eh ESPax
    echo "UNKNOWN"
  else
    # sem resposta -> pode ser um ESP32 em reset/bootloader ou nada
    echo "NONE"
  fi
}

get_cfg() {
  local out
  out="$(serial_cmd "info" 2 2>/dev/null)"
  echo "$out"
}

# --------------------------------------------------
# Instalar ESPax num ESP32 nao-ESPax
# --------------------------------------------------
install_espax() {
  local pio
  pio="$(find_pio)" || { fail "PlatformIO nao encontrado. Instale com: pip install platformio"; return 1; }

  info "Baixando ESPax do GitHub ($GH_REPO)..."
  TMP_DIR="$(mktemp -d)"
  if ! git clone --depth 1 "https://github.com/$GH_REPO.git" "$TMP_DIR" >/dev/null 2>&1; then
    fail "Falha ao clonar o repositorio. Verifique sua internet."
    return 1
  fi
  ok "Repositorio baixado."

  info "Compilando e gravando firmware em $PORT... (isso pode demorar na 1a vez)"
  if ! (cd "$TMP_DIR" && "$pio" run --target upload --upload-port "$PORT"); then
    fail "Falha ao gravar firmware."
    return 1
  fi
  ok "Firmware gravado."

  info "Gravando filesystem web (LittleFS)..."
  if ! (cd "$TMP_DIR" && "$pio" run --target uploadfs --upload-port "$PORT"); then
    fail "Falha ao gravar filesystem."
    return 1
  fi
  ok "Filesystem gravado."

  warn "A transferencia por bootloader pode reiniciar a porta. Aguarde o ESP32 reiniciar."
  sleep 4
  info "Dispositivo instalado como ESPax!"
  return 0
}

# --------------------------------------------------
# Setup wizard via serial
# --------------------------------------------------
setup_wizard() {
  info "Iniciando configuracao do ESPax..."
  ok "Para conectar via serial, o ESPax funciona em modo AP ou STA."

  # 1) WiFi
  info "Procurando redes WiFi disponiveis..."
  local out net
  out="$(serial_cmd "scan" 15 2>/dev/null)"
  echo ""
  if ! echo "$out" | grep -q "\[NET\]"; then
    warn "Nenhuma rede WiFi encontrada (ou scan falhou)."
  else
    echo -e "${C_BOLD}  Redes WiFi encontradas:${C_NC}"
    local idx=0 line
    while IFS= read -r line; do
      if [[ "$line" == \[NET\]* ]]; then
        idx=$((idx+1))
        local ssid
        ssid="$(echo "$line" | sed 's/^\[NET\] //' | cut -d'|' -f1)"
        echo "    [$idx] $ssid"
        declare -g "NET_${idx}=$ssid"
      fi
    done <<< "$out"
    local total=$idx
    echo -e "${C_BOLD}    [0] Escolher manualmente${C_NC}"
    read -rp "  Escolha a rede [0-$total]: " escolha
    if [ "$escolha" -gt 0 ] 2>/dev/null && [ "$escolha" -le "$total" ]; then
      local varname="NET_$escolha"
      SSID="${!varname}"
    else
      read -rp "  Digite o nome da rede (SSID): " SSID
    fi
  fi

  read -rp "  Senha da rede WiFi: " -s WIFI_PASS; echo ""
  info "Configurando WiFi..."
  serial_cmd "wifi set $SSID $WIFI_PASS" 2 >/dev/null

  # 2) Login
  local def_user="admin"
  read -rp "  Usuario de login [$def_user]: " USER_IN
  USER_IN="${USER_IN:-$def_user}"
  read -rp "  Senha de login: " -s PASS_IN; echo ""
  serial_cmd "login set $USER_IN $PASS_IN" 2 >/dev/null

  # 3) Nome e hostname
  local def_name="ESPax" def_host="espax"
  read -rp "  Nome do sistema [$def_name]: " NAME_IN
  NAME_IN="${NAME_IN:-$def_name}"
  read -rp "  Hostname [$def_host]: " HOST_IN
  HOST_IN="${HOST_IN:-$def_host}"
  serial_cmd "name set $NAME_IN" 2 >/dev/null
  serial_cmd "hostname set $HOST_IN" 2 >/dev/null

  # 4) Salvar
  info "Salvando configuracoes..."
  serial_cmd "save" 2 >/dev/null
  ok "Configuracao salva!"

  read -rp "Reiniciar o ESP32 agora para aplicar? [s/N]: " REBOOT
  if [[ "${REBOOT,,}" == "s" ]]; then
    info "Reiniciando..."
    serial_cmd "reboot" 2 >/dev/null
  fi
  ok "Setup concluido!"
}

# --------------------------------------------------
# Menu de ajustes (para ESPax ja configurado)
# --------------------------------------------------
adjust_menu() {
  local n
  while true; do
    echo ""
    echo -e "${C_BOLD}  Ajustes do ESPax${C_NC}"
    echo "    1) Reconfigurar (setup completo)"
    echo "    2) Alterar senha WiFi"
    echo "    3) Alterar usuario/senha de login"
    echo "    4) Alterar nome / hostname"
    echo "    5) Salvar e reiniciar"
    echo "    0) Voltar"
    read -rp "  Escolha: " n
    case "$n" in
      1) setup_wizard;;
      2)
        read -rp "    Nova SSID: " NS
        read -rp "    Nova senha WiFi: " -s NW; echo ""
        serial_cmd "wifi set $NS $NW" 2 >/dev/null;;
      3)
        read -rp "    Usuario: " NU
        read -rp "    Nova senha: " -s NP; echo ""
        serial_cmd "login set $NU $NP" 2 >/dev/null;;
      4)
        read -rp "    Nome do sistema: " NN
        read -rp "    Hostname: " NH
        serial_cmd "name set $NN" 2 >/dev/null
        serial_cmd "hostname set $NH" 2 >/dev/null;;
      5)
        serial_cmd "save" 2 >/dev/null
        serial_cmd "reboot" 2 >/dev/null
        ok "Salvo e reiniciando."; break;;
      0) break;;
      *) fail "Opcao invalida.";;
    esac
  done
}

# --------------------------------------------------
# Formatar (limpar config) e instalar de novo
# --------------------------------------------------
format_device() {
  warn "Isso vai limpar as configuracoes e regravar o ESPax por cima."
  read -rp "Tem certeza? [s/N]: " CONF
  if [[ "${CONF,,}" != "s" ]]; then ok "Cancelado."; return; fi
  install_espax
  if [ $? -eq 0 ]; then
    info "Agora vamos configurar do zero:"
    setup_wizard
  fi
}

# ==================================================
# MAIN
# ==================================================
main() {
  echo ""
  echo -e "${C_BOLD}========================================${C_NC}"
  echo -e "${C_BOLD}  ESPax Tools - instalador/configurador${C_NC}"
  echo -e "${C_BOLD}========================================${C_NC}"
  echo ""

  PORT="${1:-}"
  if [ -z "$PORT" ]; then
    select_port || return 1
  fi

  if [ ! -e "$PORT" ]; then
    fail "Porta $PORT nao existe. Conecte o ESP32."
    return 1
  fi

  echo -e "  Porta: ${C_CYAN}$PORT${C_NC}  (baud $BAUD)"
  info "Iniciando sessao serial e fazendo boot limpo do firmware..."
  if ! serial_start; then
    fail "Nao foi possivel iniciar a sessao serial ($PORT)."
    fail "Verifique o cabo USB e as permissoes (grupo dialout/uucp)."
    return 1
  fi
  ok "Sessao serial ativa."
  info "Testando conexao com o ESPax..."
  sleep 1

  local kind
  kind="$(probe_device)"
  case "$kind" in
    ESPax)
      ok "ESP32 detectado: ${C_BOLD}ESPax${C_NC}!"
      ;;
    UNKNOWN)
      warn "A porta respondeu, mas nao identificamos o ESPax."
      echo -e "  A porta pode estar mostrando o bootloader ou outro firmware."
      ;;
    *)
      warn "Nenhuma resposta do ESPax na porta."
      ;;
  esac

  if [ "$kind" != "ESPax" ]; then
    echo ""
    if [ "$kind" == "NONE" ]; then
      warn "Nao detectamos o ESPax."
    fi
    read -rp "Instalar o ESPax neste dispositivo? [s/N]: " INST
    if [[ "${INST,,}" != "s" ]]; then
      ok "Saindo. Nada foi instalado."
      return 0
    fi
    install_espax
    if [ $? -ne 0 ]; then return 1; fi
    # apos instalar, refazer probe
    kind="$(probe_device)"
    if [ "$kind" != "ESPax" ]; then
      warn "Nao conseguimos confirmar o ESPax apos a instalacao. Configure manualmente via serial."
      return 1
    fi
    ok "ESPax confirmado. Vamos configurar."
  fi

  # Verificar se ja configurado (wifi_ssid vazio = nao configurado)
  local cfg
  cfg="$(get_cfg)"
  local ssid_cfg
  ssid_cfg="$(echo "$cfg" | sed -n 's/^\[CFG\] //p' | head -1)"
  local name_cfg
  name_cfg="$(echo "$cfg" | sed -n 's/^\[NAME\] //p' | head -1)"

  echo ""
  if [ -n "$ssid_cfg" ]; then
    ok "ESPax ja configurado. (SSID: $ssid_cfg, Nome: ${name_cfg:-?})"
    echo -e "${C_BOLD}  1) Ajustes${C_NC}"
    echo -e "${C_BOLD}  2) Formatar dispositivo${C_NC}"
    read -rp "  Escolha [1-2]: " action
    case "$action" in
      2) format_device;;
      *) adjust_menu;;
    esac
  else
    info "ESPax ainda nao configurado. Iniciando setup."
    setup_wizard
  fi

  echo ""
  local access_host
  access_host="$(echo "$name_cfg" | tr -d '[:space:]')"
  access_host="${access_host:-espax}"
  ok "Concluido. Acesse o desktop em http://$access_host.local  (ou pelo IP em 'status')"
  return 0
}

# cleanup
cleanup() {
  [ -n "$TMP_DIR" ] && rm -rf "$TMP_DIR" 2>/dev/null
  serial_stop 2>/dev/null
}
trap cleanup EXIT

main "$@"
