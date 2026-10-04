import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registersSignal,
  createRegisterModalOpenSignal,
  createRegisterFormSignal,
  createRegisterErrorSignal,
  revealedKeySignal,
  fetchRegisters,
  openCreateRegisterModal,
  submitCreateRegister,
  rotateRegisterKey,
  transferRegister,
  unbindRegister,
  deactivateRegister,
  dismissRevealedKey,
} from '../src/client/state/registers-state.ts';
import { settingsBranchesSignal } from '../src/client/state/settings-state.ts';
import { tokenSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import type { RegisterItem } from '../src/shared/register-types.ts';
import { atTenant } from './helpers/client-route.ts';

const caja: RegisterItem = {
  id: 'reg-1',
  name: 'Caja 1',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
  active: true,
  deviceId: 'dev-a',
  boundAt: '2026-10-03T12:00:00.000Z',
  lastSeenAt: '2026-10-03T13:00:00.000Z',
  keyPrefix: 'mpos_ab12',
  createdAt: '2026-10-01T12:00:00.000Z',
  otherDevices: [{ deviceId: 'dev-b', firstSeenAt: '2026-10-03T12:30:00.000Z', lastSeenAt: '2026-10-03T12:30:00.000Z' }],
};

type Call = { url: string; method: string; body: unknown };

describe('estado de las cajas del POS (#21)', () => {
  let calls: Call[];

  beforeEach(() => {
    tokenSignal.value = 'mock-token';
    userTenantsSignal.value = [{ tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' }];
    atTenant('tienda-test');
    settingsBranchesSignal.value = [{ id: 'b-1', code: 'CENTRAL', name: 'Casa Central', createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z' }];
    registersSignal.value = [caja];
    revealedKeySignal.value = null;
    createRegisterModalOpenSignal.value = false;
    calls = [];
    vi.stubGlobal('confirm', vi.fn(() => true));
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined });
      const body = method === 'GET' ? [caja] : url.endsWith('/rotate-key') || method === 'POST' ? { id: 'reg-2', rawKey: 'mpos_nueva', key: 'mpos_nueva', keyPrefix: 'mpos_nu' } : { success: true };
      return Promise.resolve(new Response(JSON.stringify(body), { status: method === 'POST' && url.endsWith('/pos-registers') ? 201 : 200, headers: { 'content-type': 'application/json' } }));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('fetchRegisters trae las cajas del comercio', async () => {
    registersSignal.value = [];
    await fetchRegisters();
    expect(calls).toEqual([{ url: '/api/tenants/tienda-test/pos-registers', method: 'GET', body: undefined }]);
    expect(registersSignal.value).toEqual([caja]);
  });

  it('crear una caja manda sucursal en mayúsculas, revela la key y recarga', async () => {
    openCreateRegisterModal();
    expect(createRegisterModalOpenSignal.value).toBe(true);
    expect(createRegisterFormSignal.value).toEqual({ name: 'Caja 2', branch: 'CENTRAL', pointOfSale: 'Caja 2' });
    createRegisterFormSignal.value = { name: 'Caja Patio', branch: 'central', pointOfSale: 'Patio' };
    await submitCreateRegister();
    expect(calls[0]).toEqual({ url: '/api/tenants/tienda-test/pos-registers', method: 'POST', body: { name: 'Caja Patio', branch: 'CENTRAL', pointOfSale: 'Patio' } });
    expect(calls[1]?.method).toBe('GET');
    expect(revealedKeySignal.value).toEqual({ registerName: 'Caja Patio', rawKey: 'mpos_nueva' });
    expect(createRegisterModalOpenSignal.value).toBe(false);
    dismissRevealedKey();
    expect(revealedKeySignal.value).toBeNull();
  });

  it('con campos vacíos no llama a la API', async () => {
    openCreateRegisterModal();
    createRegisterFormSignal.value = { name: '', branch: 'CENTRAL', pointOfSale: 'Caja 2' };
    await submitCreateRegister();
    expect(createRegisterErrorSignal.value).toBe('Completá todos los campos');
    expect(calls).toEqual([]);
  });

  it('rotar la key la revela; pasar, desligar y desactivar pegan a su ruta y recargan', async () => {
    await rotateRegisterKey(caja);
    expect(calls[0]).toMatchObject({ url: '/api/tenants/tienda-test/pos-registers/reg-1/rotate-key', method: 'POST' });
    expect(revealedKeySignal.value).toEqual({ registerName: 'Caja 1', rawKey: 'mpos_nueva' });
    calls = [];
    await transferRegister(caja, 'dev-b');
    expect(calls[0]).toEqual({ url: '/api/tenants/tienda-test/pos-registers/reg-1/transfer', method: 'POST', body: { deviceId: 'dev-b' } });
    expect(calls[1]?.method).toBe('GET');
    calls = [];
    await unbindRegister(caja);
    expect(calls[0]).toMatchObject({ url: '/api/tenants/tienda-test/pos-registers/reg-1/unbind', method: 'POST' });
    calls = [];
    await deactivateRegister(caja);
    expect(calls[0]).toMatchObject({ url: '/api/tenants/tienda-test/pos-registers/reg-1', method: 'DELETE' });
  });

  it('si no confirma, no hace nada', async () => {
    vi.stubGlobal('confirm', vi.fn(() => false));
    await deactivateRegister(caja);
    expect(calls).toEqual([]);
  });
});
