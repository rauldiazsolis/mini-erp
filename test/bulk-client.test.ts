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
  ioSelectedEntitySignal,
  ioUpdateExistingSignal,
  ioCsvContentSignal,
  ioImportPreviewSignal,
  previewImport,
  applyImport,
} from '../src/client/state/bulk-state.ts';
import {
  tokenSignal,
  activeTenantIdSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

describe('Módulo de Operaciones Masivas (Etapa 4.4)', () => {
  beforeEach(() => {
    activeBulkTabSignal.value = 'prices';
    bulkPriceActionSignal.value = 'percentage';
    bulkPriceValueSignal.value = 15;
    bulkPriceCategorySignal.value = 'all';
    bulkPriceRoundingSignal.value = '10';
    bulkPricePreviewSignal.value = null;

    bulkInterestPercentSignal.value = 5;
    bulkInterestDescriptionSignal.value = 'Interés mensual';
    bulkInterestMinBalanceSignal.value = 1000;
    bulkInterestPreviewSignal.value = null;

    ioSelectedEntitySignal.value = 'products';
    ioUpdateExistingSignal.value = true;
    ioCsvContentSignal.value = '';
    ioImportPreviewSignal.value = null;

    tokenSignal.value = 'mock-token';
    activeTenantIdSignal.value = 'tienda-test';
    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    vi.restoreAllMocks();
  });

  describe('Conmutación de Pestañas', () => {
    it('inicia en precios y permite cambiar a intereses e io', () => {
      expect(activeBulkTabSignal.value).toBe('prices');

      activeBulkTabSignal.value = 'interests';
      expect(activeBulkTabSignal.value).toBe('interests');

      activeBulkTabSignal.value = 'io';
      expect(activeBulkTabSignal.value).toBe('io');
    });
  });

  describe('Actualización Masiva de Precios', () => {
    it('previewBulkPrices simula el aumento de precios sin alterar la base de datos', async () => {
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
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
        );
      }) as unknown as typeof fetch;

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

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            dryRun: false,
            affectedCount: 2,
            items: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

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

  describe('Devengamiento Masivo de Intereses', () => {
    it('previewBulkInterests simula el cálculo de intereses deudores', async () => {
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
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
        );
      }) as unknown as typeof fetch;

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

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            dryRun: false,
            affectedCount: 1,
            totalInterestAmount: 2500,
            items: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

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

  describe('Importación CSV', () => {
    it('previewImport envía contenido CSV en modo simulación (dryRun: true)', async () => {
      ioCsvContentSignal.value = 'sku,name,price\nPROD-1,Coca Cola,1500';
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            dryRun: true,
            importedCount: 1,
            updatedCount: 0,
            skippedCount: 0,
            errors: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      try {
        await previewImport();

        expect(sentBody).toEqual({
          csv: 'sku,name,price\nPROD-1,Coca Cola,1500',
          updateExisting: true,
          dryRun: true,
        });

        expect(ioImportPreviewSignal.value?.importedCount).toBe(1);
        expect(ioImportPreviewSignal.value?.dryRun).toBe(true);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('applyImport aplica la importación real en base de datos', async () => {
      ioCsvContentSignal.value = 'sku,name,price\nPROD-1,Coca Cola,1500';
      let sentBody: unknown = null;
      const originalFetch = globalThis.fetch;

      globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
        sentBody = init?.body ? JSON.parse(String(init.body)) : null;
        return new Response(
          JSON.stringify({
            dryRun: false,
            importedCount: 1,
            updatedCount: 0,
            skippedCount: 0,
            errors: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

      try {
        await applyImport();

        expect(sentBody).toEqual({
          csv: 'sku,name,price\nPROD-1,Coca Cola,1500',
          updateExisting: true,
          dryRun: false,
        });

        expect(ioImportPreviewSignal.value?.dryRun).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
