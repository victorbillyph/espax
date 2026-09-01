#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <LittleFS.h>
#include <SPIFFS.h>
#include "FS.h"

#define DEFAULT_PASSWORD "admin"
#define DEFAULT_HOSTNAME "espax"
#define DEFAULT_USERNAME "admin"
#define DEFAULT_WIFI_SSID ""
#define DEFAULT_WIFI_PASS ""

#define AUTH_TIMEOUT_MS 1000 * 60 * 30

Preferences prefs;
WebServer server(80);

static char hostname[64] = DEFAULT_HOSTNAME;
static char wifi_ssid[64] = DEFAULT_WIFI_SSID;
static char wifi_pass[64] = DEFAULT_WIFI_PASS;
static char sys_name[64] = "ESPax";
static char login_user[32] = DEFAULT_USERNAME;
static char login_pass[64] = DEFAULT_PASSWORD;

static const char *TAG = "ESPax";

// ---------- Buffer helpers ----------
static String html_index;

static String loadFile(const char *path) {
  File f = LittleFS.open(path, "r");
  if (!f) return String();
  String s = f.readString();
  f.close();
  return s;
}

// ---------- Serial config ----------
static void printWelcome();
static void processSerialLine(const String &line);

static String serial_input;
static bool configMode = false;

static void handleSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n') {
      processSerialLine(serial_input);
      serial_input = "";
    } else if (c != '\r') {
      serial_input += c;
    }
  }
}

