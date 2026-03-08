import axios, { AxiosError } from "axios";

export const http = axios.create({ timeout: 60_000 }); // 60s timeout

http.interceptors.response.use(
  (r) => r,
  async (error: AxiosError) => {
    const config: any = error.config ?? {};
    const status = error.response?.status ?? 0;

    // Retry on specific HTTP status codes OR network errors
    const isNetworkError = error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED';
    const shouldRetry = [429, 500, 502, 503, 504].includes(status) || isNetworkError;

    const maxRetries = config.__retryCountMax ?? 3;
    const retryCount = (config.__retryCount ?? 0) + 1;

    if (shouldRetry && retryCount <= maxRetries) {
      config.__retryCount = retryCount;
      const backoffMs = Math.min(1000 * 2 ** (retryCount - 1), 10_000);
      console.log(`[HTTP Retry] Attempt ${retryCount}/${maxRetries} after ${backoffMs}ms for ${config.url} (${error.code || status})`);
      await new Promise((res) => setTimeout(res, backoffMs));
      return http(config);
    }
    return Promise.reject(error);
  }
);
