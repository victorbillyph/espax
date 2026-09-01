#include "Desktop.h"
#include <LittleFS.h>
#include "FS.h"

Desktop::Desktop() : windowCount(0), nextId(1), zTop(1), appCount(0), repoCount(0) {
  for (int i = 0; i < MAX_WINDOWS; i++) windows[i] = nullptr;
}

void Desktop::begin() { reset(); }

void Desktop::reset() {
  for (int i = 0; i < MAX_WINDOWS; i++) {
    if (windows[i]) { delete windows[i]; windows[i] = nullptr; }
  }
  windowCount = 0;
  nextId = 1;
  zTop = 1;
  loadInstalledApps();
  loadRepos();
}

String Desktop::titleForApp(const String &app) {
  if (app == "calc") return "Calculadora";
  if (app == "notepad") return "Bloco de Notas";
  if (app == "terminal") return "Terminal";
  if (app == "files") return "Arquivos";
  if (app == "settings") return "Configuracoes";
  if (app == "about") return "Sobre";
  if (app == "info") return "Info do Sistema";
  if (app == "browser") return "Browser";
  if (app == "taskmanager") return "Gerenciador de Tarefas";
  if (app == "appstore") return "App Store";
  if (app == "bluetooth") return "Bluetooth";
  InstalledApp *a = getApp(app);
  if (a) return a->name;
  return app;
}

Window* Desktop::openApp(const String &app) {
  for (int i = 0; i < windowCount; i++) {
    if (windows[i] && windows[i]->app == app) {
      windows[i]->minimized = false;
      zTop++;
      windows[i]->z = zTop;
      return windows[i];
    }
  }
  if (windowCount >= MAX_WINDOWS) return nullptr;

  Window *w = new Window();
  w->id = nextId++;
  w->app = app;
  w->title = titleForApp(app);
  w->minimized = false;
  w->maximized = false;

  int cascade = (windowCount % 5);
  w->w = 420; w->h = 320;
  w->x = 120 + cascade * 30;
  w->y = 70 + cascade * 30;

  if (app == "calc") {
    w->data["display"] = "0"; w->data["acc"] = "0";
    w->data["op"] = ""; w->data["clearNext"] = false;
  } else if (app == "terminal") {
    w->data["prompt"] = "espax> ";
    w->data["output"] = "ESPax Terminal v1.0\nDigite 'help' para ajuda.\n\n";
  } else if (app == "notepad") {
    File f = LittleFS.open("/notepad.txt", "r");
    String content;
    if (f) { content = f.readString(); f.close(); }
    w->data["text"] = content;
  } else if (app == "appstore") {
    w->w = 520; w->h = 400;
  } else if (app == "bluetooth") {
    w->w = 650; w->h = 420;
  }

  zTop++;
  w->z = zTop;
  windows[windowCount++] = w;
  return w;
}

Window* Desktop::getWindow(uint32_t id) {
  for (int i = 0; i < windowCount; i++)
    if (windows[i] && windows[i]->id == id) return windows[i];
  return nullptr;
}

bool Desktop::closeWindow(uint32_t id) {
  for (int i = 0; i < windowCount; i++) {
    if (windows[i] && windows[i]->id == id) {
      if (windows[i]->app == "notepad") {
        const char *txt = windows[i]->data["text"] | "";
        File f = LittleFS.open("/notepad.txt", "w");
        if (f) { f.print(txt); f.close(); }
      }
      delete windows[i];
      for (int j = i; j < windowCount - 1; j++) windows[j] = windows[j + 1];
      windows[windowCount - 1] = nullptr;
      windowCount--;
      return true;
    }
  }
  return false;
}

bool Desktop::minimizeWindow(uint32_t id) {
  Window *w = getWindow(id);
  if (!w) return false;
  w->minimized = true;
  return true;
}

bool Desktop::maximizeWindow(uint32_t id) {
  Window *w = getWindow(id);
  if (!w) return false;
  w->maximized = !w->maximized;
  if (w->maximized) { w->minimized = false; zTop++; w->z = zTop; }
  return true;
}

bool Desktop::restoreWindow(uint32_t id) {
  Window *w = getWindow(id);
  if (!w) return false;
  w->minimized = false;
  zTop++;
  w->z = zTop;
  return true;
}

void Desktop::focusWindow(uint32_t id) {
  Window *w = getWindow(id);
  if (!w) return;
  w->minimized = false;
  zTop++;
  w->z = zTop;
}

void Desktop::moveWindow(uint32_t id, int x, int y) {
  Window *w = getWindow(id);
  if (w) { w->x = x; w->y = y; }
}

void Desktop::resizeWindow(uint32_t id, int w2, int h2) {
  Window *w = getWindow(id);
  if (w) { w->w = w2; w->h = h2; }
}

// ---------- App Store: Apps instalados ----------
bool Desktop::installApp(const String &id, const String &name, const String &desc,
                         const String &icon, const String &author, const String &version,
                         const String &tmpl, const String &css) {
  if (appCount >= MAX_APPS) return false;
  // substitui se ja existe
  for (int i = 0; i < appCount; i++) {
    if (installedApps[i].id == id) {
      installedApps[i].name = name;
      installedApps[i].desc = desc;
      installedApps[i].icon = icon;
      installedApps[i].author = author;
      installedApps[i].version = version;
      installedApps[i].templateHtml = tmpl;
      installedApps[i].css = css;
      saveInstalledApps();
      return true;
    }
  }
  installedApps[appCount].id = id;
  installedApps[appCount].name = name;
  installedApps[appCount].desc = desc;
  installedApps[appCount].icon = icon;
  installedApps[appCount].author = author;
  installedApps[appCount].version = version;
  installedApps[appCount].templateHtml = tmpl;
  installedApps[appCount].css = css;
  appCount++;
  saveInstalledApps();
  return true;
}

