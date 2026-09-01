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
  // estado especifico do app (calc display, terminal buffer, notepad text, ...)
  JsonDocument data;
  Window() : id(0), x(0), y(0), w(0), h(0), z(0), minimized(false), maximized(false) {}
};

// Limite de janelas simultaneas (memoria limitada do ESP32)
#define MAX_WINDOWS 6

class Desktop {
public:
  Desktop();
  void begin();
  void reset();

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

  String titleForApp(const String &app);
  void serializeWindow(JsonObject &o, Window *w);
  JsonDocument serializeState();
};
