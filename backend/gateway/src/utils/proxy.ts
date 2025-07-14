/**
 * Proxy Utility
 * Handles forwarding requests to backend services
 */

import axios, { AxiosRequestConfig } from 'axios';
import { logger } from './logger';

interface ProxyOptions {
  method: string;
  url: string;
  headers?: any;
  query?: any;
  body?: any;
  timeout?: number;
}

export async function proxyRequest(options: ProxyOptions): Promise<any> {
  const { method, url, headers = {}, query, body, timeout = 30000 } = options;

  // Remove gateway-specific headers
  const forwardHeaders = { ...headers };
  delete forwardHeaders['host'];
  delete forwardHeaders['content-length'];

  const config: AxiosRequestConfig = {
    method: method as any,
    url,
    headers: forwardHeaders,
    params: query,
    data: body,
    timeout,
    validateStatus: () => true // Don't throw on non-2xx status
  };

  try {
    logger.debug('Proxying request', {
      method,
      url,
      query,
      hasBody: !!body
    });

    const response = await axios(config);

    logger.debug('Proxy response', {
      status: response.status,
      url
    });

    // Forward the status code
    if (response.status >= 400) {
      const error: any = new Error(response.data?.message || 'Service error');
      error.status = response.status;
      error.data = response.data;
      throw error;
    }

    return response.data;
  } catch (error: any) {
    logger.error('Proxy request failed', {
      error: error.message,
      url,
      method
    });

    // If it's already a formatted error, throw it
    if (error.status) {
      throw error;
    }

    // Otherwise, wrap it
    const wrappedError: any = new Error('Service unavailable');
    wrappedError.status = 503;
    wrappedError.originalError = error.message;
    throw wrappedError;
  }
}