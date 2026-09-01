#include "Apps.h"

// ------------------------------------------------------------------
// Calculadora
// ------------------------------------------------------------------
static void calcPress(Window *w, const char *key) {
  String k = key;
  String disp = w->data["display"] | "0";
  String acc = w->data["acc"] | "0";
  String op = w->data["op"] | "";
  bool clearNext = w->data["clearNext"] | false;

  if (k == "C") {
    w->data["display"] = "0";
    w->data["acc"] = "0";
    w->data["op"] = "";
    w->data["clearNext"] = false;
    return;
  }
  if (k >= "0" && k <= "9") {
    if (clearNext) { disp = ""; w->data["clearNext"] = false; }
    if (disp == "0") disp = "";
    if (disp.length() < 12) disp += k;
    w->data["display"] = disp;
    return;
  }
  if (k == ".") {
    if (clearNext) { disp = "0"; w->data["clearNext"] = false; }
    if (disp.indexOf('.') < 0) disp += ".";
    w->data["display"] = disp;
    return;
  }
  if (k == "+" || k == "-" || k == "*" || k == "/") {
    double cur = disp.toDouble();
    if (op.length() > 0 && !clearNext) {
      double a = acc.toDouble();
      double r = 0;
      if (op == "+") r = a + cur;
      else if (op == "-") r = a - cur;
      else if (op == "*") r = a * cur;
      else if (op == "/") r = (cur != 0) ? a / cur : 0;
      w->data["acc"] = String(r, 6);
    } else {
      w->data["acc"] = disp;
    }
    w->data["op"] = k;
    w->data["clearNext"] = true;
    w->data["display"] = String(w->data["acc"].as<double>() == 0 ? 0 : w->data["acc"].as<double>(), 6);
    return;
  }
  if (k == "=") {
    double cur = disp.toDouble();
    double a = acc.toDouble();
    double r = cur;
    if (op == "+") r = a + cur;
    else if (op == "-") r = a - cur;
    else if (op == "*") r = a * cur;
    else if (op == "/") r = (cur != 0) ? a / cur : 0;
    w->data["display"] = String(r, 6);
    w->data["acc"] = "0";
    w->data["op"] = "";
    w->data["clearNext"] = true;
    return;
  }
}

// ------------------------------------------------------------------
// Terminal (input de comandos)
// ------------------------------------------------------------------
static void terminalRun(Window *w, const String &line, JsonDocument &termOut) {
  String cmd = line;
  cmd.trim();
  String output;
  String out = w->data["output"] | "";
  out += "espax> " + cmd + "\n";

  if (cmd.length() == 0) {
    // only prompt
  } else if (cmd == "help") {
    out += "Comandos: help, clear, status, calc <expr>, echo <txt>, reboot, ip\n";
  } else if (cmd == "clear") {
    out = "ESPax Terminal v1.0\nDigite 'help' para ajuda.\n\n";
    w->data["output"] = out;
    return;
  } else if (cmd == "status") {
    out += "Nome: " + String(termOut["name"] | "") + "\n";
    out += "Hostname: " + String(termOut["hostname"] | "") + "\n";
    out += "IP: " + String(termOut["ip"] | "") + "\n";
    out += "Heap: " + String((long)termOut["heap"]) + " bytes\n";
    out += "Uptime: " + String((long)termOut["uptime"]) + "s\n";
  } else if (cmd == "ip") {
    out += String(termOut["ip"] | "") + "\n";
  } else if (cmd == "reboot") {
    out += "Reiniciando...\n";
    w->data["output"] = out;
    // sinalizar reboot para o caller pela saida
    termOut["doReboot"] = true;
    return;
  } else if (cmd.startsWith("echo ")) {
    out += cmd.substring(5) + "\n";
  } else if (cmd.startsWith("calc ")) {
    // avaliacao simples de expressao (op a b)
    String expr = cmd.substring(5);
    int i1 = expr.indexOf(' ');
    if (i1 > 0) {
      String a = expr.substring(0, i1);
      String rest = expr.substring(i1 + 1);
      int i2 = rest.indexOf(' ');
      if (i2 > 0) {
        String op = rest.substring(0, i2);
        String b = rest.substring(i2 + 1);
        a.trim(); op.trim(); b.trim();
        double av = a.toDouble(), bv = b.toDouble();
        String r;
        if (op == "+") r = String(av + bv, 4);
        else if (op == "-") r = String(av - bv, 4);
        else if (op == "*") r = String(av * bv, 4);
        else if (op == "/") r = (bv != 0) ? String(av / bv, 4) : "Erro: div por 0";
        else r = "Erro: operador '" + op + "'";
        out += r + "\n";
      } else {
        out += "Uso: calc <a> <op> <b>\n";
      }
    } else {
      out += "Uso: calc <a> <op> <b>\n";
    }
  } else if (cmd == "reset wifi") {
    out += "Resetando WiFi...\n";
    termOut["doResetWifi"] = true;
  } else if (cmd == "logo") {
    out += "  _____ _____ _____ _    _ \n";
    out += " | ____| ____| ____| |  | |\n";
    out += " |  _| |  _| |  _| | |__| |\n";
    out += " | |___| |___| |___|  __  |\n";
    out += " |_____|_____|_____|_|  |_|\n";
  } else {
    out += "Comando desconhecido: " + cmd + ". Digite 'help'.\n";
  }

  // limitar buffer do terminal
  if (out.length() > 2000) out = out.substring(out.length() - 2000);
  w->data["output"] = out;
}

// ------------------------------------------------------------------
// Dispatcher principal de apps
// ------------------------------------------------------------------
void handleAppAction(Window *w, JsonVariantConst action, JsonDocument &ctx) {
  if (!w) return;
  String app = w->app;
  String act = action["action"] | "";

  if (app == "calc") {
    String key = action["key"] | "";
    calcPress(w, key.c_str());
  } else if (app == "notepad") {
    // o conteudo completo e enviado em cada tecla/input
    String text = action["text"] | "";
    w->data["text"] = text;
  } else if (app == "terminal") {
    String line = action["cmd"] | "";
    terminalRun(w, line, ctx);
  }
  // files, settings, about, info - sao apenas exibicao sem estado mutavel
}
