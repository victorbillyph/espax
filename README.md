# ESPax — Web Desktop System para ESP32

Sistema operacional-desktop que roda no **ESP32**, acessado 100% via **navegador web**.
Não precisa de display físico: o desktop, as janelas e os aplicativos são servidos pelo ESP32
e renderizados no browser do cliente.

## 📦 Instalar a ferramenta (ESPaxTool)

O **ESPaxTool** é o utilitário que procura seu ESP32 pela porta USB, detecta se é um ESPax,
instala o firmware nele e faz toda a configuração (WiFi, login, etc.).

Instale em uma linha (sem sudo, vai para `~/.local/bin`):

```bash
curl -sSL https://raw.githubusercontent.com/victorbillyph/espax/main/install.sh | bash
```

Depois é só executar:

```bash
espax-tool            # procura a porta sozinho e guia a instalacao/configuracao
espax-tool /dev/ttyUSB0
```

> Pré-requisito: `curl` e `python3`. O instalador cuida das dependências
> (`pyserial`, `platformio`) e adiciona `~/.local/bin` ao PATH.

## Recursos

- **Desktop com desktop, ícones e taskbar** (estilo Windows)
- **Gerenciador de janelas** — abrir, mover, minimizar, maximizar, fechar, arrastar
- Aplicativos:
  - 🧮 **Calculadora**
  - 📝 **Bloco de Notas** (salva no LittleFS)
  - 🖥️ **Terminal** (envia comandos ao ESP32 via serial)
  - 🌐 **Browser** (abre URLs em iframe)
  - 📁 **Arquivos** (lista/upload no LittleFS)
  - ⚙️ **Configurações** (login, nome, hostname, WiFi)
  - ℹ️ **Sobre / status do sistema**

- **Tela de login** com usuário/senha (sessão com timeout)
- **Configuração via serial** (WiFi, hostname, nome, login)
- **Modo Access Point** automático quando não há WiFi configurado

## Estrutura

```
ESPax/
├── platformio.ini      # configuração PlatformIO (ESP32 + Arduino + ArduinoJson)
├── src/main.cpp        # firmware: WiFi, servidor web, serial config, APIs
├── ESPaxTool           # utilitário de instalação/configuração (script)
├── espax-serial.py     # helper pyserial do ESPaxTool
├── install.sh          # instalador via curl (baixa e instala o ESPaxTool)
└── data/               # arquivos web carregados no LittleFS
    ├── index.html
    ├── style.css
    └── app.js
```

## Como compilar e gravar

Requisito: [PlatformIO Core](https://platformio.org/install). (Na máquina deste projeto usei `.venv/bin/pio`.)

```bash
# 1. compilar o firmware
pio run

# 2. gravar firmware
pio run --target upload

# 3. gravar o filesystem web (littlefs)
pio run --target uploadfs

# 4. monitor serial
pio device monitor
```

O **uploadfs** é obrigatório — sem ele o desktop não carrega (a árvore web mora no LittleFS).

## ESPaxTool (utilitário de instalação/configuração)

O script `ESPaxTool` automatiza procura, instalação e configuração do ESP32 via porta serial USB.

```bash
./ESPaxTool               # procura a porta sozinho
./ESPaxTool /dev/ttyUSB0  # usa uma porta especifica
# (ou via instalador: espax-tool)
```

Ele detecta a porta serial (/dev/ttyUSB* /dev/ttyACM*), envia `ping` e:

- **É um ESPax** → informa se já está configurado;
  - já configurado → menu de **ajustes** ou **formatar**;
  - não configurado → **setup wizard** (lista redes WiFi via `scan`, pede senha,
    usuário/senha de login, nome, hostname, salva e reinicia).
- **Não é um ESPax** → pergunta se quer instalar;
  - se sim, baixa o ESPax do GitHub, grava firmware + LittleFS via PlatformIO;
  - se não, sai sem alterar nada.

A comunicação serial usa o helper `espax-serial.py` (baseado em `pyserial`), que
mantém a porta em estado RUN para não desligar o chip (comum no CH340).

Pré-requisitos: `git`, `python3` com **`pyserial`** e **`platformio`**, e permissão
na porta serial (usuário no grupo `dialout`/`uucp`). Usa o `.venv/bin/python` e o
`.venv/bin/pio` do próprio projeto se existirem.

```bash
# preparar ambiente (venv) e dependencias
python3 -m venv .venv
.venv/bin/pip install -U platformio pyserial
```

## Primeira vez (Access Point)

1. Grave firmware + filesystem.
2. O ESP32 inicia em **modo AP** quando não há WiFi configurado.
3. Conecte-se à rede WiFi **`ESPax-AP`** (senha `espax1234`).
4. Acesse **`http://192.168.4.1`** e faça login com **admin / admin**.

## Configuração via Serial

Conecte ao Monitor Serial (115200 baud) e digite os comandos:

```
help                          # mostra todos os comandos
status                        # mostra status do sistema
wifi set "sua-rede" "senha"   # configura o WiFi
hostname set espax            # define o hostname
name set "Meu ESP"            # define o nome do sistema
login set admin "minhasenha"  # define usuario/senha de login
save                          # salva tudo na memoria flash (Preferences)
reboot                        # reinicia (aplica hostname/WiFi)
```

Depois de configurar WiFi e reiniciar, acesse: `http://espax.local` (ou pelo IP exibido no `status`).

## Login padrão

- Usuário: `admin`
- Senha: `admin`

Altere via serial (`login set`) ou pelo app **Configurações** no desktop.
