#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <HTTPUpdate.h>
#include <ESPAsyncWebServer.h>
#include <AsyncJson.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <LittleFS.h>
#include "FS.h"
#include "Desktop.h"
#include "Apps.h"

#define DEFAULT_PASSWORD "admin"
#define DEFAULT_HOSTNAME "espax"
#define DEFAULT_USERNAME "admin"
#define DEFAULT_WIFI_SSID ""
#define DEFAULT_WIFI_PASS ""

#define ESPAX_VERSION "1.1.0"
#define ESPAX_GITHUB_REPO "victorbillyph/espax"

#define AUTH_TIMEOUT_MS 1000 * 60 * 30

Preferences prefs;
AsyncWebServer server(80);
AsyncWebSocket ws("/ws");

Desktop desktop;

static char hostname[64] = DEFAULT_HOSTNAME;
static char wifi_ssid[64] = DEFAULT_WIFI_SSID;
static char wifi_pass[64] = DEFAULT_WIFI_PASS;
static char sys_name[64] = "ESPax";
static char login_user[32] = DEFAULT_USERNAME;
static char login_pass[64] = DEFAULT_PASSWORD;

static String html_index;
static String html_style;
static String html_app;

// ---------- Buffer helpers ----------
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
    Serial.println("  scan                 - lista redes WiFi disponiveis");
    Serial.println("  ping / info          - protocolo interno do ESPax tools");
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

  if (lower == "ping") {
    Serial.println("[ESPax] pong");
    return;
  }

  if (lower == "info" || lower == "cfg") {
    Serial.printf("[CFG] %s\n", wifi_ssid);
    Serial.printf("[NAME] %s\n", sys_name);
    return;
  }

  if (lower == "scan") {
    Serial.println("[SCAN] iniciando");
    bool wasAp = (WiFi.getMode() & WIFI_AP) != 0;
    bool wasSta = (WiFi.getMode() & WIFI_STA) != 0;
    if (!wasSta) {
      if (wasAp) WiFi.mode(WIFI_AP_STA);
      else WiFi.mode(WIFI_STA);
      delay(200);
    }
    int n = WiFi.scanNetworks();
    for (int i = 0; i < n; i++) {
      Serial.printf("[NET] %s|%d|%d\n",
        WiFi.SSID(i).c_str(),
        WiFi.RSSI(i),
        (int)WiFi.encryptionType(i));
    }
    WiFi.scanDelete();
    if (wasAp && !wasSta) WiFi.mode(WIFI_AP);
    Serial.println("[SCAN] fim");
    return;
  }

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

  if (lower.startsWith("hostname ")) {
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

  if (lower.startsWith("name ")) {
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

  if (lower.startsWith("login ")) {
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

  if (lower == "show pass") {
    Serial.printf("Senha: %s\n", login_pass);
    return;
  }

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

  if (lower == "reset wifi") {
    wifi_ssid[0] = 0;
    wifi_pass[0] = 0;
    prefs.putString("wifi_ssid", "");
    prefs.putString("wifi_pass", "");
    Serial.println("WiFi resetado. Iniciando modo AP...");
    delay(500);
    ESP.restart();
    return;
  }

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
  Serial.println("        ESPax - Web Desktop System v1.1");
  Serial.println("==========================================");
  Serial.println("Sistema operacional de desktop rodando no ESP32,");
  Serial.println("acessado via navegador web.");
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("  Acesse: http://%s  ou  http://%s\n", hostname, WiFi.localIP().toString().c_str());
  } else if (strlen(wifi_ssid) > 0) {
    Serial.printf("  WiFi configurado para '%s' mas nao conectado.\n", wifi_ssid);
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

// ---------- Estado: serializacao completa ----------
static void fillState(JsonDocument &s) {
  s["type"] = "state";
  s["name"] = sys_name;
  s["hostname"] = hostname;
  s["version"] = ESPAX_VERSION;
  s["heap"] = (long)ESP.getFreeHeap();
  s["uptime"] = (unsigned long)(millis() / 1000);
  s["ip"] = WiFi.localIP().toString();
  s["ssid"] = (WiFi.status() == WL_CONNECTED) ? WiFi.SSID() : "";
  s["chip"]["cores"] = ESP.getChipCores();
  s["chip"]["frequency"] = ESP.getCpuFreqMHz();
  s["chip"]["flash_size"] = (unsigned long)ESP.getFlashChipSize();
  s["chip"]["model"] = ESP.getChipModel();

  JsonArray wins = s["windows"].to<JsonArray>();
  for (int i = 0; i < desktop.windowCount; i++) {
    Window *w = desktop.windows[i];
    if (!w) continue;
    JsonObject o = wins.add<JsonObject>();
    o["id"] = (unsigned long)w->id;
    o["app"] = w->app;
    o["title"] = w->title;
    o["x"] = w->x;
    o["y"] = w->y;
    o["w"] = w->w;
    o["h"] = w->h;
    o["z"] = (unsigned long)w->z;
    o["min"] = w->minimized;
    o["max"] = w->maximized;
    o["ram"] = desktop.estimateWindowRAM(w);
    if (w->app == "files") {
      JsonArray files = o["files"].to<JsonArray>();
      File root = LittleFS.open("/");
      if (root && root.isDirectory()) {
        File f = root.openNextFile();
        while (f) {
          if (!f.isDirectory()) {
            JsonObject fo = files.add<JsonObject>();
            fo["name"] = String("/") + f.name();
            fo["size"] = (unsigned long)f.size();
          }
          f = root.openNextFile();
        }
      }
    }
    o["data"] = w->data.as<JsonVariant>();
  }

  // repos e apps instalados
  JsonArray reposArr = s["repos"].to<JsonArray>();
  for (int i = 0; i < desktop.repoCount; i++) {
    JsonObject ro = reposArr.add<JsonObject>();
    ro["index"] = i;
    ro["url"] = desktop.repos[i].url;
    ro["nickname"] = desktop.repos[i].nickname;
  }
  JsonArray appsArr = s["installed"].to<JsonArray>();
  for (int i = 0; i < desktop.appCount; i++) {
    JsonObject ao = appsArr.add<JsonObject>();
    ao["id"] = desktop.installedApps[i].id;
    ao["name"] = desktop.installedApps[i].name;
    ao["desc"] = desktop.installedApps[i].desc;
    ao["icon"] = desktop.installedApps[i].icon;
    ao["author"] = desktop.installedApps[i].author;
    ao["version"] = desktop.installedApps[i].version;
    ao["template"] = desktop.installedApps[i].templateHtml;
    ao["css"] = desktop.installedApps[i].css;
  }
}

// ---------- Estado: broadcast para todos os clientes WS ----------
static void broadcastState() {
  JsonDocument s;
  fillState(s);
  String out;
  serializeJson(s, out);
  ws.textAll(out);
}

// ---------- Processamento de eventos vindos do browser ----------
static void processWsEvent(const JsonDocument &doc) {
  String type = doc["type"] | "";
  uint32_t id = (uint32_t)doc["id"];

  if (type == "open") {
    String app = doc["app"] | "";
    desktop.openApp(app);
  } else if (type == "close") {
    desktop.closeWindow(id);
  } else if (type == "min") {
    desktop.minimizeWindow(id);
  } else if (type == "max") {
    desktop.maximizeWindow(id);
  } else if (type == "restore") {
    desktop.restoreWindow(id);
  } else if (type == "focus") {
    desktop.focusWindow(id);
  } else if (type == "move") {
    desktop.moveWindow(id, (int)doc["x"], (int)doc["y"]);
  } else if (type == "resize") {
    desktop.resizeWindow(id, (int)doc["w"], (int)doc["h"]);
  } else if (type == "app") {
    Window *w = desktop.getWindow(id);
    if (w) {
      JsonDocument ctx;
      ctx["name"] = sys_name;
      ctx["hostname"] = hostname;
      ctx["ip"] = WiFi.localIP().toString();
      ctx["heap"] = (long)ESP.getFreeHeap();
      ctx["uptime"] = (unsigned long)(millis() / 1000);
      JsonVariantConst action = doc["action"];
      handleAppAction(w, action, ctx);
      if (ctx["doReboot"] | false) {
        broadcastState();
        delay(300);
        ESP.restart();
      }
      if (ctx["doResetWifi"] | false) {
        wifi_ssid[0] = 0;
        wifi_pass[0] = 0;
        prefs.putString("wifi_ssid", "");
        prefs.putString("wifi_pass", "");
        broadcastState();
        delay(300);
        ESP.restart();
      }
    }
  } else if (type == "appstore_list") {
    // retorna repos + apps instalados
    JsonDocument r;
    r["type"] = "appstore_data";
    JsonArray reposArr = r["repos"].to<JsonArray>();
    for (int i = 0; i < desktop.repoCount; i++) {
      JsonObject ro = reposArr.add<JsonObject>();
      ro["index"] = i;
      ro["url"] = desktop.repos[i].url;
      ro["nickname"] = desktop.repos[i].nickname;
    }
    JsonArray appsArr = r["installed"].to<JsonArray>();
    for (int i = 0; i < desktop.appCount; i++) {
      JsonObject ao = appsArr.add<JsonObject>();
      ao["id"] = desktop.installedApps[i].id;
      ao["name"] = desktop.installedApps[i].name;
      ao["desc"] = desktop.installedApps[i].desc;
      ao["icon"] = desktop.installedApps[i].icon;
      ao["author"] = desktop.installedApps[i].author;
      ao["version"] = desktop.installedApps[i].version;
    }
    { String out; serializeJson(r, out); ws.textAll(out); }
    return; // nao precisa de broadcastState

  } else if (type == "appstore_addrepo") {
    String url = doc["url"] | "";
    String nick = doc["nickname"] | "";
    desktop.addRepo(url, nick);

  } else if (type == "appstore_removerepo") {
    int idx = (int)doc["index"];
    desktop.removeRepo(idx);

  } else if (type == "appstore_browse") {
    String url = doc["url"] | "";
    JsonDocument r;
    r["type"] = "appstore_browse";
    r["url"] = url;
    r["ok"] = false;

    if (WiFi.status() == WL_CONNECTED && url.length() > 0) {
      // converter GitHub URL para raw
      String fetchUrl = url;
      if (fetchUrl.endsWith("/")) fetchUrl = fetchUrl.substring(0, fetchUrl.length() - 1);
      if (fetchUrl.startsWith("https://github.com/") || fetchUrl.startsWith("http://github.com/")) {
        String ghPath = fetchUrl;
        if (ghPath.startsWith("http")) ghPath = ghPath.substring(ghPath.indexOf("//") + 2);
        if (ghPath.endsWith("/")) ghPath = ghPath.substring(0, ghPath.length() - 1);
        fetchUrl = "https://raw.githubusercontent.com/" + ghPath.substring(ghPath.indexOf("/") + 1) + "/main/repo.json";
      } else {
        // HTTP direto: buscar repo.json
        if (!fetchUrl.endsWith("/")) fetchUrl += "/";
        fetchUrl += "repo.json";
      }

      HTTPClient http;
      http.begin(fetchUrl);
      http.setTimeout(8000);
      int code = http.GET();
      if (code == 200) {
        String payload = http.getString();
        JsonDocument repoDoc;
        if (!deserializeJson(repoDoc, payload)) {
          JsonArray appsList = r["apps"].to<JsonArray>();
          JsonArray apps = repoDoc["apps"];
          for (JsonObject app : apps) {
            JsonObject ao = appsList.add<JsonObject>();
            ao["id"] = app["id"] | "";
            ao["name"] = app["name"] | "";
            ao["desc"] = app["description"] | app["desc"] | "";
            ao["icon"] = app["icon"] | "📦";
            ao["author"] = app["author"] | "";
            ao["version"] = app["version"] | "1.0";
            ao["dir"] = app["dir"] | app["id"] | "";
          }
          r["ok"] = true;
        }
      }
      http.end();
    }
    { String out; serializeJson(r, out); ws.textAll(out); }
    return;

  } else if (type == "appstore_install") {
    String repoUrl = doc["repo"] | "";
    String appId = doc["appId"] | "";
    String dir = doc["dir"] | appId;

    // buscar manifest + template do repo
    String baseUrl = repoUrl;
    if (baseUrl.endsWith("/")) baseUrl = baseUrl.substring(0, baseUrl.length() - 1);

    // suporta GitHub
    if (repoUrl.startsWith("https://github.com/") || repoUrl.startsWith("http://github.com/")) {
      String ghPath = repoUrl;
      if (ghPath.startsWith("http")) ghPath = ghPath.substring(ghPath.indexOf("//") + 2);
      if (ghPath.endsWith("/")) ghPath = ghPath.substring(0, ghPath.length() - 1);
      String userRepo = ghPath.substring(ghPath.indexOf("/") + 1);
      baseUrl = "https://raw.githubusercontent.com/" + userRepo + "/main/apps/" + dir;
    } else {
      baseUrl = baseUrl + "/" + dir;
    }

    if (WiFi.status() == WL_CONNECTED) {
      // buscar manifest.json
      HTTPClient http;
      http.begin(baseUrl + "/manifest.json");
      int code = http.GET();
      if (code == 200) {
        String m = http.getString();
        JsonDocument manifest;
        if (!deserializeJson(manifest, m)) {
          String name = manifest["name"] | appId;
          String desc = manifest["description"] | "";
          String icon = manifest["icon"] | "📦";
          String author = manifest["author"] | "";
          String version = manifest["version"] | "1.0";

          // buscar template.html
          http.end();
          http.begin(baseUrl + "/template.html");
          String tmpl = "";
          if (http.GET() == 200) tmpl = http.getString();
          http.end();

          // buscar style.css (opcional)
          String css = "";
          http.begin(baseUrl + "/style.css");
          if (http.GET() == 200) css = http.getString();
          http.end();

          desktop.installApp(appId, name, desc, icon, author, version, tmpl, css);
        }
      }
      http.end();
    }

  } else if (type == "appstore_uninstall") {
    String appId = doc["appId"] | "";
    desktop.uninstallApp(appId);

  } else if (type == "appstore_install_zip") {
    String appId = doc["appId"] | "";
    String name = doc["name"] | appId;
    String desc = doc["desc"] | "";
    String icon = doc["icon"] | "📦";
    String author = doc["author"] | "";
    String version = doc["version"] | "1.0";
    String tmpl = doc["template"] | "";
    String css = doc["css"] | "";
    if (appId.length() > 0 && tmpl.length() > 0) {
      desktop.installApp(appId, name, desc, icon, author, version, tmpl, css);
    }

  } else if (type == "check_update") {
    if (WiFi.status() == WL_CONNECTED) {
      String versionUrl = "https://raw.githubusercontent.com/" + String(ESPAX_GITHUB_REPO) + "/main/version.json";
      HTTPClient http;
      http.begin(versionUrl);
      http.setTimeout(8000);
      int code = http.GET();
      JsonDocument r;
      r["type"] = "update_info";
      if (code == 200) {
        String payload = http.getString();
        JsonDocument doc2;
        if (!deserializeJson(doc2, payload)) {
          String latest = doc2["version"] | "";
          String binUrl = doc2["binUrl"] | "";
          String changelog = doc2["changelog"] | "";
          r["ok"] = true;
          r["current"] = ESPAX_VERSION;
          r["latest"] = latest;
          r["binUrl"] = binUrl;
          r["changelog"] = changelog;
          r["updateAvailable"] = (latest != ESPAX_VERSION && binUrl.length() > 0);
        } else {
          r["ok"] = false;
          r["msg"] = "Parse error";
        }
      } else {
        r["ok"] = false;
        r["msg"] = "HTTP error " + String(code);
      }
      http.end();
      String out;
      serializeJson(r, out);
      ws.textAll(out);
    }
    return;

  } else if (type == "install_update") {
    String binUrl = doc["binUrl"] | "";
    if (binUrl.length() > 0 && WiFi.status() == WL_CONNECTED) {
      JsonDocument r;
      r["type"] = "update_progress";
      r["msg"] = "Baixando firmware...";
      String out;
      serializeJson(r, out);
      ws.textAll(out);

      delay(500);
      WiFiClient client;
      httpUpdate.update(client, binUrl);
    }
    return;
  }

  broadcastState();
}

static void onWsEvent(AsyncWebSocket *server, AsyncWebSocketClient *client,
                      AwsEventType type, void *arg, uint8_t *data, size_t len) {
  if (type == WS_EVT_CONNECT) {
    client->printf("{\"type\":\"hello\",\"name\":\"%s\"}", sys_name);
    JsonDocument s;
    fillState(s);
    String out;
    serializeJson(s, out);
    client->text(out);
  } else if (type == WS_EVT_DATA) {
    AwsFrameInfo *info = (AwsFrameInfo *)arg;
    if (info->final && info->index == 0 && info->len == len &&
        info->opcode == WS_TEXT) {
      JsonDocument doc;
      DeserializationError err = deserializeJson(doc, data, len);
      if (!err) {
        processWsEvent(doc);
      }
    }
  } else if (type == WS_EVT_ERROR) {
    // ignore
  }
}

// ---------- API HTTP (login + utilitarios) ----------
static String serializeJsonSafe(const String &s) {
  JsonDocument d;
  d["c"] = s;
  String out;
  serializeJson(d, out);
  return out;
}

static void apiLogin(AsyncWebServerRequest *request, JsonVariant &json) {
  JsonObject doc = json.as<JsonObject>();
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
    request->send(200, "application/json", out);
  } else {
    request->send(401, "application/json", "{\"ok\":false,\"msg\":\"Credenciais invalidas\"}");
  }
}

static void apiStatus(AsyncWebServerRequest *request) {
  if (!checkAuth()) {
    request->send(401, "application/json", "{\"ok\":false,\"msg\":\"Not auth\"}");
    return;
  }
  JsonDocument r;
  r["ok"] = true;
  r["name"] = sys_name;
  r["hostname"] = hostname;
  r["heap"] = (long)ESP.getFreeHeap();
  r["uptime"] = (unsigned long)(millis() / 1000);
  r["ip"] = WiFi.localIP().toString();
  r["ssid"] = (WiFi.status() == WL_CONNECTED) ? WiFi.SSID() : "";
  r["chip"]["cores"] = ESP.getChipCores();
  r["chip"]["frequency"] = ESP.getCpuFreqMHz();
  r["chip"]["flash_size"] = (unsigned long)ESP.getFlashChipSize();
  r["chip"]["model"] = ESP.getChipModel();
  String out;
  serializeJson(r, out);
  request->send(200, "application/json", out);
}

static void apiNotepad(AsyncWebServerRequest *request) {
  if (!checkAuth()) {
    request->send(401, "application/json", "{\"ok\":false}");
    return;
  }
  if (request->method() == HTTP_GET) {
    String content = loadFile("/notepad.txt");
    request->send(200, "application/json", "{\"ok\":true,\"content\":" + serializeJsonSafe(content) + "}");
  } else if (request->method() == HTTP_POST) {
    JsonDocument doc;
    DeserializationError err = deserializeJson(doc, request->arg("plain"));
    if (err) {
      request->send(400, "application/json", "{\"ok\":false}");
      return;
    }
    String content = doc["content"] | "";
    File f = LittleFS.open("/notepad.txt", "w");
    if (f) {
      f.print(content);
      f.close();
      request->send(200, "application/json", "{\"ok\":true}");
    } else {
      request->send(500, "application/json", "{\"ok\":false,\"msg\":\"FS error\"}");
    }
  } else {
    request->send(405, "application/json", "{\"ok\":false}");
  }
}

static void apiFiles(AsyncWebServerRequest *request) {
  if (!checkAuth()) {
    request->send(401, "application/json", "{\"ok\":false}");
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
        o["size"] = (unsigned long)f.size();
      }
      f = root.openNextFile();
    }
  }
  String out;
  serializeJson(r, out);
  request->send(200, "application/json", out);
}

