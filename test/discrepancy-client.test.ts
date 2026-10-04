import { describe, it, expect, beforeEach, vi } from 'vitest';
import { movementTone, movementLabel } from '../src/client/state/movement-style.ts';
import {
  discrepanciesSignal, discrepancyDrawerOpenSignal, dismissNoteSignal, fetchDiscrepancies, dismissDiscrepancy, openDiscrepancies,
  type DiscrepancyItem,
} from '../src/client/state/discrepancy-state.ts';
import { userTenantsSignal } from '../src/client/state/auth-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

const originalFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item: DiscrepancyItem = { id: 'd1', kind: 'unknown-customer', message: 'La venta…', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950, originBranch: 'CENTRAL', originPos: 'Caja 1', deviceId: 'dev', createdAt: '2026-10-02T12:00:00.000Z' };

beforeEach(() => {
  globalThis.fetch = originalFetch;
  setHistoryForTests(null);
  freshSession('tok');
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T', status: 'active', role: 'owner' }];
  atTenant('t1', 'usuarios');
});

describe('extracto por signo (#2)', () => {
  it('positivo sube la deuda, negativo la baja, sin importar el tipo', () => {
    expect(movementTone(500)).toBe('debit');
    expect(movementTone(-500)).toBe('credit');
    expect(movementTone(0)).toBe('neutral');
    expect(movementLabel('payment-void')).toBe('Anulación de cobranza');
    expect(movementLabel('payment')).toBe('Pago / Cobranza');
    expect(movementLabel('sale')).toBe('Compra en POS (Cuenta Corriente)');
    expect(movementLabel('adjustment')).toBe('Ajuste de saldo');
    expect(movementLabel('interest')).toBe('Interés');
    expect(movementLabel('opening')).toBe('Saldo inicial');
    expect(movementLabel('credit_adjustment')).toBe('Credit adjustment');
  });
});

describe('discrepancias en el admin (#2)', () => {
  it('al entrar a Clientes trae las abiertas', async () => {
    globalThis.fetch = vi.fn((input: RequestInfo | URL) =>
      Promise.resolve(json(200, (input instanceof Request ? input.url : input.toString()).endsWith('/discrepancies') ? [item] : [])));
    atTenant('t1', 'clientes');
    await vi.waitFor(() => { expect(discrepanciesSignal.value).toHaveLength(1); });
    await fetchDiscrepancies();
    expect(discrepanciesSignal.value).toHaveLength(1);
  });

  it('descartar manda el motivo y, en Clientes, la lista vuelve sin ella', async () => {
    let dismissed = false;
    const posts: Array<[string, RequestInit | undefined]> = [];
    globalThis.fetch = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : input.toString();
      if (init?.method === 'POST') {
        posts.push([url, init]);
        dismissed = true;
        return Promise.resolve(json(200, { ok: true }));
      }
      return Promise.resolve(json(200, url.endsWith('/discrepancies') && !dismissed ? [item] : []));
    });
    atTenant('t1', 'clientes');
    await vi.waitFor(() => { expect(discrepanciesSignal.value).toHaveLength(1); });
    openDiscrepancies();
    dismissNoteSignal.value = 'Era una prueba';
    await dismissDiscrepancy('d1');
    const [url, init] = posts[0] ?? ['', undefined];
    expect(url).toBe('/api/tenants/t1/discrepancies/d1/dismiss');
    expect(JSON.parse(typeof init?.body === 'string' ? init.body : '{}')).toEqual({ note: 'Era una prueba' });
    expect(discrepanciesSignal.value).toEqual([]);
    expect(discrepancyDrawerOpenSignal.value).toBe(false);
  });

  it('descartar deja viejas las discrepancias y los clientes', async () => {
    queryClient.setQueryData(tenantKey('t1', 'discrepancies'), [item]);
    queryClient.setQueryData(tenantKey('t1', 'customers'), []);
    globalThis.fetch = vi.fn(() => Promise.resolve(json(200, { ok: true })));
    await dismissDiscrepancy('d1');
    expect(queryClient.getQueryState(tenantKey('t1', 'discrepancies'))?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(tenantKey('t1', 'customers'))?.isInvalidated).toBe(true);
  });
});
