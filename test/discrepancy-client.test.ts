import { describe, it, expect, beforeEach, vi } from 'vitest';
import { movementTone, movementLabel } from '../src/client/state/movement-style.ts';
import {
  discrepanciesSignal, discrepancyDrawerOpenSignal, dismissNoteSignal, fetchDiscrepancies, dismissDiscrepancy, openDiscrepancies,
  type DiscrepancyItem,
} from '../src/client/state/discrepancy-state.ts';
import { tokenSignal, activeTenantIdSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';

const originalFetch = globalThis.fetch;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const item: DiscrepancyItem = { id: 'd1', kind: 'unknown-customer', message: 'La venta…', customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950, originBranch: 'CENTRAL', originPos: 'Caja 1', deviceId: 'dev', createdAt: '2026-10-02T12:00:00.000Z' };

beforeEach(() => {
  globalThis.fetch = originalFetch;
  tokenSignal.value = 'tok';
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T', status: 'active', role: 'owner' }];
  activeTenantIdSignal.value = 't1';
  discrepanciesSignal.value = [];
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
  it('trae las abiertas', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(json(200, [item]));
    await fetchDiscrepancies();
    expect(discrepanciesSignal.value).toHaveLength(1);
  });

  it('descartar manda el motivo y la saca de la lista', async () => {
    discrepanciesSignal.value = [item];
    openDiscrepancies();
    dismissNoteSignal.value = 'Era una prueba';
    const fetchMock = vi.fn().mockResolvedValueOnce(json(200, { ok: true })).mockResolvedValueOnce(json(200, []));
    globalThis.fetch = fetchMock;
    await dismissDiscrepancy('d1');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/tenants/t1/discrepancies/d1/dismiss');
    expect(JSON.parse(typeof init.body === 'string' ? init.body : '{}')).toEqual({ note: 'Era una prueba' });
    expect(discrepanciesSignal.value).toEqual([]);
    expect(discrepancyDrawerOpenSignal.value).toBe(false);
  });
});
