/**
 * API Test Client
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';

export interface ApiClientConfig {
  baseURL: string;
  timeout?: number;
  headers?: Record<string, string>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export class ApiTestClient {
  private client: AxiosInstance;
  private authTokens?: AuthTokens;

  constructor(config: ApiClientConfig) {
    this.client = axios.create({
      baseURL: config.baseURL,
      timeout: config.timeout || 10000,
      headers: {
        'Content-Type': 'application/json',
        ...config.headers
      }
    });

    // Request interceptor for auth
    this.client.interceptors.request.use(
      (config) => {
        if (this.authTokens && config.headers) {
          config.headers.Authorization = `Bearer ${this.authTokens.accessToken}`;
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        console.error('API Error:', {
          url: error.config?.url,
          method: error.config?.method,
          status: error.response?.status,
          data: error.response?.data
        });
        return Promise.reject(error);
      }
    );
  }

  setAuthTokens(tokens: AuthTokens): void {
    this.authTokens = tokens;
  }

  clearAuthTokens(): void {
    this.authTokens = undefined;
  }

  async get<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.get<T>(url, config);
  }

  async post<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.post<T>(url, data, config);
  }

  async put<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.put<T>(url, data, config);
  }

  async patch<T = any>(url: string, data?: any, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.patch<T>(url, data, config);
  }

  async delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    return this.client.delete<T>(url, config);
  }

  // Helper methods for common operations
  async login(email: string, password: string): Promise<AuthTokens> {
    const response = await this.post<AuthTokens>('/auth/login', { email, password });
    this.setAuthTokens(response.data);
    return response.data;
  }

  async register(userData: any): Promise<any> {
    const response = await this.post('/auth/register', userData);
    return response.data;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await this.get('/health');
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  // Utility methods
  async waitForService(maxAttempts = 30, delayMs = 1000): Promise<void> {
    for (let i = 0; i < maxAttempts; i++) {
      if (await this.healthCheck()) {
        return;
      }
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
    throw new Error('Service did not become healthy in time');
  }
}

// Factory function for creating clients
export function createApiClient(baseURL: string): ApiTestClient {
  return new ApiTestClient({ baseURL });
}

// Pre-configured clients for each service
export const clients = {
  gateway: (baseURL: string) => createApiClient(baseURL),
  user: (baseURL: string) => createApiClient(`${baseURL}/users`),
  order: (baseURL: string) => createApiClient(`${baseURL}/orders`),
  payment: (baseURL: string) => createApiClient(`${baseURL}/payments`),
  reskflow: (baseURL: string) => createApiClient(`${baseURL}/deliveries`),
  merchant: (baseURL: string) => createApiClient(`${baseURL}/merchants`),
  notification: (baseURL: string) => createApiClient(`${baseURL}/notifications`)
};