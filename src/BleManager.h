#pragma once
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <vector>

struct BtDevice {
  String address;
  String name;
  int rssi;
  bool connected;
};

struct BtService {
  String uuid;
  String name;
  std::vector<String> chars;
};

struct BtCharacteristic {
  String uuid;
  String serviceUuid;
  bool canRead;
  bool canWrite;
  bool canNotify;
};

class BluetoothManager {
public:
  BluetoothManager();
  void startScan(uint32_t duration = 10);
  void stopScan();
  bool connectToDevice(int index);
  void disconnect();
  bool isConnected();
  void discoverServices();
  std::vector<BtDevice>& getDevices();
  std::vector<BtService>& getServices();
  std::vector<BtCharacteristic>& getCharacteristics();
  String readCharacteristic(String charUuid);
  bool writeCharacteristic(String charUuid, String data);
  bool subscribeNotify(String charUuid);
  bool unsubscribeNotify(String charUuid);
  void loop();

  std::vector<BtDevice> devices;
  std::vector<BtService> services;
  std::vector<BtCharacteristic> characteristics;
  int connectedIdx;
  bool scanning;
  uint32_t scanEndMs;
  BLEScan* pScan;
  BLEClient* pClient;
};
