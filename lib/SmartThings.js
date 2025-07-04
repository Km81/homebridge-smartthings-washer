// SmartThings API Library v1.0.0 (for Washer/Dryer)
const axios = require('axios');
const { LRUCache } = require('lru-cache');

class SmartThings {
  constructor(token, log) {
    this.log = log || console.log;

    this.client = axios.create({
      baseURL: 'https://api.smartthings.com/v1',
      headers: { 'Authorization': `Bearer ${token}` },
      timeout: 10000,
    });

    this.cache = new LRUCache({
      max: 100,
      ttl: 1000 * 5, // 상태 확인 주기가 길 수 있으므로 캐시 시간 5초로 연장
    });

    this.pendingPromises = new Map();
  }

  async getDevices() {
    try {
      const res = await this.client.get('/devices');
      return res.data.items || [];
    } catch (e) {
      this.log.error('디바이스 조회 오류:', e.message);
      throw e;
    }
  }

  async getStatus(deviceId) {
    const cachedData = this.cache.get(deviceId);
    if (cachedData) {
      return cachedData;
    }

    if (this.pendingPromises.has(deviceId)) {
      return this.pendingPromises.get(deviceId);
    }

    const promise = this.client.get(`/devices/${deviceId}/status`)
      .then(res => {
        const data = res.data.components.main;
        this.cache.set(deviceId, data);
        return data;
      })
      .catch(e => {
        this.log.error(`[${deviceId}] 상태 조회 실패:`, e.message);
        throw new Error(`[${deviceId}] 상태 조회에 실패했습니다.`);
      })
      .finally(() => {
        this.pendingPromises.delete(deviceId);
      });

    this.pendingPromises.set(deviceId, promise);
    return promise;
  }
}

module.exports = SmartThings;
