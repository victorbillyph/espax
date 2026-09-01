#include "Desktop.h"
#include <LittleFS.h>
#include "FS.h"

Desktop::Desktop() : windowCount(0), nextId(1), zTop(1) {
  for (int i = 0; i < MAX_WINDOWS; i++) windows[i] = nullptr;
}

void Desktop::begin() {
  reset();
}

void Desktop::reset() {
  for (int i = 0; i < MAX_WINDOWS; i++) {
    if (windows[i]) { delete windows[i]; windows[i] = nullptr; }
  }
  windowCount = 0;
  nextId = 1;
  zTop = 1;
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
  return app;
}

Window* Desktop::openApp(const String &app) {
  // ja existe janela desse app? traz para frente e restaura
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

  // posicao em cascata
  int cascade = (windowCount % 5);
  w->w = 420; w->h = 320;
  w->x = 120 + cascade * 30;
  w->y = 70 + cascade * 30;

  // app-specific default data
  if (app == "calc") {
    w->data["display"] = "0";
    w->data["acc"] = "0";
    w->data["op"] = "";
    w->data["clearNext"] = false;
  } else if (app == "terminal") {
    w->data["prompt"] = "espax> ";
    w->data["output"] = "ESPax Terminal v1.0\nDigite 'help' para ajuda.\n\n";
  } else if (app == "notepad") {
    File f = LittleFS.open("/notepad.txt", "r");
    String content;
    if (f) { content = f.readString(); f.close(); }
    w->data["text"] = content;
  } else if (app == "files") {
    // noop - enumerate on serialize
  }

  zTop++;
  w->z = zTop;
  windows[windowCount++] = w;
  return w;
}

Window* Desktop::getWindow(uint32_t id) {
  for (int i = 0; i < windowCount; i++) {
    if (windows[i] && windows[i]->id == id) return windows[i];
  }
  return nullptr;
}

bool Desktop::closeWindow(uint32_t id) {
  for (int i = 0; i < windowCount; i++) {
    if (windows[i] && windows[i]->id == id) {
      // persistir notepad ao fechar
      if (windows[i]->app == "notepad") {
        const char *txt = windows[i]->data["text"] | "";
        File f = LittleFS.open("/notepad.txt", "w");
        if (f) { f.print(txt); f.close(); }
      }
      delete windows[i];
      // compactar lista
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
  if (!w) return;
  w->x = x; w->y = y;
}

void Desktop::resizeWindow(uint32_t id, int w, int h) {
  Window *win = getWindow(id);
  if (!win) return;
  win->w = w; win->h = h;
}

void Desktop::serializeWindow(JsonObject &o, Window *w) {
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
  // estimativa: struct Window (~384 bytes) + JsonDocument data (~256-2048 bytes)
  // + titulo, app strings (~64 bytes cada)
  int base = 384 + 128; // struct + strings
  String d = w->data["display"] | "";
  String o = w->data["output"] | "";
  String t = w->data["text"] | "";
  int dataSize = d.length() + o.length() + t.length();
  if (dataSize == 0) dataSize = w->data.size() * 32; // estimativa base
  return base + dataSize + 256; // 256 = overhead do JsonDocument
}
