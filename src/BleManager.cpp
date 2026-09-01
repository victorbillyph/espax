#include "BleManager.h"

static BluetoothManager* gBtMgr = nullptr;
static bool bleInitialized = false;
static SemaphoreHandle_t scanMutex = NULL;

static void scanTask(void* param) {
  BluetoothManager* mgr = (BluetoothManager*)param;
  Serial.println("[BLE] scan task started");
  BLEScanResults results = mgr->pScan->start(8, false);
  int count = results.getCount();
  Serial.printf("[BLE] scan done: %d devices\n", count);
  mgr->scanning = false;
  vTaskDelete(NULL);
}

static class : public BLEAdvertisedDeviceCallbacks {
  void onResult(BLEAdvertisedDevice dev) override {
    if (!gBtMgr) return;
    BtDevice d;
    d.address = String(dev.getAddress().toString().c_str());
    d.name = dev.haveName() ? String(dev.getName().c_str()) : "Desconhecido";
    d.rssi = dev.getRSSI();
    d.connected = false;
    gBtMgr->devices.push_back(d);
  }
} scanCallbacks;

static class : public BLEClientCallbacks {
  void onConnect(BLEClient* c) override {}
  void onDisconnect(BLEClient* c) override {
    if (gBtMgr) gBtMgr->connectedIdx = -1;
  }
} clientCallbacks;

BluetoothManager::BluetoothManager()
  : pScan(nullptr), pClient(nullptr), connectedIdx(-1),
    scanning(false), scanEndMs(0) {
  gBtMgr = this;
}

void BluetoothManager::startScan(uint32_t duration) {
  if (scanning) return;
  devices.clear();
  services.clear();
  characteristics.clear();

  if (!bleInitialized) {
    BLEDevice::init("ESPax");
    bleInitialized = true;
  }
  pScan = BLEDevice::getScan();
  pScan->setAdvertisedDeviceCallbacks(&scanCallbacks, false);
  pScan->setInterval(134);
  pScan->setWindow(99);
  pScan->setActiveScan(true);
  scanning = true;
  scanEndMs = millis() + duration * 1000;

  xTaskCreatePinnedToCore(scanTask, "ble_sc", 16384, this, 1, NULL, 0);
}

void BluetoothManager::stopScan() {
  if (pScan && scanning) {
    pScan->stop();
    scanning = false;
  }
}

bool BluetoothManager::connectToDevice(int index) {
  if (index < 0 || index >= (int)devices.size()) return false;
  disconnect();
  BLEAddress addr(devices[index].address.c_str());
  pClient = BLEDevice::createClient();
  pClient->setClientCallbacks(&clientCallbacks);
  if (!pClient->connect(addr)) {
    delete pClient;
    pClient = nullptr;
    return false;
  }
  connectedIdx = index;
  devices[index].connected = true;
  discoverServices();
  return true;
}

void BluetoothManager::disconnect() {
  if (pClient) {
    if (pClient->isConnected()) pClient->disconnect();
    delete pClient;
    pClient = nullptr;
  }
  if (connectedIdx >= 0 && connectedIdx < (int)devices.size()) {
    devices[connectedIdx].connected = false;
  }
  connectedIdx = -1;
  services.clear();
  characteristics.clear();
}

bool BluetoothManager::isConnected() {
  return pClient && pClient->isConnected();
}