bool Desktop::uninstallApp(const String &id) {
  for (int i = 0; i < appCount; i++) {
    if (installedApps[i].id == id) {
      // remover arquivo do LittleFS
      String path = "/apps/" + id + ".json";
      LittleFS.remove(path);
      for (int j = i; j < appCount - 1; j++) installedApps[j] = installedApps[j + 1];
      appCount--;
      saveInstalledApps();
      return true;
    }
  }
  return false;
}

InstalledApp* Desktop::getApp(const String &id) {
  for (int i = 0; i < appCount; i++)
    if (installedApps[i].id == id) return &installedApps[i];
  return nullptr;
}

void Desktop::saveInstalledApps() {
  JsonDocument doc;
  JsonArray arr = doc["apps"].to<JsonArray>();
  for (int i = 0; i < appCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["id"] = installedApps[i].id;
    o["name"] = installedApps[i].name;
    o["desc"] = installedApps[i].desc;
    o["icon"] = installedApps[i].icon;
    o["author"] = installedApps[i].author;
    o["version"] = installedApps[i].version;
    o["template"] = installedApps[i].templateHtml;
    o["css"] = installedApps[i].css;
  }
  File f = LittleFS.open("/apps/index.json", "w");
  if (f) {
    serializeJson(doc, f);
    f.close();
  }
}

void Desktop::loadInstalledApps() {
  appCount = 0;
  File f = LittleFS.open("/apps/index.json", "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return;
  JsonArray arr = doc["apps"];
  for (JsonObject o : arr) {
    if (appCount >= MAX_APPS) break;
    installedApps[appCount].id = o["id"] | "";
    installedApps[appCount].name = o["name"] | "";
    installedApps[appCount].desc = o["desc"] | "";
    installedApps[appCount].icon = o["icon"] | "";
    installedApps[appCount].author = o["author"] | "";
    installedApps[appCount].version = o["version"] | "";
    installedApps[appCount].templateHtml = o["template"] | "";
    installedApps[appCount].css = o["css"] | "";
    appCount++;
  }
}

// ---------- App Store: Repos ----------
bool Desktop::addRepo(const String &url, const String &nickname) {
  if (repoCount >= MAX_REPOS) return false;
  for (int i = 0; i < repoCount; i++) {
    if (repos[i].url == url) return false; // duplicado
  }
  repos[repoCount].url = url;
  repos[repoCount].nickname = nickname;
  repoCount++;
  saveRepos();
  return true;
}

bool Desktop::removeRepo(int index) {
  if (index < 0 || index >= repoCount) return false;
  for (int j = index; j < repoCount - 1; j++) repos[j] = repos[j + 1];
  repoCount--;
  saveRepos();
  return true;
}

void Desktop::saveRepos() {
  JsonDocument doc;
  JsonArray arr = doc["repos"].to<JsonArray>();
  for (int i = 0; i < repoCount; i++) {
    JsonObject o = arr.add<JsonObject>();
    o["url"] = repos[i].url;
    o["nickname"] = repos[i].nickname;
  }
  File f = LittleFS.open("/repos.json", "w");
  if (f) {
    serializeJson(doc, f);
    f.close();
  }
}

void Desktop::loadRepos() {
  repoCount = 0;
  File f = LittleFS.open("/repos.json", "r");
  if (!f) return;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, f);
  f.close();
  if (err) return;
  JsonArray arr = doc["repos"];
  for (JsonObject o : arr) {
    if (repoCount >= MAX_REPOS) break;
    repos[repoCount].url = o["url"] | "";
    repos[repoCount].nickname = o["nickname"] | "";
    repoCount++;
  }
}

// ---------- Serializacao ----------
void Desktop::serializeWindow(JsonObject &o, Window *w) {
  o["id"] = (unsigned long)w->id;
  o["app"] = w->app;
  o["title"] = w->title;
  o["x"] = w->x; o["y"] = w->y;
  o["w"] = w->w; o["h"] = w->h;
  o["z"] = (unsigned long)w->z;
  o["min"] = w->minimized;
  o["max"] = w->maximized;
  o["ram"] = estimateWindowRAM(w);
  o["data"] = w->data.as<JsonVariant>();
}

JsonDocument Desktop::serializeState() {
  JsonDocument s;
  JsonArray wins = s["windows"].to<JsonArray>();
  for (int i = 0; i < windowCount; i++) {
    if (!windows[i]) continue;
    JsonObject o = wins.add<JsonObject>();
    serializeWindow(o, windows[i]);
  }
  return s;
}

int Desktop::estimateWindowRAM(Window *w) {
  int base = 384 + 128;
  String d = w->data["display"] | "";
  String o = w->data["output"] | "";
  String t = w->data["text"] | "";
  int dataSize = d.length() + o.length() + t.length();
  if (dataSize == 0) dataSize = w->data.size() * 32;
  return base + dataSize + 256;
}