static void apiReboot(AsyncWebServerRequest *request) {
  if (!checkAuth()) {
    request->send(401, "application/json", "{\"ok\":false}");
    return;
  }
  request->send(200, "application/json", "{\"ok\":true,\"msg\":\"Rebooting...\"}");
  delay(300);
  ESP.restart();
}

static void apiClearSession(AsyncWebServerRequest *request) {
  session.token = 0;
  request->send(200, "application/json", "{\"ok\":true}");
}

// ---------- Proxy HTTP: ESP32 busca URL externa e repassa ----------
static void apiProxy(AsyncWebServerRequest *request) {
  if (!checkAuth()) {
    request->send(401, "application/json", "{\"ok\":false,\"msg\":\"Not auth\"}");
    return;
  }
  String url = request->arg("url");
  String method = request->arg("method");
  String body = request->arg("body");
  String contentType = request->arg("content-type");

  if (url.length() == 0) {
    request->send(400, "application/json", "{\"ok\":false,\"msg\":\"url required\"}");
    return;
  }

  if (WiFi.status() != WL_CONNECTED) {
    request->send(503, "application/json", "{\"ok\":false,\"msg\":\"No WiFi\"}");
    return;
  }

  HTTPClient http;
  http.begin(url);
  http.setTimeout(10000);

  if (contentType.length() > 0) {
    http.addHeader("Content-Type", contentType);
  }

  int code;
  if (method == "POST" || method == "PUT" || method == "PATCH") {
    if (method == "POST") code = http.POST(body);
    else if (method == "PUT") code = http.PUT(body);
    else code = http.sendRequest("PATCH", body);
  } else {
    code = http.GET();
  }

  if (code > 0) {
    String payload = http.getString();
    JsonDocument r;
    r["ok"] = true;
    r["status"] = code;
    r["body"] = payload;
    String out;
    serializeJson(r, out);
    request->send(200, "application/json", out);
  } else {
    JsonDocument r;
    r["ok"] = false;
    r["msg"] = http.errorToString(code);
    String out;
    serializeJson(r, out);
    request->send(502, "application/json", out);
  }
  http.end();
}

