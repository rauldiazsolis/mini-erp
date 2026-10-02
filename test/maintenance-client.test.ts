import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  enterMaintenance,
  isMaintenanceResponse,
  maintenanceSignal,
  noteMaintenanceResponse,
  resetMaintenance,
} from '../src/client/state/maintenance-state.ts';
import { apiFetch, ApiError } from '../src/client/api/client.ts';
import { fetchProfile, logout, tokenSignal } from '../src/client/state/auth-state.ts';

const originalFetch = globalThis.fetch;

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetMaintenance();
  logout();
  vi.useRealTimers();
});

describe('mantenimiento en el cliente (#47)', () => {
  it('reconoce solo el 503 de mantenimiento', () => {
    expect(isMaintenanceResponse(503, { code: 'maintenance', error: 'x' })).toBe(true);
    expect(isMaintenanceResponse(503, { error: 'otra cosa' })).toBe(false);
    expect(isMaintenanceResponse(500, { code: 'maintenance' })).toBe(false);
    expect(isMaintenanceResponse(503, 'texto')).toBe(false);
  });

  it('apiFetch prende el aviso con un 503 de mantenimiento y tira el error igual', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, { code: 'maintenance', error: 'actualizando' }));
    await expect(apiFetch('auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(maintenanceSignal.value).toBe(true);
  });

  it('apiFetch no prende el aviso con otro 503', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, { error: 'caído' }));
    await expect(apiFetch('auth/me')).rejects.toBeInstanceOf(ApiError);
    expect(maintenanceSignal.value).toBe(false);
  });

  it('noteMaintenanceResponse lo detecta en un fetch suelto', async () => {
    await noteMaintenanceResponse(jsonResponse(503, { code: 'maintenance', error: 'x' }));
    expect(maintenanceSignal.value).toBe(true);
  });

  it('vuelve sola: con /health 200 recarga, y no antes', async () => {
    vi.useFakeTimers();
    const estados = [503, 200];
    const fetchHealth = vi.fn(() => Promise.resolve(estados.shift() ?? 200));
    const reload = vi.fn();
    enterMaintenance({ fetchHealth, reload, intervalMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(reload).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10000);
    expect(fetchHealth).toHaveBeenCalledTimes(2);
  });

  it('fetchProfile conserva la sesión con un 503 y la cierra con un 401', async () => {
    tokenSignal.value = 'token-de-prueba';
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(503, { code: 'maintenance', error: 'x' }));
    expect(await fetchProfile()).toBe(false);
    expect(tokenSignal.value).toBe('token-de-prueba');

    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'sesión vencida' }));
    expect(await fetchProfile()).toBe(false);
    expect(tokenSignal.value).toBeNull();
  });
});
