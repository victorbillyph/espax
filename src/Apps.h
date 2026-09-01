#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>
#include "Desktop.h"

// Processa uma acao de app no ESP32 (o browser so envia o input).
// Recebe a janela e os parametros da acao; retorna true se mudou estado.
extern void handleAppAction(Window *w, JsonVariantConst action, JsonDocument &terminalOut);
