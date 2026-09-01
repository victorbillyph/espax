#!/usr/bin/env python3
"""ESPax serial helper (modo servidor).

Mantem a porta serial aberta durante toda a sessao, garantindo o firmware
em estado RUN (caso contrario o CH340/ESP32 desliga ao reabrir a porta).

Uso (uma sessao):
    espax-serial.py <porta> --serve
        abre a porta, faz um boot limpo do firmware, e entao processa
        comandos do stdin. Cada linha tem o formato "<timeout> <comando>".
        A resposta de cada comando e impressa na stdout seguida pela linha
        "__ESPEND__" que sinaliza fim.

Uso (comando unico, teste):
    espax-serial.py <porta> "<comando>" [timeout]
"""
import sys
import os
import subprocess
import glob
import time

try:
    import serial
except ImportError:
    print("[ERRO] pyserial nao instalado", file=sys.stderr)
    sys.exit(2)

END = "__ESPEND__"
BOOT_MARK = b"Servidor HTTP iniciado"


def find_esptool():
    """Procura esptool.py no PlatformIO packages."""
    patterns = [
        os.path.expanduser("~/.platformio/packages/tool-esptoolpy/esptool.py"),
    ]
    for pat in patterns:
        if os.path.exists(pat):
            return pat
    # busca generica (nao recursiva)
    base = os.path.expanduser("~/.platformio/packages")
    if os.path.isdir(base):
        for d in os.listdir(base):
            if d.startswith("tool-esptoolpy"):
                p = os.path.join(base, d, "esptool.py")
                if os.path.exists(p):
                    return p
    return None


def esptool_reset(port):
    """Reseta o ESP32 via esptool (hard reset confiavel p/ CH340)."""
    esptool = find_esptool()
    if not esptool:
        return False
    env = dict(os.environ)
    env["PYTHONPATH"] = os.path.dirname(os.path.dirname(esptool))
    try:
        subprocess.run(
            [sys.executable, esptool, "--port", port, "--after", "hard_reset", "read_mac"],
            env=env, capture_output=True, timeout=40,
        )
        return True
    except Exception:
        return False


def set_run(ser):
    """Forca estado RUN (DTR/RTS desligados)."""
    try:
        ser.setDTR(False)
        ser.setRTS(False)
    except Exception:
        pass


def reset_and_boot(ser, port):
    """Reset do ESP32 e aguarda o firmware subir."""
    esptool_reset(port)
    time.sleep(1.2)
    try:
        ser.setDTR(False)
        ser.setRTS(False)
    except Exception:
        pass
    # descarta residuo de boot
    t0 = time.time()
    while time.time() - t0 < 2:
        try:
            ser.read(4096)
        except Exception:
            break
    ser.reset_input_buffer()


def cmd_once(port, cmd, timeout):
    """Modo comando unico (para testes/deteccao)."""
    ser = serial.Serial(port, 115200, timeout=0.2)
    set_run(ser)
    ser.reset_input_buffer()
    ser.write(("\r\n%s\r\n" % cmd).encode())
    buf = b""
    t0 = time.time()
    while time.time() - t0 < timeout:
        try:
            d = ser.read(4096)
        except Exception:
            break
        if d:
            buf += d
    ser.close()
    sys.stdout.buffer.write(buf)
    sys.stdout.flush()


def serve(port):
    ser = serial.Serial(port, 115200, timeout=0.2)
    set_run(ser)
    reset_and_boot(ser, port)
    sys.stdout.write("__READY__\n")
    sys.stdout.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        parts = line.split(" ", 1)
        try:
            timeout = float(parts[0])
            cmd = parts[1] if len(parts) > 1 else ""
        except ValueError:
            timeout = 3.0
            cmd = line
        ser.reset_input_buffer()
        ser.write(("\r\n%s\r\n" % cmd).encode())
        buf = b""
        t0 = time.time()
        try:
            while time.time() - t0 < timeout:
                d = ser.read(4096)
                if d:
                    buf += d
                if buf and time.time() - t0 > timeout - 0.1:
                    break
        except Exception:
            pass
        sys.stdout.buffer.write(buf)
        sys.stdout.write(END + "\n")
        sys.stdout.flush()
    ser.close()


if __name__ == "__main__":
    args = sys.argv[1:]
    if len(args) >= 2 and args[1] == "--serve":
        serve(args[0])
    elif len(args) >= 2:
        t = float(args[2]) if len(args) > 2 else 3.0
        cmd_once(args[0], args[1], t)
    else:
        print("uso: espax-serial.py <porta> --serve | <porta> <comando> [timeout]", file=sys.stderr)
        sys.exit(2)