static void processSerialLine(const String &lineIn) {
  String line = lineIn;
  line.trim();
  if (line.length() == 0) return;

  String lower = line;
  lower.toLowerCase();

  if (lower == "help") {
    printWelcome();
    Serial.println();
    Serial.println(" ===== COMANDOS ===== ");
    Serial.println("  help                 - mostra esta ajuda");
    Serial.println("  status               - mostra status do sistema");
    Serial.println("  wifi set <ssid> <pass> - configura o WiFi");
    Serial.println("  wifi clear           - limpa a config de WiFi");
    Serial.println("  hostname set <nome>  - define o hostname");
    Serial.println("  name set <nome>      - define o nome do sistema");
    Serial.println("  login set <user> <pass> - define usuario/senha");
    Serial.println("  save                 - salva configuracoes na memoria");
    Serial.println("  reset wifi           - reseta e entra em modo AP");
    Serial.println("  reboot               - reinicia o ESP32");
    Serial.println("  clear                - limpa a tela");
    return;
  }

  if (lower == "status") {
    Serial.println(" ===== STATUS ===== ");
    Serial.printf("  Nome do sistema: %s\n", sys_name);
    Serial.printf("  Hostname: %s\n", hostname);
    Serial.printf("  Usuario: %s\n", login_user);
    Serial.printf("  Senha: %s\n", (configMode ? login_pass : "****"));
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("  WiFi: Conectado a %s (IP: %s)\n", WiFi.SSID().c_str(), WiFi.localIP().toString().c_str());
    } else if (strlen(wifi_ssid) > 0) {
      Serial.printf("  WiFi: Configurado para %s, porém desconectado\n", wifi_ssid);
    } else {
      Serial.println("  WiFi: Modo AP (sem rede configurada)");
    }
    Serial.printf("  Tempo online: %lu segundos\n", millis() / 1000);
    Serial.printf("  Memory heap: %d bytes livres\n", ESP.getFreeHeap());
    Serial.println(" ==================== ");
    return;
  }

  // wifi set <ssid> <pass>
  if (lower.startsWith("wifi ")) {
    String rest = line.substring(5);
    rest.trim();
    if (rest == "clear") {
      wifi_ssid[0] = 0;
      wifi_pass[0] = 0;
      prefs.putString("wifi_ssid", "");
      prefs.putString("wifi_pass", "");
      Serial.println("WiFi config limpa. Reiniciando...");
      delay(500);
      ESP.restart();
      return;
    }
    if (lower.startsWith("wifi set ")) {
      String args = line.substring(9);
      int sp = args.indexOf(' ');
      if (sp > 0) {
        String ssid = args.substring(0, sp);
        String pass = args.substring(sp + 1);
        ssid.trim();
        pass.trim();
        ssid.toCharArray(wifi_ssid, 64);
        pass.toCharArray(wifi_pass, 64);
        Serial.printf("WiFi configurado: SSID='%s' PASS='%s'\n", wifi_ssid, wifi_pass);
        Serial.println("Digite 'save' para salvar e reconectar, ou 'reset wifi' para ir ao AP.");
      } else {
        Serial.println("Uso: wifi set <ssid> <senha>");
      }
      return;
    }
    Serial.println("Subcomandos: wifi set <ssid> <pass> | wifi clear");
    return;
  }

  // hostname set <nome>
  if (lower.startsWith("hostname ")) {
    String rest = line.substring(9);
    rest.trim();
    if (lower.startsWith("hostname set ")) {
      String name = line.substring(13);
      name.trim();
      if (name.length() > 0 && name.length() < 58) {
        name.toCharArray(hostname, 64);
        Serial.printf("Hostname configurado: %s (aplicado pos reboot)\n", hostname);
      } else {
        Serial.println("Hostname deve ter entre 1 e 57 caracteres.");
      }
    } else {
      Serial.println("Uso: hostname set <nome>");
    }
    return;
  }

  // name set <nome>
  if (lower.startsWith("name ")) {
    String rest = line.substring(5);
    rest.trim();
    if (lower.startsWith("name set ")) {
      String name = line.substring(9);
      name.trim();
      if (name.length() > 0 && name.length() < 58) {
        name.toCharArray(sys_name, 64);
        Serial.printf("Nome do sistema configurado: %s\n", sys_name);
      } else {
        Serial.println("Nome deve ter entre 1 e 57 caracteres.");
      }
    } else {
      Serial.println("Uso: name set <nome>");
    }
    return;
  }

  // login set <user> <pass>
  if (lower.startsWith("login ")) {
    String rest = line.substring(6);
    rest.trim();
    if (lower.startsWith("login set ")) {
      String args = line.substring(10);
      int sp = args.indexOf(' ');
      if (sp > 0) {
        String user = args.substring(0, sp);
        String pass = args.substring(sp + 1);
        user.trim();
        pass.trim();
        if (user.length() > 0 && user.length() < 30 && pass.length() > 0 && pass.length() < 62) {
          user.toCharArray(login_user, 32);
          pass.toCharArray(login_pass, 64);
          Serial.printf("Login configurado: user='%s'\n", login_user);
          Serial.println("Para ver a senha, use 'show pass'.");
        } else {
          Serial.println("Usuario max 29 chars, senha de 1 a 61 chars.");
        }
      } else {
        Serial.println("Uso: login set <usuario> <senha>");
      }
    } else {
      Serial.println("Subcomandos: login set <user> <pass> | show pass");
    }
    return;
  }

  // show pass
  if (lower == "show pass") {
    Serial.printf("Senha: %s\n", login_pass);
    return;
  }

  // save
  if (lower == "save") {
    prefs.putString("hostname", hostname);
    prefs.putString("sys_name", sys_name);
    prefs.putString("login_user", login_user);
    prefs.putString("login_pass", login_pass);
    prefs.putString("wifi_ssid", wifi_ssid);
    prefs.putString("wifi_pass", wifi_pass);
    Serial.println("Configuracoes salvas!");
    return;
  }

  // reset wifi
  if (lower == "reset wifi") {
    wifi_ssid[0] = 0;
    wifi_pass[0] = 0;
    prefs.putString("wifi_ssid", "");
    prefs.putString("wifi_pass", "");
    Serial.println("WiFi resetado. Iniciando modo AP...");
    // Vamos apenas reiniciar, o boot detecta wifi vazio e vai para AP
    delay(500);
    ESP.restart();
    return;
  }

  // reboot
  if (lower == "reboot") {
    Serial.println("Reiniciando...");
    delay(300);
    ESP.restart();
    return;
  }

  if (lower == "clear") {
    for (int i = 0; i < 40; i++) Serial.println();
    printWelcome();
    return;
  }

  Serial.println("Comando desconhecido. Digite 'help' para ver os comandos.");
}

