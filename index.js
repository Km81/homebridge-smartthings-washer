// homebridge-smartthings-washer v1.0.1
'use strict';

const SmartThings = require('./lib/SmartThings');
const pkg = require('./package.json');

let Accessory, Service, Characteristic, UUIDGen;

const normalizeKorean = s => (s || '').normalize('NFC').trim();

module.exports = (homebridge) => {
  Accessory = homebridge.platformAccessory;
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  UUIDGen = homebridge.hap.uuid;

  homebridge.registerPlatform('homebridge-smartthings-washer', 'SmartThingsWasher', SmartThingsWasherPlatform);
};

class SmartThingsWasherPlatform {
  constructor(log, config, api) {
    this.log = log;
    this.config = config;
    this.api = api;
    this.accessories = [];

    if (!config) {
      this.log.warn('설정이 없습니다. 플러그인을 비활성화합니다.');
      return;
    }
    if (!config.token) {
      this.log.error('SmartThings 토큰이 설정되지 않았습니다. config.json을 확인해주세요.');
      return;
    }
    if (!config.devices || !Array.isArray(config.devices) || config.devices.length === 0) {
      this.log.error('연동할 디바이스가 설정되지 않았습니다. config.json의 "devices" 배열을 확인해주세요.');
      return;
    }

    this.smartthings = new SmartThings(config.token, this.log);

    if (this.api) {
      this.log.info('SmartThings 세탁기/건조기 플랫폼 초기화 중...');
      this.api.on('didFinishLaunching', async () => {
        this.log.info('Homebridge 실행 완료. 장치 검색을 시작합니다.');
        await this.discoverDevices();
      });
    }
  }

  configureAccessory(accessory) {
    this.log.info(`캐시된 액세서리 불러오기: ${accessory.displayName}`);
    this.accessories.push(accessory);
  }

  async discoverDevices() {
    this.log.info('SmartThings에서 장치 목록을 가져오는 중...');
    try {
      const stDevices = await this.smartthings.getDevices();
      const configDevices = this.config.devices;

      this.log.info(`총 ${stDevices.length}개의 SmartThings 장치를 발견했습니다. 설정된 장치와 비교합니다.`);

      for (const configDevice of configDevices) {
        const targetLabel = normalizeKorean(configDevice.deviceLabel);
        const foundDevice = stDevices.find(stDevice => normalizeKorean(stDevice.label) === targetLabel);

        if (foundDevice) {
          this.log.info(`'${configDevice.deviceLabel}' 장치를 찾았습니다. HomeKit에 추가/갱신합니다.`);
          this.addOrUpdateAccessory(foundDevice);
        } else {
          this.log.warn(`'${configDevice.deviceLabel}'에 해당하는 장치를 SmartThings에서 찾지 못했습니다.`);
        }
      }
    } catch (e) {
      this.log.error('장치 검색 중 심각한 오류가 발생했습니다:', e.message);
    }
  }

  addOrUpdateAccessory(device) {
    const uuid = UUIDGen.generate(device.deviceId);
    let accessory = this.accessories.find(acc => acc.UUID === uuid);

    if (accessory) {
      this.log.info(`기존 액세서리 갱신: ${device.label}`);
      accessory.context.device = device;
    } else {
      this.log.info(`새 액세서리 등록: ${device.label}`);
      accessory = new Accessory(device.label, uuid);
      accessory.context.device = device;
      this.api.registerPlatformAccessories('homebridge-smartthings-washer', 'SmartThingsWasher', [accessory]);
      this.accessories.push(accessory);
    }

    accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
      .setCharacteristic(Characteristic.Model, 'Washer/Dryer')
      .setCharacteristic(Characteristic.SerialNumber, device.deviceId)
      .setCharacteristic(Characteristic.FirmwareRevision, pkg.version);

    this.setupValveService(accessory);
  }

  setupValveService(accessory) {
    const deviceId = accessory.context.device.deviceId;
    const service = accessory.getService(Service.Valve) || accessory.addService(Service.Valve, accessory.displayName);

    service.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.WATER_FAUCET);

    // --- '활성' 상태 (세탁/건조 중인지) ---
    service.getCharacteristic(Characteristic.Active)
      .on('get', async (callback) => {
        try {
          const status = await this.smartthings.getStatus(deviceId);
          const opState = status.washerOperatingState || status.dryerOperatingState;
          const jobState = opState?.washerJobState?.value || opState?.dryerJobState?.value;
          
          this.log.info(`[${accessory.displayName}] 현재 작동 상태: ${jobState}`);
          const isActive = jobState === 'running';
          callback(null, isActive ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
        } catch (e) {
          this.log.error(`[${accessory.displayName}] Active 상태 GET 오류: ${e.message}. '꺼짐' 상태로 처리합니다.`);
          // 오류 발생 시 '꺼짐'으로 처리
          callback(null, Characteristic.Active.INACTIVE);
        }
      });

    // --- '사용 중' 상태 (활성과 동일하게 연동) ---
    service.getCharacteristic(Characteristic.InUse)
      .on('get', async (callback) => {
        try {
          const status = await this.smartthings.getStatus(deviceId);
          const opState = status.washerOperatingState || status.dryerOperatingState;
          const jobState = opState?.washerJobState?.value || opState?.dryerJobState?.value;

          const isInUse = jobState === 'running';
          callback(null, isInUse ? Characteristic.InUse.IN_USE : Characteristic.InUse.NOT_IN_USE);
        } catch (e) {
          this.log.error(`[${accessory.displayName}] InUse 상태 GET 오류: ${e.message}. '사용 안함' 상태로 처리합니다.`);
          // 오류 발생 시 '사용 안함'으로 처리
          callback(null, Characteristic.InUse.NOT_IN_USE);
        }
      });

    // --- '남은 시간' (가장 중요한 기능) ---
    service.getCharacteristic(Characteristic.RemainingDuration)
      .on('get', async (callback) => {
        try {
          const status = await this.smartthings.getStatus(deviceId);
          const opState = status.washerOperatingState || status.dryerOperatingState;
          const completionTimeStr = opState?.completionTime?.value;

          if (!completionTimeStr) {
            this.log.info(`[${accessory.displayName}] 완료 예정 시간이 없습니다.`);
            return callback(null, 0);
          }

          const completionTime = new Date(completionTimeStr);
          const now = new Date();
          const remainingSeconds = Math.round((completionTime - now) / 1000);

          if (remainingSeconds < 0) {
            this.log.info(`[${accessory.displayName}] 완료 시간이 이미 지났습니다.`);
            return callback(null, 0);
          }
          
          this.log.info(`[${accessory.displayName}] 남은 시간: ${remainingSeconds}초`);
          callback(null, remainingSeconds);
        } catch (e) {
          this.log.error(`[${accessory.displayName}] 남은 시간 GET 오류: ${e.message}. '0'으로 처리합니다.`);
          // 오류 발생 시 남은 시간 '0'으로 처리
          callback(null, 0);
        }
      });
  }
}
