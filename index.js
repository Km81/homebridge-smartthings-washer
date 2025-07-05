// Samsung Air Conditioner & Washer/Dryer Homebridge Plugin
// Version 1.1.0 (Component Priority & Multi-Status Support)
'use strict';

const tls = require('tls');
const fs = require('fs');
const { constants } = require('crypto');

let HAP;
let Service, Characteristic;

const PLUGIN_NAME = 'homebridge-samsung-ac';
const PLATFORM_NAME = 'SamsungACPlatform';

const CONSTANTS = {
    API_PORT: 8888,
    API_DEVICES_PATH: '/devices',
    PLUGIN_VERSION: '1.1.0',
    DEFAULT_RETRY_ATTEMPTS: 3,
    DEFAULT_CACHE_DURATION_MS: 30000,
    DEFAULT_TIMEOUT_MS: 5000,
    POWER: { ON: 'On', OFF: 'Off' },
    SWING: { UP_DOWN: 'Up_And_Low', FIX: 'Fix' },
    COMFORT: { NANO_ON: 'Comode_Nano', NANO_OFF: 'Comode_Off' },
    AUTOCLEAN: { ON: 'Autoclean_On', OFF: 'Autoclean_Off' },
    MODE: { COOL: 'Cool', DRY: 'Dry', WIND: 'Wind' },
};

module.exports = (homebridge) => {
    HAP = homebridge.hap;
    Service = HAP.Service;
    Characteristic = HAP.Characteristic;
    homebridge.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, SamsungACPlatform);
};

class SamsungACPlatform {
    constructor(log, config, api) {
        this.log = log;
        this.config = config;
        this.api = api;
        this.accessories = [];

        if (!config) {
            this.log.warn('No configuration found. Plugin disabled.');
            return;
        }

        if (api) {
            this.api.on('didFinishLaunching', this.initializeDevices.bind(this));
        }
    }

    async initializeDevices() {
        // Assume single device config
        const deviceId = this.config.deviceId;
        const token = this.config.pat;

        const data = await fetchStatus(deviceId, token);
        if (!data) {
            this.log.error('Failed to retrieve device status');
            return;
        }

        const accessory = new HAP.Accessory('Samsung Device', HAP.uuid.generate(deviceId));
        const service = accessory.addService(Service.HeaterCooler, 'AC');

        const status = extractBestComponentStatus(data);

        service.getCharacteristic(Characteristic.CurrentHeaterCoolerState)
            .on('get', callback => {
                const state = mapJobStateToCurrentState(status.jobState);
                this.log.info(`Current state: ${state}`);
                callback(null, state);
            });

        service.getCharacteristic(Characteristic.CoolingThresholdTemperature)
            .on('get', callback => {
                callback(null, status.remainingMinutes || 0);
            });

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
}

function extractBestComponentStatus(data) {
    const components = ['main', 'hca.main', 'sub'];
    let selected = null;
    for (const key of components) {
        if (!data.components[key]) continue;
        const c = data.components[key];
        const jobState = c['dryerOperatingState']?.dryerJobState?.value ||
                         c['washerOperatingState']?.washerJobState?.value ||
                         c['samsungce.dryerOperatingState']?.dryerJobState?.value ||
                         c['samsungce.washerOperatingState']?.washerJobState?.value;
        const opState = c['samsungce.dryerOperatingState']?.operatingState?.value ||
                         c['samsungce.washerOperatingState']?.operatingState?.value;
        const remaining = c['samsungce.dryerOperatingState']?.remainingTime?.value ||
                          c['samsungce.washerOperatingState']?.remainingTime?.value;
        const timeStr = c['samsungce.dryerOperatingState']?.remainingTimeStr?.value ||
                         c['samsungce.washerOperatingState']?.remainingTimeStr?.value;
        const completion = c['dryerOperatingState']?.completionTime?.value ||
                           c['washerOperatingState']?.completionTime?.value;

        if (jobState || opState || remaining || timeStr || completion) {
            selected = {
                component: key,
                jobState,
                opState,
                remainingMinutes: remaining,
                timeStr,
                completion,
            };
            break;
        }
    }
    return selected || {};
}

function mapJobStateToCurrentState(state) {
    switch (state) {
        case 'drying':
        case 'washing':
        case 'rinse':
        case 'spin':
        case 'run':
            return 2; // Heating or Cooling
        case 'none':
        case 'ready':
        case 'stop':
            return 0; // Inactive
        default:
            return 1; // Idle
    }
}

async function fetchStatus(deviceId, token) {
    const url = `https://api.smartthings.com/v1/devices/${deviceId}/status`;
    try {
        const res = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        return await res.json();
    } catch (e) {
        console.error('Fetch error:', e);
        return null;
    }
}
