import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/client/api/client.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/client/api/client.ts')>()),
  apiFetch: vi.fn(() => Promise.resolve([])),
}));

import { apiFetch } from '../src/client/api/client.ts';
import { tokenSignal } from '../src/client/state/auth-state.ts';
import {
  registerDashboardEffects,
  selectedPeriodSignal,
  selectedBranchSignal,
} from '../src/client/state/dashboard-state.ts';
import { atTenant } from './helpers/client-route.ts';

const calls = (fragment: string): number =>
  vi.mocked(apiFetch).mock.calls.filter(([endpoint]) => endpoint.includes(fragment)).length;

describe('Recargas del dashboard (#7)', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    vi.mocked(apiFetch).mockClear();
  });

  it('carga una vez al entrar, una vez el resumen por filtro y las sucursales solo por tenant', () => {
    tokenSignal.value = 'token';
    atTenant('kiosco');
    selectedPeriodSignal.value = 'week';
    selectedBranchSignal.value = '';
    dispose = registerDashboardEffects();
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(1);

    vi.mocked(apiFetch).mockClear();
    selectedPeriodSignal.value = 'today';
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(0);

    vi.mocked(apiFetch).mockClear();
    selectedBranchSignal.value = 'branch-central';
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(0);

    vi.mocked(apiFetch).mockClear();
    atTenant('almacen');
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(1);
  });
});