void BluetoothManager::discoverServices() {
  services.clear();
  characteristics.clear();
  if (!pClient || !pClient->isConnected()) return;

  std::map<std::string, BLERemoteService*>* svcMap = pClient->getServices();
  for (auto& [uuid, svc] : *svcMap) {
    BtService s;
    s.uuid = String(uuid.c_str());
    String u = s.uuid;
    u.toUpperCase();
    if (u.indexOf("180F") >= 0) s.name = "Battery Service";
    else if (u.indexOf("180A") >= 0) s.name = "Device Information";
    else if (u.indexOf("1800") >= 0) s.name = "Generic Access";
    else if (u.indexOf("1801") >= 0) s.name = "Generic Attribute";
    else if (u.indexOf("6E400001") >= 0) s.name = "Nordic UART Service";
    else s.name = s.uuid;

    std::map<std::string, BLERemoteCharacteristic*>* charMap = svc->getCharacteristics();
    for (auto& [cUuid, ch] : *charMap) {
      BtCharacteristic c;
      c.uuid = String(cUuid.c_str());
      c.serviceUuid = s.uuid;
      c.canRead = ch->canRead();
      c.canWrite = ch->canWrite();
      c.canNotify = ch->canNotify();
      s.chars.push_back(c.uuid);
      characteristics.push_back(c);
    }
    services.push_back(s);
  }
}

String BluetoothManager::readCharacteristic(String charUuid) {
  if (!pClient || !pClient->isConnected()) return "";
  for (auto& s : services) {
    BLERemoteService* svc = pClient->getService(BLEUUID(s.uuid.c_str()));
    if (!svc) continue;
    BLERemoteCharacteristic* ch = svc->getCharacteristic(BLEUUID(charUuid.c_str()));
    if (!ch || !ch->canRead()) continue;
    std::string val = ch->readValue();
    String result = "";
    for (size_t i = 0; i < val.length(); i++) {
      char c = val[i];
      if (c >= 32 && c < 127) result += c;
      else { char buf[5]; snprintf(buf, sizeof(buf), "\\x%02x", (uint8_t)c); result += buf; }
    }
    return result;
  }
  return "";
}

bool BluetoothManager::writeCharacteristic(String charUuid, String data) {
  if (!pClient || !pClient->isConnected()) return false;
  for (auto& s : services) {
    BLERemoteService* svc = pClient->getService(BLEUUID(s.uuid.c_str()));
    if (!svc) continue;
    BLERemoteCharacteristic* ch = svc->getCharacteristic(BLEUUID(charUuid.c_str()));
    if (!ch || !ch->canWrite()) continue;
    ch->writeValue(data.c_str(), data.length());
    return true;
  }
  return false;
}

bool BluetoothManager::subscribeNotify(String charUuid) {
  if (!pClient || !pClient->isConnected()) return false;
  for (auto& s : services) {
    BLERemoteService* svc = pClient->getService(BLEUUID(s.uuid.c_str()));
    if (!svc) continue;
    BLERemoteCharacteristic* ch = svc->getCharacteristic(BLEUUID(charUuid.c_str()));
    if (!ch || !ch->canNotify()) continue;
    BLERemoteDescriptor* desc = ch->getDescriptor(BLEUUID((uint16_t)0x2902));
    if (desc) { uint8_t val[] = {0x01, 0x00}; desc->writeValue(val, 2); }
    return true;
  }
  return false;
}

bool BluetoothManager::unsubscribeNotify(String charUuid) {
  if (!pClient || !pClient->isConnected()) return false;
  for (auto& s : services) {
    BLERemoteService* svc = pClient->getService(BLEUUID(s.uuid.c_str()));
    if (!svc) continue;
    BLERemoteCharacteristic* ch = svc->getCharacteristic(BLEUUID(charUuid.c_str()));
    if (!ch) continue;
    BLERemoteDescriptor* desc = ch->getDescriptor(BLEUUID((uint16_t)0x2902));
    if (desc) { uint8_t val[] = {0x00, 0x00}; desc->writeValue(val, 2); }
    return true;
  }
  return false;
}

std::vector<BtDevice>& BluetoothManager::getDevices() { return devices; }
std::vector<BtService>& BluetoothManager::getServices() { return services; }
std::vector<BtCharacteristic>& BluetoothManager::getCharacteristics() { return characteristics; }

void BluetoothManager::loop() {
  if (scanning && millis() >= scanEndMs) {
    scanning = false;
  }
}