// ---------- OTA Update via GitHub ----------
static void apiCheckUpdate(AsyncWebServerRequest *request) {
  if (WiFi.status() != WL_CONNECTED) {
    request->send(503, "application/json", "{\"ok\":false,\"msg\":\"No WiFi\"}");
    return;
  }

  String versionUrl = "https://raw.githubusercontent.com/" + String(ESPAX_GITHUB_REPO) + "/main/version.json";
  HTTPClient http;
  http.begin(versionUrl);
  http.setTimeout(8000);
  int code = http.GET();

  if (code != 200) {
    http.end();
    request->send(502, "application/json", "{\"ok\":false,\"msg\":\"HTTP error\"}");
    return;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, payload)) {
    request->send(500, "application/json", "{\"ok\":false,\"msg\":\"Parse error\"}");
    return;
  }

  String latestVersion = doc["version"] | "";
  String binUrl = doc["binUrl"] | "";
  String changelog = doc["changelog"] | "";

  JsonDocument r;
  r["ok"] = true;
  r["current"] = ESPAX_VERSION;
  r["latest"] = latestVersion;
  r["binUrl"] = binUrl;
  r["changelog"] = changelog;
  r["updateAvailable"] = (latestVersion != ESPAX_VERSION && binUrl.length() > 0);
  String out;
  serializeJson(r, out);
  request->send(200, "application/json", out);
}

