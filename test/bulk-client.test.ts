import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  activeBulkTabSignal,
  bulkPriceActionSignal,
  bulkPriceValueSignal,
  bulkPriceCategorySignal,
  bulkPriceRoundingSignal,
  bulkPricePreviewSignal,
  previewBulkPrices,
  applyBulkPrices,
  bulkInterestPercentSignal,
  bulkInterestDescriptionSignal,
  bulkInterestMinBalanceSignal,
  bulkInterestPreviewSignal,
  previewBulkInterests,
  applyBulkInterests,
} from '../src/client/state/bulk-state.ts';
import {
  tokenSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { atTenant } from './helpers/client-route.ts';

const reply = (body: unknown): Promise<Response> =>
  Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('Módulo de Operaciones Masivas (Etapa 4.4)', () => {
  beforeEach(() => {
    bulkPriceActionSignal.value = 'percentage';
    bulkPriceValueSignal.value = 15;
    bulkPriceCategorySignal.value = 'all';
    bulkPriceRoundingSignal.value = '10';
    bulkPricePreviewSignal.value = null;

    bulkInterestPercentSignal.value = 5;
    bulkInterestDescriptionSignal.value = 'Interés mensual';
    bulkInterestMinBalanceSignal.value = 1000;
    bulkInterestPreviewSignal.value = null;

    tokenSignal.value = 'mock-token';
    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    atTenant('tienda-test');
    vi.restoreAllMocks();
  });

  describe('Conmutación de Pestañas', () => {
    it('inicia en precios y permite cambiar a intereses e io', () => {
      expect(activeBulkTabSignal.value).toBe('prices');

      atTenant('tienda-test', 'masivas/intereses');
      expect(activeBulkTabSignal.value).toBe('interests');

      atTenant('tienda-test', 'masivas/archivos');
      expect(activeBulkTabSignal.value).toBe('io');
    });
  });

  describe('Actualización Masiva de Precios', () => {
    it('previewBulkPrices simula el aumento de precios sin alterar la base de datos', async () => {
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        return Promise.resolve(new Response(
          JSON.stringify({
            dryRun: true,
            affectedCount: 2,
            items: [
              {
                id: 'prod-1',
                sku: 'COCA-500',
                name: 'Coca Cola 500ml',
                category: 'Bebidas',
                oldPrice: 1000,
                newPrice: 1150,
                diff: 150,
              },
              {
                id: 'prod-2',
                sku: 'SPRITE-500',
                name: 'Sprite 500ml',
                category: 'Bebidas',
                oldPrice: 1000,
                newPrice: 1150,
                diff: 150,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await previewBulkPrices();

        expect(sentBody).toEqual({
          action: 'percentage',
          value: 15,
          rounding: '10',
          dryRun: true,
        });

        expect(bulkPricePreviewSignal.value).not.toBeNull();
        expect(bulkPricePreviewSignal.value?.dryRun).toBe(true);
        expect(bulkPricePreviewSignal.value?.affectedCount).toBe(2);
        expect(bulkPricePreviewSignal.value?.items[0]?.newPrice).toBe(1150);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('applyBulkPrices confirma y aplica los precios persistentemente con dryRun: false', async () => {
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        return Promise.resolve(new Response(
          JSON.stringify({
            dryRun: false,
            affectedCount: 2,
            items: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await applyBulkPrices();

        expect(sentBody).toEqual({
          action: 'percentage',
          value: 15,
          rounding: '10',
          dryRun: false,
        });

        expect(bulkPricePreviewSignal.value?.dryRun).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Invalidación (#59)', () => {
    it('aplicar precios masivos deja viejos catálogo y dashboard', async () => {
      queryClient.setQueryData(tenantKey('tienda-test', 'products'), []);
      queryClient.setQueryData(tenantKey('tienda-test', 'dashboard', 'week', ''), {});
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(() => reply({ dryRun: false, affectedCount: 2, items: [] }));
      try {
        await applyBulkPrices();
        expect(queryClient.getQueryState(tenantKey('tienda-test', 'products'))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(tenantKey('tienda-test', 'dashboard', 'week', ''))?.isInvalidated).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('devengar intereses deja viejos clientes y extractos', async () => {
      queryClient.setQueryData(tenantKey('tienda-test', 'customers'), []);
      queryClient.setQueryData(tenantKey('tienda-test', 'customer-movements', 'c1'), []);
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn(() => reply({ dryRun: false, affectedCount: 1, totalInterestAmount: 50, items: [] }));
      try {
        await applyBulkInterests();
        expect(queryClient.getQueryState(tenantKey('tienda-test', 'customers'))?.isInvalidated).toBe(true);
        expect(queryClient.getQueryState(tenantKey('tienda-test', 'customer-movements', 'c1'))?.isInvalidated).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Devengamiento Masivo de Intereses', () => {
    it('previewBulkInterests simula el cálculo de intereses deudores', async () => {
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        return Promise.resolve(new Response(
          JSON.stringify({
            dryRun: true,
            affectedCount: 1,
            totalInterestAmount: 2500,
            items: [
              {
                customerId: 'cust-1',
                customerName: 'Juan Pérez',
                currentBalance: 50000,
                interestAmount: 2500,
                newBalance: 52500,
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await previewBulkInterests();

        expect(sentBody).toEqual({
          interestRatePercent: 5,
          description: 'Interés mensual',
          minimumBalance: 1000,
          dryRun: true,
        });

        expect(bulkInterestPreviewSignal.value?.dryRun).toBe(true);
        expect(bulkInterestPreviewSignal.value?.totalInterestAmount).toBe(2500);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('applyBulkInterests confirma el asiento contable en cuenta corriente', async () => {
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        sentBody = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
        return Promise.resolve(new Response(
          JSON.stringify({
            dryRun: false,
            affectedCount: 1,
            totalInterestAmount: 2500,
            items: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await applyBulkInterests();

        expect(sentBody).toEqual({
          interestRatePercent: 5,
          description: 'Interés mensual',
          minimumBalance: 1000,
          dryRun: false,
        });

        expect(bulkInterestPreviewSignal.value?.dryRun).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
