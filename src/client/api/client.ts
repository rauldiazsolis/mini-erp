import { enterMaintenance, isMaintenanceResponse } from '../state/maintenance-state.ts';

export class ApiError extends Error {
  public status: number;
  public data: unknown;

  constructor(status: number, message: string, data?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

export type RequestOptions = {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  body?: unknown;
  token?: string | null;
  headers?: Record<string, string>;
};

let onUnauthorizedCallback: (() => void) | null = null;

export function setOnUnauthorized(callback: () => void): void {
  onUnauthorizedCallback = callback;
}

export async function apiFetch<T>(endpoint: string, options?: RequestOptions): Promise<T> {
  const method = options?.method ?? 'GET';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers ?? {}),
  };

  if (options?.token) {
    headers['Authorization'] = `Bearer ${options.token}`;
  }

  const url = endpoint.startsWith('http') || endpoint.startsWith('/') ? endpoint : `/api/${endpoint}`;

  const res = await fetch(url, {
    method,
    headers,
    body: options?.body !== undefined ? JSON.stringify(options.body) : null,
  });

  // Solo un pedido con sesión puede tener la sesión vencida: un 401 del login o de un link no cierra nada (#19)
  if (res.status === 401 && options?.token) {
    if (onUnauthorizedCallback) {
      onUnauthorizedCallback();
    }
  }

  const contentType = res.headers.get('content-type') ?? '';
  let responseData: unknown;
  if (contentType.includes('application/json')) {
    responseData = await res.json();
  } else {
    responseData = await res.text();
  }

  // Mantenimiento (#47): la pantalla de actualización; el error sigue su camino
  if (isMaintenanceResponse(res.status, responseData)) {
    enterMaintenance();
  }

  if (!res.ok) {
    let errorMessage = `HTTP ${String(res.status)}: ${res.statusText}`;
    if (responseData && typeof responseData === 'object' && 'error' in responseData) {
      const errObj = responseData;
      if (typeof errObj.error === 'string') {
        errorMessage = errObj.error;
      }
    }
    throw new ApiError(res.status, errorMessage, responseData);
  }

  return responseData as T;
}
