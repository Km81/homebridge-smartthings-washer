// index.js v1.1.3 (Washer/Dryer Multi-Component Support)
'use strict';

const SmartThings = require('./lib/SmartThings');
const pkg = require('./package.json');
const http = require('http');
const url = require('url');

let Accessory, Service, Characteristic, UUIDGen;

const PLATFORM_NAME = 'SmartThingsWasher';
const PLUGIN_NAME = 'homebridge-smartthings-washer';

const normalizeKorean = s => (s || '').normalize('NFC').trim();

module.exports = (homebridge) => {
    Accessory = homebridge.platformAccessory;
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SmartThingsWasherPlatform);
};

class SmartThingsWasherPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = [];
        this.server = null;

        if (!config || !config.clientId || !config.clientSecret || !config.redirectUri) {
            this.log.error('인증 정보(clientId, clientSecret, redirectUri)가 모두 설정되어야 합니다.');
            return;
        }

        this.smartthings = new SmartThings(this.log, this.api, this.config);

        if (this.api) {
            this.log.info('SmartThings 세탁기/건조기 플랫폼 초기화 중...');
            this.api.on('didFinishLaunching', async () => {
                this.log.info('Homebridge 실행 완료. 인증 상태 확인 및 장치 검색을 시작합니다.');
                const hasToken = await this.smartthings.init();
                if (hasToken) {
                    await this.discoverDevices();
                } else {
                    this.startAuthServer();
                }
            });
        }
    }

    startAuthServer() {
        if (this.server) this.server.close();

        const listenPort = 8999;
        this.server = http.createServer(async (req, res) => {
            const reqUrl = url.parse(req.url, true);
            if (req.method === 'GET' && reqUrl.pathname === new url.URL(this.config.redirectUri).pathname) {
                const code = reqUrl.query.code;
                if (code) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>인증 성공!</h1><p>이 창을 닫고 Homebridge를 재시작해주세요.</p>');
                    this.log.info('인증 코드를 수신했습니다. 토큰을 발급받습니다...');
                    try {
                        await this.smartthings.getInitialTokens(code);
                        this.log.info('최초 토큰 발급 완료! Homebridge를 재시작하면 장치가 연동됩니다.');
                        if (this.server) this.server.close();
                    } catch (e) {
                        this.log.error('토큰 발급 중 오류:', e.message);
                    }
                } else {
                    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end('<h1>인증 실패</h1><p>URL에서 인증 코드를 찾을 수 없습니다.</p>');
                }
            } else {
                res.writeHead(404).end();
            }
        }).listen(listenPort, () => {
            const scope = 'r:devices:* x:devices:*';
            const authUrl = `https://api.smartthings.com/oauth/authorize?client_id=${this.config.clientId}&scope=${encodeURIComponent(scope)}&response_type=code&redirect_uri=${encodeURIComponent(this.config.redirectUri)}`;
            this.log.warn('====================[ 스마트싱스 인증 필요 ]====================');
            this.log.warn(`인증 서버가 포트 ${listenPort}에서 실행 중입니다. 아래 URL에 접속하여 권한을 허용해주세요.`);
            this.log.warn(`인증 URL: ${authUrl}`);
            this.log.warn('================================================================');
        });
        this.server.on('error', (e) => { this.log.error(`인증 서버 오류: ${e.message}`); });
    }

    configureAccessory(accessory) {
        this.log.info(`캐시된 액세서리 불러오기: ${accessory.displayName}`);
        this.accessories.push(accessory);
    }

    async discoverDevices() {
        this.log.info('SmartThings에서 장치 목록을 가져오는 중...');
        try {
            const stDevices = await this.smartthings.getDevices();
            this.log.info(`총 ${stDevices.length}개의 SmartThings 장치를 발견했습니다.`);

            for (const configDevice of this.config.devices) {
                const targetLabel = normalizeKorean(configDevice.deviceLabel);
                const foundDevice = stDevices.find(stDevice => normalizeKorean(stDevice.label) === targetLabel);
                if (foundDevice) {
                    this.log.info(`'${configDevice.deviceLabel}' 장치를 찾았습니다. HomeKit에 추가/갱신합니다.`);
                    this.addOrUpdateAccessory(foundDevice, configDevice);
                } else {
                    this.log.warn(`'${configDevice.deviceLabel}'에 해당하는 장치를 SmartThings에서 찾지 못했습니다.`);
                }
            }
        } catch (e) {
            this.log.error('장치 검색 중 오류가 발생했습니다:', e.message);
        }
    }

    addOrUpdateAccessory(device, configDevice) {
        const uuid = UUIDGen.generate(device.deviceId);
        let accessory = this.accessories.find(acc => acc.UUID === uuid);

        if (accessory) {
            this.log.info(`기존 액세서리 갱신: ${device.label}`);
            accessory.context.device = device;
            accessory.context.configDevice = configDevice;
        } else {
            this.log.info(`새 액세서리 등록: ${device.label}`);
            accessory = new Accessory(device.label, uuid);
            accessory.context.device = device;
            accessory.context.configDevice = configDevice;
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
            this.accessories.push(accessory);
        }

        accessory.getService(Service.AccessoryInformation)
            .setCharacteristic(Characteristic.Manufacturer, 'Samsung')
            .setCharacteristic(Characteristic.Model, configDevice.model || 'Washer/Dryer')
            .setCharacteristic(Characteristic.SerialNumber, configDevice.serialNumber || device.deviceId)
            .setCharacteristic(Characteristic.FirmwareRevision, pkg.version);

        this.setupValveService(accessory);
    }

    _bindCharacteristic({ service, characteristic, getter }) {
        const char = service.getCharacteristic(characteristic);
        char.removeAllListeners('get');
        char.on('get', async (callback) => {
            try {
                const value = await getter();
                callback(null, value);
            } catch (e) {
                this.log.error(`[${service.displayName}] ${characteristic.displayName} GET 오류: ${e.message}. 기본값으로 처리합니다.`);
                switch (characteristic) {
                    case Characteristic.Active:
                        callback(null, Characteristic.Active.INACTIVE);
                        break;
                    case Characteristic.InUse:
                        callback(null, Characteristic.InUse.NOT_IN_USE);
                        break;
                    case Characteristic.RemainingDuration:
                        callback(null, 0);
                        break;
                    default:
                        callback(e);
                }
            }
        });
    }

    setupValveService(accessory) {
        const deviceId = accessory.context.device.deviceId;
        const service = accessory.getService(Service.Valve) || accessory.addService(Service.Valve, accessory.displayName);
        service.setCharacteristic(Characteristic.ValveType, Characteristic.ValveType.IRRIGATION);

        const ACTIVE_JOB_STATES = new Set([
            'running', 'drying', 'cooling',        // Dryer
            'washing', 'rinse', 'spin', 'detergentSupply' // Washer
        ]);
        const ACTIVE_MACHINE_STATES = new Set(['run', 'on']);

        // 컴포넌트의 작동 상태를 확인하는 헬퍼 함수
        const isComponentActive = (component) => {
            if (!component) return false;
            const opState = component.samsungce?.dryerOperatingState || component.samsungce?.washerOperatingState || component.dryerOperatingState || component.washerOperatingState;
            if (!opState) return false;
            
            const jobState = opState.dryerJobState?.value || opState.washerJobState?.value;
            const machineState = opState.machineState?.value;

            return ACTIVE_JOB_STATES.has(jobState) || ACTIVE_MACHINE_STATES.has(machineState);
        };
        
        // 컴포넌트의 남은 시간을 초 단위로 가져오는 헬퍼 함수
        const getComponentDuration = (component) => {
            if (!component) return 0;
            const opState = component.samsungce?.dryerOperatingState || component.samsungce?.washerOperatingState || component.dryerOperatingState || component.washerOperatingState;
            if (!opState) return 0;

            const remainingMin = opState.remainingTime?.value;
            if (typeof remainingMin === 'number' && remainingMin > 0) {
                return remainingMin * 60;
            }

            const completionTimeStr = opState.completionTime?.value;
            if (completionTimeStr) {
                const remainingSec = Math.round((new Date(completionTimeStr) - Date.now()) / 1000);
                return remainingSec > 0 ? remainingSec : 0;
            }

            const timeStr = opState.remainingTimeStr?.value;
            if (typeof timeStr === 'string' && timeStr.includes(':')) {
                const [minStr, secStr] = timeStr.split(':');
                const min = parseInt(minStr) || 0;
                const sec = parseInt(secStr) || 0;
                return min * 60 + sec;
            }

            return 0;
        };


        this._bindCharacteristic({
            service,
            characteristic: Characteristic.Active,
            getter: async () => {
                const status = await this.smartthings.getStatus(deviceId);
                const mainComp = status.main;
                const subComp = status.sub || status['hca.main']; // 세탁기는 'sub', 건조기는 'hca.main'

                const mainIsActive = isComponentActive(mainComp);
                const subIsActive = isComponentActive(subComp);

                return (mainIsActive || subIsActive)
                    ? Characteristic.Active.ACTIVE
                    : Characteristic.Active.INACTIVE;
            },
        });

        this._bindCharacteristic({
            service,
            characteristic: Characteristic.InUse,
            getter: async () => {
                const status = await this.smartthings.getStatus(deviceId);
                const mainComp = status.main;
                const subComp = status.sub || status['hca.main'];

                const mainIsActive = isComponentActive(mainComp);
                const subIsActive = isComponentActive(subComp);

                return (mainIsActive || subIsActive)
                    ? Characteristic.InUse.IN_USE
                    : Characteristic.InUse.NOT_IN_USE;
            },
        });

        this._bindCharacteristic({
            service,
            characteristic: Characteristic.RemainingDuration,
            getter: async () => {
                const status = await this.smartthings.getStatus(deviceId);
                const mainComp = status.main;
                const subComp = status.sub || status['hca.main'];

                const mainDuration = getComponentDuration(mainComp);
                const subDuration = getComponentDuration(subComp);
                
                // main 우선순위 로직: main이 작동 중이면 main 시간을, 그렇지 않으면 sub 시간을 반환
                if (mainDuration > 0) {
                    return mainDuration;
                }
                if (subDuration > 0) {
                    return subDuration;
                }

                return 0;
            },
        });
    }
}