static void printWelcome() {
  Serial.println("\n==========================================");
  Serial.println("        ESPax - Web Desktop System v1.0");
  Serial.println("==========================================");
  Serial.println("Sistema operacional de desktop rodando no ESP32,");
  Serial.println("acessado via navegador web.");
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("  Acesse: http://%s  ou  http://%s\n", hostname, WiFi.localIP().toString().c_str());
  } else if (strlen(wifi_ssid) > 0) {
    Serial.printf("  WiFi configurado para '%s' mas nao conectado.\n", wifi_ssid);
    Serial.println("  Verifique a senha com 'status'.");
  } else {
    Serial.println("  Modo AP ativo. Conecte no WiFi 'ESPax-AP'.");
    Serial.println("  Acesse: 192.168.4.1");
  }
  Serial.println();
  Serial.println("Digite 'help' para ver os comandos de configuracao.");
  Serial.println("==========================================\n");
}

// ---------- Auth ----------
struct Session {
  uint32_t token;
  uint32_t expiry;
};
Session session;

static uint32_t randomToken() {
  return esp_random();
}

static bool checkAuth() {
  if (session.token == 0) return false;
  if (millis() > session.expiry) {
    session.token = 0;
    return false;
  }
  return true;
}

// ---------- API handlers ----------
static void apiLogin() {
  if (server.method() != HTTP_POST) {
    server.send(405, "text/plain", "Method Not Allowed");
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"ok\":false,\"msg\":\"Bad JSON\"}");
    return;
  }
  String u = doc["user"] | "";
  String p = doc["pass"] | "";
  if (u.equals(login_user) && p.equals(login_pass)) {
    session.token = randomToken();
    session.expiry = millis() + AUTH_TIMEOUT_MS;
    JsonDocument r;
    r["ok"] = true;
    r["token"] = session.token;
    r["name"] = sys_name;
    String out;
    serializeJson(r, out);
    server.send(200, "application/json", out);
  } else {
    server.send(401, "application/json", "{\"ok\":false,\"msg\":\"Credenciais invalidas\"}");
  }
}

static void apiStatus() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false,\"msg\":\"Not auth\"}");
    return;
  }
  JsonDocument r;
  r["ok"] = true;
  r["name"] = sys_name;
  r["hostname"] = hostname;
  r["heap"] = ESP.getFreeHeap();
  r["uptime"] = millis() / 1000;
  r["ip"] = WiFi.localIP().toString();
  r["ssid"] = (WiFi.status() == WL_CONNECTED) ? WiFi.SSID() : "";
  r["chip"]["cores"] = ESP.getChipCores();
  r["chip"]["frequency"] = ESP.getCpuFreqMHz();
  r["chip"]["flash_size"] = ESP.getFlashChipSize();
  r["chip"]["model"] = ESP.getChipModel();
  String out;
  serializeJson(r, out);
  server.send(200, "application/json", out);
}

static String serializeJsonSafe(const String &s) {
  JsonDocument d;
  d["c"] = s;
  String out;
  serializeJson(d, out);
  return out;
}

static void apiNotepad() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false}");
    return;
  }
  if (server.method() == HTTP_GET) {
    String content = loadFile("/notepad.txt");
    server.send(200, "application/json", "{\"ok\":true,\"content\":" + serializeJsonSafe(content) + "}");
  } else if (server.method() == HTTP_POST) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, server.arg("plain"));
    if (err) {
      server.send(400, "application/json", "{\"ok\":false}");
      return;
    }
    String content = doc["content"] | "";
    File f = LittleFS.open("/notepad.txt", "w");
    if (f) {
      f.print(content);
      f.close();
      server.send(200, "application/json", "{\"ok\":true}");
    } else {
      server.send(500, "application/json", "{\"ok\":false,\"msg\":\"FS error\"}");
    }
  } else {
    server.send(405, "application/json", "{\"ok\":false}");
  }
}

