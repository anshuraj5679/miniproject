import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';

const API_BASE_URL = process.env.NEXT_PUBLIC_APP_API_BASE_URL || '/api';

class ApiClient {
  private client: AxiosInstance;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor to include auth token
    this.client.interceptors.request.use(
      (config) => {
        if (typeof window !== 'undefined') {
          const token = localStorage.getItem('auth_token');
          if (token) {
            config.headers.Authorization = `Bearer ${token}`;
          }
        }
        return config;
      },
      (error) => Promise.reject(error)
    );

    // Expired Supabase access token: refresh once and replay the request.
    this.client.interceptors.response.use(
      (response) => response,
      async (error) => {
        const original = error?.config as (AxiosRequestConfig & { _authRetried?: boolean }) | undefined;
        if (typeof window === 'undefined' || error?.response?.status !== 401 || !original || original._authRetried) {
          return Promise.reject(error);
        }
        original._authRetried = true;
        const { refreshAccessToken } = await import('@/lib/auth-client');
        const { useAuthStore } = await import('@/lib/store/auth-store');
        const freshToken = await refreshAccessToken().catch(() => null);
        if (!freshToken) return Promise.reject(error);
        await useAuthStore.getState().setToken(freshToken);
        return this.client.request(original);
      }
    );
  }

  async get<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.get<T>(path, config);
    return response.data;
  }

  async post<T>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(path, data, config);
    return response.data;
  }

  async put<T>(path: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.put<T>(path, data, config);
    return response.data;
  }

  async delete<T>(path: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.delete<T>(path, config);
    return response.data;
  }

  // For file uploads
  async postFormData<T>(path: string, formData: FormData, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.client.post<T>(path, formData, {
      ...config,
      headers: {
        ...config?.headers,
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }
}

export const apiClient = new ApiClient();

