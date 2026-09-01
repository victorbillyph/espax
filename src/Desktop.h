#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

// ---------- Janela (modelo processado no ESP32) ----------
struct Window {
  uint32_t id;
  String app;
  String title;
  int x, y, w, h;
  uint32_t z;
  bool minimized;
  bool maximized;
  JsonDocument data;
  Window() : id(0), x(0), y(0), w(0), h(0), z(0), minimized(false), maximized(false) {}
};

// ---------- App instalado ----------
struct InstalledApp {
  String id;
  String name;
  String desc;
  String icon;
  String author;
  String version;
  String templateHtml;
  String css;
  bool operator==(const String &other) const { return id == other; }
};

// ---------- Repo ----------
struct Repo {
  String url;
  String nickname;
};

#define MAX_WINDOWS 6
#define MAX_APPS 16
#define MAX_REPOS 4

class Desktop {
public:
  Desktop();
  void begin();
  void reset();

  // --- Janelas ---
  Window* openApp(const String &app);
  Window* getWindow(uint32_t id);
  bool closeWindow(uint32_t id);
  bool minimizeWindow(uint32_t id);
  bool maximizeWindow(uint32_t id);
  bool restoreWindow(uint32_t id);
  void focusWindow(uint32_t id);
  void moveWindow(uint32_t id, int x, int y);
  void resizeWindow(uint32_t id, int w, int h);

  Window* windows[MAX_WINDOWS];
  int windowCount;
  uint32_t nextId;
  uint32_t zTop;

  // --- Apps instalados ---
  InstalledApp installedApps[MAX_APPS];
  int appCount;
  bool installApp(const String &id, const String &name, const String &desc,
                  const String &icon, const String &author, const String &version,
                  const String &tmpl, const String &css);
  bool uninstallApp(const String &id);
  InstalledApp* getApp(const String &id);
  void saveInstalledApps();
  void loadInstalledApps();

  // --- Repos ---
  Repo repos[MAX_REPOS];
  int repoCount;
  bool addRepo(const String &url, const String &nickname);
  bool removeRepo(int index);
  void saveRepos();
  void loadRepos();

  // --- Serializacao ---
  String titleForApp(const String &app);
  void serializeWindow(JsonObject &o, Window *w);
  JsonDocument serializeState();
  int estimateWindowRAM(Window *w);
};