static void apiSend() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false}");
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"ok\":false}");
    return;
  }
  String cmd = doc["cmd"] | "";
  Serial.println(cmd);
  server.send(200, "application/json", "{\"ok\":true}");
}

static void apiFiles() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false}");
    return;
  }
  JsonDocument r;
  r["ok"] = true;
  JsonArray arr = r["files"].to<JsonArray>();
  File root = LittleFS.open("/");
  if (root && root.isDirectory()) {
    File f = root.openNextFile();
    while (f) {
      if (!f.isDirectory()) {
        JsonObject o = arr.add<JsonObject>();
        o["name"] = String("/") + f.name();
        o["size"] = f.size();
      }
      f = root.openNextFile();
    }
  }
  String out;
  serializeJson(r, out);
  server.send(200, "application/json", out);
}

static void apiSaveSettings() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false}");
    return;
  }
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, server.arg("plain"));
  if (err) {
    server.send(400, "application/json", "{\"ok\":false}");
    return;
  }
  String name = doc["name"] | "";
  String host = doc["hostname"] | "";
  String user = doc["user"] | "";
  String pass = doc["pass"] | "";
  String wssid = doc["wifi_ssid"] | "";
  String wpass = doc["wifi_pass"] | "";

  if (name.length()) name.toCharArray(sys_name, 64);
  if (host.length()) host.toCharArray(hostname, 64);
  if (user.length()) user.toCharArray(login_user, 32);
  if (pass.length()) pass.toCharArray(login_pass, 64);
  if (wssid.length()) wssid.toCharArray(wifi_ssid, 64);
  if (wpass.length()) wpass.toCharArray(wifi_pass, 64);

  prefs.putString("hostname", hostname);
  prefs.putString("sys_name", sys_name);
  prefs.putString("login_user", login_user);
  prefs.putString("login_pass", login_pass);
  prefs.putString("wifi_ssid", wifi_ssid);
  prefs.putString("wifi_pass", wifi_pass);

  server.send(200, "application/json", "{\"ok\":true,\"msg\":\"Settings saved (reboot to apply network)\"}");
}

static File pendingUpload;

static void apiReboot() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false}");
    return;
  }
  server.send(200, "application/json", "{\"ok\":true,\"msg\":\"Rebooting...\"}");
  delay(300);
  ESP.restart();
}

static void apiUpload() {
  if (!checkAuth()) {
    server.send(401, "application/json", "{\"ok\":false}");
    return;
  }
  HTTPUpload &up = server.upload();
  if (up.status == UPLOAD_FILE_START) {
    String filename = up.filename;
    if (filename.length() == 0) {
      filename = server.arg("name");
    }
    if (filename.length() == 0 || filename.startsWith("/")) {
      server.send(400, "application/json", "{\"ok\":false,\"msg\":\"invalid name\"}");
      return;
    }
    String path = String("/") + filename;
    up.filename = path;
    File f = LittleFS.open(path, "w");
    if (!f) {
      server.send(500, "application/json", "{\"ok\":false,\"msg\":\"fs error\"}");
      return;
    }
    pendingUpload = f;
  } else if (up.status == UPLOAD_FILE_WRITE) {
    if (pendingUpload) { pendingUpload.write(up.buf, up.currentSize); }
  } else if (up.status == UPLOAD_FILE_END) {
    if (pendingUpload) { pendingUpload.close(); pendingUpload = File(); }
    server.send(200, "application/json", "{\"ok\":true,\"msg\":\"uploaded\"}");
  } else if (up.status == UPLOAD_FILE_ABORTED) {
    if (pendingUpload) { pendingUpload.close(); pendingUpload = File(); }
    server.send(500, "application/json", "{\"ok\":false}");
  }
}

