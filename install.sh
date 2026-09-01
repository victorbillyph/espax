#!/usr/bin/env bash
# ==================================================
# ESPaxTool - instalador
# Baixa o ESPaxTool do GitHub e instala em ~/.local/bin
# Sem sudo. Uso:
#   curl -sSL https://raw.githubusercontent.com/victorbillyph/espax/main/install.sh | bash
# ==================================================
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/victorbillyph/espax/main"
BIN_DIR="${HOME}/.local/bin"
BIN="${BIN_DIR}/espax-tool"
HELPER="${BIN_DIR}/espax-serial.py"

C_GREEN='\e[32m'; C_CYAN='\e[36m'; C_YELLOW='\e[33m'; C_RED='\e[31m'; C_BOLD='\e[1m'; C_NC='\e[0m'
info() { echo -e "${C_CYAN}[*]${C_NC} $*"; }
ok()   { echo -e "${C_GREEN}[+]${C_NC} $*"; }
warn() { echo -e "${C_YELLOW}[!]${C_NC} $*"; }
fail() { echo -e "${C_RED}[-]${C_NC} $*"; }

echo ""
echo -e "${C_BOLD}==============================${C_NC}"
echo -e "${C_BOLD}  Instalador do ESPaxTool${C_NC}"
echo -e "${C_BOLD}==============================${C_NC}"
echo ""

command -v curl >/dev/null 2>&1 || { fail "curl nao encontrado. Instale o curl."; exit 1; }
command -v python3 >/dev/null 2>&1 || { fail "python3 nao encontrado."; exit 1; }

mkdir -p "$BIN_DIR"

info "Baixando ESPaxTool..."
curl -fsSL "$REPO_RAW/ESPaxTool" -o "$BIN" || { fail "falha ao baixar ESPaxTool"; exit 1; }
info "Baixando espax-serial.py..."
curl -fsSL "$REPO_RAW/espax-serial.py" -o "$HELPER" || { fail "falha ao baixar espax-serial.py"; exit 1; }

chmod +x "$BIN" "$HELPER"
ok "Arquivos instalados em $BIN_DIR"

# --- dependencias python ---
info "Instalando dependencias python (pyserial / platformio)..."
pip_error=0
python3 -m pip install --user --quiet --upgrade pyserial platformio 2>/dev/null \
  || python3 -m pip install --user --break-system-packages --quiet --upgrade pyserial platformio 2>/dev/null \
  || pip_error=1

if [ "$pip_error" -ne 0 ]; then
  warn "Nao consegui instalar pyserial/platformio automaticamente."
  warn "Rode manualmente: python3 -m pip install --user pyserial platformio"
  warn "  (se der erro de 'externally-managed', adicione --break-system-packages)"
fi

# checar pyserial essencial
if python3 -c "import serial" 2>/dev/null; then
  ok "pyserial OK"
else
  fail "pyserial NAO instalado. O ESPaxTool nao conseguira comunicar via serial."
fi

# --- PATH ---
path_ok=0
case ":$PATH:" in
  *":$BIN_DIR:"*) path_ok=1;;
esac
if [ "$path_ok" -ne 1 ]; then
  info "Adicionando $BIN_DIR ao PATH (via ~/.bashrc)..."
  {
    echo ""
    echo "# ESPaxTool"
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\""
  } >> "${HOME}/.bashrc"
  export PATH="$HOME/.local/bin:$PATH"
fi

# check platformio (opcional)
if command -v platformio >/dev/null 2>&1 || \
   [ -x "$BIN_DIR/.venv/bin/pio" ] || \
   python3 -c "import platformio" 2>/dev/null; then
  ok "platformio disponivel (para instalar firmware em ESP32 nao-ESPax)"
else
  warn "platformio nao detectado. A opcao de instalar firmware pode falhar."
fi

echo ""
ok "ESPaxTool instalado!"
echo ""
command -v espax-tool >/dev/null 2>&1 && ESP=espax-tool || ESP="$BIN"
echo -e "  Execute agora com:  ${C_BOLD}${ESP}${C_NC}"
echo -e "  (se o comando nao aparecer, rode:  source ~/.bashrc)"
echo ""
