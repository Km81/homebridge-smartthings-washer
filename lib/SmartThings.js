// lib/SmartThings.js v1.10.0 (Component-Aware Status Fetch)
'use strict';

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { LRUCache } = require('lru-cache');
const axiosRetry = require('axios-retry').default;

class SmartThings {
    constructor(log, api, config) {
        this.log = log;
        this.api = api;
        this.config = config;

        this.tokenPath = path.join(this.api.user.persistPath(), 'smartthings_oauth_token.json');
        this.tokens = null;
        this.isRefreshing = false;
        this.pendingRequests = [];

        this.client = axios.create({
            baseURL: 'https://api.smartthings.com/v1',
            timeout: 10000,
        });

        axiosRetry(this.client, {
            retries: 3,
            retryDelay: (retryCount) => {
                this.log.info(`API 요청 재시도 (${retryCount}번째)...`);
                return retryCount * 1000;
            },
            retryCondition: (error) => {
                const status = error.response?.status;
                return axiosRetry.isNetworkOrIdempotentRequestError(error) || status >= 500 || status === 429;
            }
        });

        this.setupInterceptors();
        this.cache = new LRUCache({ max: 100, ttl: 1000 * 5 });
        this.statusPromises = new Map();
    }

    setupInterceptors() {
        this.client.interceptors.request.use(
            config => {
                if (this.tokens && this.tokens.access_token) {
                    config.headers.Authorization = `Bearer ${this.tokens.access_token}`;
                }
                return config;
            },
            error => Promise.reject(error)
        );

        this.client.interceptors.response.use(
            response => response,
            async error => {
                const originalRequest = error.config;
                if (error.response?.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;

                    if (!this.isRefreshing) {
                        this.isRefreshing = true;
                        try {
                            const newAccessToken = await this.refreshToken();
                            this.isRefreshing = false;
                            this.onRefreshed(null, newAccessToken);
                            originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                            return this.client(originalRequest);
                        } catch (refreshError) {
                            this.isRefreshing = false;
                            this.onRefreshed(refreshError, null);
                            this.log.error('토큰 갱신 최종 실패! 재인증이 필요할 수 있습니다.');
                            return Promise.reject(refreshError);
                        }
                    }

                    return new Promise((resolve, reject) => {
                        this.pendingRequests.push({
                            resolve: (newAccessToken) => {
                                originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
                                resolve(this.client(originalRequest));
                            },
                            reject
                        });
                    });
                }
                return Promise.reject(error);
            }
        );
    }

    onRefreshed(err, newAccessToken) {
        this.pendingRequests.forEach(({ resolve, reject }) => err ? reject(err) : resolve(newAccessToken));
        this.pendingRequests = [];
    }

    async init() {
        try {
            this.tokens = JSON.parse(await fs.readFile(this.tokenPath, 'utf8'));
            this.log.info('저장된 OAuth 토큰을 성공적으로 불러왔습니다.');
            return true;
        } catch (e) {
            this.log.warn('저장된 토큰이 없습니다. 사용자 인증이 필요합니다.');
            return false;
        }
    }

    async getInitialTokens(code) {
        this.log.info('인증 코드를 사용하여 첫 토큰 발급을 시도합니다...');
        const tokenUrl = 'https://api.smartthings.com/oauth/token';
        const authHeader = 'Basic ' + Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');

        try {
            const response = await axios.post(tokenUrl, new URLSearchParams({
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: this.config.redirectUri,
                client_id: this.config.clientId,
            }), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': authHeader,
                },
            });

            await this.saveTokens(response.data);
        } catch (e) {
            this.log.error(`초기 토큰 발급 실패: ${e.response?.status}`, e.response?.data || e.message);
            throw new Error('초기 토큰 발급에 실패했습니다.');
        }
    }

    async refreshToken() {
        if (!this.tokens || !this.tokens.refresh_token) {
            throw new Error('리프레시 토큰이 없어 갱신할 수 없습니다.');
        }

        this.log.info('액세스 토큰 갱신을 시도합니다...');
        const tokenUrl = 'https://api.smartthings.com/oauth/token';
        const authHeader = 'Basic ' + Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');

        try {
            const response = await axios.post(tokenUrl, new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: this.tokens.refresh_token,
            }), {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/x-www-form-urlencoded',
                },
            });
            await this.saveTokens(response.data);
            return this.tokens.access_token;
        } catch (error) {
            this.log.error(`토큰 갱신 실패:`, error.message);
            throw error;
        }
    }

    async saveTokens(tokens) {
        try {
            this.tokens = tokens;
            await fs.writeFile(this.tokenPath, JSON.stringify(tokens, null, 2), 'utf8');
            this.log.info('토큰을 성공적으로 저장/갱신했습니다.');
        } catch (e) {
            this.log.error('토큰 파일 저장 중 심각한 오류 발생:', e.message);
        }
    }

    async getDevices() {
        try {
            const res = await this.client.get('/devices');
            return res.data.items || [];
        } catch (e) {
            this.log.error('디바이스 목록 조회 오류:', e.message);
            throw e;
        }
    }

    async getStatus(deviceId) {
        const cacheKey = `status-${deviceId}`;
        const cachedData = this.cache.get(cacheKey);
        if (cachedData) return cachedData;

        if (this.statusPromises.has(deviceId)) {
            return this.statusPromises.get(deviceId);
        }

        const promise = this.client.get(`/devices/${deviceId}/status`)
            .then(res => {
                const data = res.data.components; // ✅ 전체 컴포넌트 반환
                this.cache.set(cacheKey, data);
                return data;
            })
            .catch(e => {
                this.log.error(`[${deviceId}] 상태 조회 실패:`, e.message);
                throw new Error(`[${deviceId}] 상태 조회에 실패했습니다.`);
            })
            .finally(() => {
                this.statusPromises.delete(deviceId);
            });

        this.statusPromises.set(deviceId, promise);
        return promise;
    }
}

module.exports = SmartThings;
