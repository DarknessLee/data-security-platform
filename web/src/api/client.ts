import axios, { type AxiosRequestConfig } from 'axios';
import { ElMessage } from 'element-plus';

export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
  [key: string]: unknown;
}

export interface ApiResult<T> {
  data: T;
  meta?: ApiMeta;
}

const instance = axios.create({
  baseURL: '/api',
  timeout: 20000,
  headers: { 'Content-Type': 'application/json' },
});

instance.interceptors.request.use((config) => {
  const token = localStorage.getItem('datasec_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

instance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const message = error?.response?.data?.message ?? error?.message ?? '网络异常，请稍后重试';
    if (status === 401) {
      localStorage.removeItem('datasec_token');
      localStorage.removeItem('datasec_user');
      if (!location.pathname.startsWith('/login')) {
        ElMessage.error('登录状态已失效，请重新登录');
        location.href = `/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
      }
    } else if (status === 403) {
      ElMessage.error(message || '当前角色无权执行该操作');
    } else {
      ElMessage.error(message);
    }
    return Promise.reject(new Error(message));
  },
);

async function get<T>(url: string, params?: Record<string, unknown>): Promise<ApiResult<T>> {
  const res = await instance.get(url, { params });
  const body = res.data as { data: T; meta?: ApiMeta };
  return { data: body.data, meta: body.meta };
}

async function post<T>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<ApiResult<T>> {
  const res = await instance.post(url, data, config);
  const body = res.data as { data: T; meta?: ApiMeta };
  return { data: body.data, meta: body.meta };
}

async function put<T>(url: string, data?: unknown): Promise<ApiResult<T>> {
  const res = await instance.put(url, data);
  const body = res.data as { data: T; meta?: ApiMeta };
  return { data: body.data, meta: body.meta };
}

async function del<T>(url: string): Promise<ApiResult<T>> {
  const res = await instance.delete(url);
  const body = res.data as { data: T; meta?: ApiMeta };
  return { data: body.data, meta: body.meta };
}

/** 下载类接口（CSV 导出）：带鉴权头取 blob 并触发浏览器下载 */
async function download(url: string, params: Record<string, unknown>, filename: string): Promise<void> {
  const res = await instance.get(url, { params, responseType: 'blob' });
  const blob = new Blob([res.data as BlobPart], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);
}

export const http = { get, post, put, del, download, instance };
