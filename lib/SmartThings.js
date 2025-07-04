// lib/SmartThings.js v1.0.0 (for Washer)
'use strict';

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { LRUCache } = require('lru-cache');
const axiosRetry = require('axios-retry').default;

// ... (AC 플러그인의 SmartThings.js 코드 전체를 여기에 붙여넣기) ...
// (이전 답변에서 제공한 AC 플러그인의 lib/SmartThings.js v2.2.6 코드와 동일합니다)
// 이 코드는 이미 일반적인 SmartThings 장치를 다루기에 충분히 유연합니다.
class SmartThings {
     constructor(log, api, config) {
         this.log = log;
         this.api = api;
         this.config = config;

         this.tokenPath = path.join(this.api.user.persistPath(), 'smartthings_washer_token.json'); // 파일 이름 변경
         this.tokens = null;
         this.isRefreshing = false;
         this.pendingRequests = [];

         this.client = axios.create({
             baseURL: 'https://api.smartthings.com/v1',
             timeout: 10000,
         });
         
         axiosRetry(this.client, {
             retries: 3,
             retryDelay: (retryCount) => retryCount * 1000,
             retryCondition: (error) => {
                 const status = error.response?.status;
                 return axiosRetry.isNetworkOrIdempotentRequestError(error) || status >= 500 || status === 429;
             }
         });

         this.setupInterceptors();
         this.cache = new LRUCache({ max: 100, ttl: 1000 * 5 });
         this.statusPromises = new Map();
     }
    
    // ... (AC 플러그인의 나머지 SmartThings.js 코드를 여기에 모두 포함)
    // init(), getInitialTokens(), refreshToken(), saveTokens(), getDevices(), getStatus() 등
    // 모든 메서드는 수정 없이 그대로 재사용 가능합니다.
}
module.exports = SmartThings;