// ---------- WiFi connect ----------
static bool connectStation() {
  if (strlen(wifi_ssid) == 0) return false;
  WiFi.mode(WIFI_STA);
  WiFi.setHostname(hostname);
  WiFi.begin(wifi_ssid, wifi_pass);
  int tries = 0;
  while (WiFi.status() != WL_CONNECTED && tries < 60) {
    delay(500);
    tries++;
  }
  return WiFi.status() == WL_CONNECTED;
}

static void setupAP() {
  WiFi.mode(WIFI_AP);
  WiFi.softAP("ESPax-AP", "espax1234");
}

// ---------- Static serving ----------
static void serveRoot() {
  server.send(200, "text/html", html_index);
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Iniciando ESPax...");

  // Preferences
  prefs.begin("espax", false);
  String s_hostname = prefs.getString("hostname", DEFAULT_HOSTNAME);
  String s_sysname = prefs.getString("sys_name", "ESPax");
  String s_user = prefs.getString("login_user", DEFAULT_USERNAME);
  String s_pass = prefs.getString("login_pass", DEFAULT_PASSWORD);
  String s_wssid = prefs.getString("wifi_ssid", DEFAULT_WIFI_SSID);
  String s_wpass = prefs.getString("wifi_pass", DEFAULT_WIFI_PASS);

  s_hostname.toCharArray(hostname, 64);
  s_sysname.toCharArray(sys_name, 64);
  s_user.toCharArray(login_user, 32);
  s_pass.toCharArray(login_pass, 64);
  s_wssid.toCharArray(wifi_ssid, 64);
  s_wpass.toCharArray(wifi_pass, 64);

  // LittleFS
  if (!LittleFS.begin()) {
    Serial.println("LittleFS falhou ao montar. Formatando...");
    LittleFS.format();
    if (!LittleFS.begin()) {
      Serial.println("Falha definitiva ao montar LittleFS!");
    }
  }

  // WiFi
  if (!connectStation()) {
    if (strlen(wifi_ssid) > 0) {
      Serial.println("Nao foi possivel conectar ao WiFi configurado.");
    }
    setupAP();
    Serial.println("Iniciando modo Access Point: ESPax-AP / senha espax1234");
  }

  if (WiFi.status() == WL_CONNECTED) {
    MDNS.begin(hostname);
    MDNS.addService("http", "tcp", 80);
    Serial.printf("Conectado! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("Hostname: %s.local\n", hostname);
  }

  // Index
  html_index = loadFile("/index.html");

  // Routes
  server.on("/", serveRoot);
  server.on("/index.html", serveRoot);
  server.on("/style.css", []() {
    server.send(200, "text/css", loadFile("/style.css"));
  });
  server.on("/app.js", []() {
    server.send(200, "application/javascript", loadFile("/app.js"));
  });
  server.on("/api/login", HTTP_POST, apiLogin);
  server.on("/api/status", HTTP_GET, apiStatus);
  server.on("/api/notepad", HTTP_GET, apiNotepad);
  server.on("/api/notepad", HTTP_POST, apiNotepad);
  server.on("/api/send", HTTP_POST, apiSend);
  server.on("/api/files", HTTP_GET, apiFiles);
  server.on("/api/settings", HTTP_POST, apiSaveSettings);
  server.on("/api/reboot", HTTP_POST, apiReboot);
  server.on("/api/upload", HTTP_POST, apiUpload);
  server.onNotFound([]() {
    server.send(404, "text/plain", "Not found");
  });

  server.begin();
  Serial.println("Servidor HTTP iniciado!");

  printWelcome();
}

void loop() {
  server.handleClient();
  handleSerial();
  if (WiFi.status() == WL_CONNECTED) {
    delay(1);
  }
}
