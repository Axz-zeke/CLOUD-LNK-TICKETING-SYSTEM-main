/**
 * Centralized API Client Layer
 * Standardizes request execution, error normalization, and response parsing.
 */

export interface ApiResponse<T = any> {
  data?: T;
  error?: string;
  code?: string;
  status: number;
  ok: boolean;
}

export class ApiError extends Error {
  status: number;
  code?: string;
  data?: any;

  constructor(message: string, status: number, code?: string, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const res = await fetch(endpoint, {
      ...options,
      headers,
    });

    let json: any = null;
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        json = await res.json();
      } catch {
        json = null;
      }
    }

    if (!res.ok) {
      const errorMsg =
        json?.error ||
        json?.message ||
        (res.status === 403
          ? 'Permission Denied: Only department staff or Superadmins can perform this action.'
          : res.status === 401
          ? 'Session expired. Please log in again.'
          : res.status === 404
          ? 'Resource not found.'
          : `HTTP error ${res.status}`);

      if (
        res.status === 401 &&
        typeof window !== 'undefined' &&
        window.location.pathname !== '/login'
      ) {
        window.location.href = `/login?from=${encodeURIComponent(window.location.pathname)}`;
      }

      return {
        error: errorMsg,
        code: json?.code,
        status: res.status,
        ok: false,
        data: json,
      };
    }

    return {
      data: json as T,
      status: res.status,
      ok: true,
    };
  } catch (err: any) {
    const errorMsg = err?.message || 'Network error communicating with server.';
    return {
      error: errorMsg,
      status: 0,
      ok: false,
    };
  }
}

export const apiClient = {
  get: <T>(endpoint: string, init?: RequestInit) =>
    request<T>(endpoint, { ...init, method: 'GET' }),
  post: <T>(endpoint: string, body?: any, init?: RequestInit) =>
    request<T>(endpoint, {
      ...init,
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }),
  patch: <T>(endpoint: string, body?: any, init?: RequestInit) =>
    request<T>(endpoint, {
      ...init,
      method: 'PATCH',
      body: body ? JSON.stringify(body) : undefined,
    }),
  put: <T>(endpoint: string, body?: any, init?: RequestInit) =>
    request<T>(endpoint, {
      ...init,
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(endpoint: string, init?: RequestInit) =>
    request<T>(endpoint, { ...init, method: 'DELETE' }),
};