static void apiInstallUpdate(AsyncWebServerRequest *request) {
  if (WiFi.status() != WL_CONNECTED) {
    request->send(503, "application/json", "{\"ok\":false,\"msg\":\"No WiFi\"}");
    return;
  }

  String binUrl = request->arg("url");
  if (binUrl.length() == 0) {
    request->send(400, "application/json", "{\"ok\":false,\"msg\":\"url required\"}");
    return;
  }

  request->send(200, "application/json", "{\"ok\":true,\"msg\":\"Installing...\"}");
  delay(500);

  WiFiClient client;
  t_httpUpdate_return ret = httpUpdate.update(client, binUrl);

  if (ret == HTTP_UPDATE_OK) {
    ESP.restart();
  }
  // se falhar, o ESP32 continua rodando (nao reinicia)
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

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Iniciando ESPax...");

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

  if (!LittleFS.begin()) {
    Serial.println("LittleFS falhou ao montar. Formatando...");
    LittleFS.format();
    if (!LittleFS.begin()) {
      Serial.println("Falha definitiva ao montar LittleFS!");
    }
  }

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

  // Desktop model
  desktop.begin();

  // Index
  html_index = loadFile("/index.html");

  // WebSocket
  ws.onEvent(onWsEvent);
  server.addHandler(&ws);

  // Routes
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/html", html_index);
  });
  server.on("/index.html", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/html", html_index);
  });
  server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "text/css", loadFile("/style.css"));
  });
  server.on("/app.js", HTTP_GET, [](AsyncWebServerRequest *request) {
    request->send(200, "application/javascript", loadFile("/app.js"));
  });

  server.addHandler(new AsyncCallbackJsonWebHandler("/api/login",
    [](AsyncWebServerRequest *request, JsonVariant &json) {
      apiLogin(request, json);
    }));
  server.on("/api/status", HTTP_GET, apiStatus);
  server.on("/api/notepad", HTTP_GET, apiNotepad);
  server.on("/api/notepad", HTTP_POST, apiNotepad);
  server.on("/api/files", HTTP_GET, apiFiles);
  server.on("/api/reboot", HTTP_POST, apiReboot);
  server.on("/api/logout", HTTP_POST, apiClearSession);
  server.on("/api/proxy", HTTP_GET, apiProxy);
  server.on("/api/proxy", HTTP_POST, apiProxy);
  server.on("/api/check-update", HTTP_GET, apiCheckUpdate);
  server.on("/api/install-update", HTTP_POST, apiInstallUpdate);

  server.onNotFound([](AsyncWebServerRequest *request) {
    request->send(404, "text/plain", "Not found");
  });

  server.begin();
  Serial.println("Servidor HTTP + WebSocket iniciado!");

  printWelcome();
}

unsigned long lastSerialPrint = 0;

void loop() {
  ws.cleanupClients();
  handleSerial();
  delay(1);
}
