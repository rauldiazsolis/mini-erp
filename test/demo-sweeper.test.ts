import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import { DemoResetService } from '../src/server/demo/demo-reset-service.ts';
import { startDemoSweeper } from '../src/server/demo/demo-sweeper.ts';
import { lastResetBoundary } from '../src/server/demo/reset-schedule.ts';
import { readDemoConfig } from '../src/server/demo/demo-config.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pgDb = setupTestDb();

describe('hora del reinicio automático (#24)', () => {
  it('las 4:00 argentinas son las 7:00 UTC', () => {
    expect(lastResetBoundary(new Date('2026-10-05T07:00:00.000Z'), 4).toISOString()).toBe('2026-10-05T07:00:00.000Z');
    expect(lastResetBoundary(new Date('2026-10-05T06:59:59.000Z'), 4).toISOString()).toBe('2026-10-04T07:00:00.000Z');
    expect(lastResetBoundary(new Date('2026-10-05T23:30:00.000Z'), 4).toISOString()).toBe('2026-10-05T07:00:00.000Z');
  });

  it('a las 22 argentinas, aunque en UTC ya sea otro día', () => {
    expect(lastResetBoundary(new Date('2026-10-06T01:00:00.000Z'), 22).toISOString()).toBe('2026-10-06T01:00:00.000Z');
    expect(lastResetBoundary(new Date('2026-10-06T00:59:00.000Z'), 22).toISOString()).toBe('2026-10-05T01:00:00.000Z');
  });

  it('DEMO_RESET_HOUR: de 0 a 23, si no 4', () => {
    expect(readDemoConfig({ DEMO_RESET_HOUR: '23' }).resetHour).toBe(23);
    expect(readDemoConfig({ DEMO_RESET_HOUR: '0' }).resetHour).toBe(0);
    for (const raw of ['24', '-1', 'x', '', '3.5']) {
      expect(readDemoConfig({ DEMO_RESET_HOUR: raw }).resetHour).toBe(4);
    }
    expect(readDemoConfig({}).resetHour).toBe(4);
  });
});

describe('barrido de demos (#24)', () => {
  let tenantManager: TenantManager;
  let apiKeyService: ApiKeyService;
  let service: DemoSessionService;
  let resets: DemoResetService;
  let clock: Date;

  beforeEach(async () => {
    tenantManager = new TenantManager(pgDb());
    apiKeyService = new ApiKeyService(pgDb().system);
    clock = new Date('2026-10-05T06:00:00.000Z'); // 3:00 AR
    service = new DemoSessionService({
      db: pgDb().system,
      tenantManager,
      apiKeyService,
      config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4 },
      now: () => clock,
    });
    resets = new DemoResetService({ db: pgDb().system, tenantManager, sessions: service, now: () => clock });
    await service.ensureDemoTenants();
  });

  it('runDue reinicia los rubros que no se reiniciaron desde las 4:00 AR, una vez', async () => {
    const a = await service.create('kiosco');
    expect(await resets.runDue()).toEqual([]);
    clock = new Date('2026-10-05T07:05:00.000Z'); // 4:05 AR
    expect(await resets.runDue()).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(await apiKeyService.validateApiKey(a.apiKey)).toBeUndefined();
    expect(await resets.runDue()).toEqual([]);
  });

  it('restock repone lo que bajó de un cuarto de la semilla, con su movimiento', async () => {
    const db = tenantManager.forTenant('demo-kiosco');
    const setQuantity = async (productId: string, quantity: number): Promise<void> => {
      await db.updateTable('stock').set({ quantity }).where('product_id', '=', productId).execute();
    };
    const quantityOf = async (productId: string): Promise<number | undefined> =>
      (await db.selectFrom('stock').select('quantity').where('product_id', '=', productId).executeTakeFirst())?.quantity;
    await resets.restock(); // lo que el historial sembrado ya haya bajado
    await setQuantity('demo_KIO-001', 11); // 48 / 4 = 12
    await setQuantity('demo_KIO-002', 14); // 60 / 4 = 15
    await setQuantity('demo_KIO-004', 30); // 72 / 4 = 18: no
    expect(await resets.restock()).toBe(2);
    expect(await quantityOf('demo_KIO-001')).toBe(48);
    expect(
      await db
        .selectFrom('stock_movements')
        .select(['reason', 'notes', 'delta'])
        .where('product_id', '=', 'demo_KIO-001')
        .orderBy('seq', 'desc')
        .limit(1)
        .executeTakeFirst(),
    ).toEqual({ reason: 'restock', notes: 'Reposición automática', delta: 37 });
    expect(await quantityOf('demo_KIO-004')).toBe(30);
    expect(await resets.restock()).toBe(0);
  });

  it('restock no repone un producto de la semilla que alguien borró', async () => {
    const db = tenantManager.forTenant('demo-kiosco');
    await resets.restock();
    await db.updateTable('stock').set({ quantity: 1 }).where('product_id', '=', 'demo_KIO-001').execute();
    await db.deleteFrom('products').where('id', '=', 'demo_KIO-001').execute();
    expect(await resets.restock()).toBe(0);
    expect(await db.selectFrom('stock').select('quantity').where('product_id', '=', 'demo_KIO-001').executeTakeFirst()).toEqual({ quantity: 1 });
  });

  it('el barrido al arrancar hace todo y loguea', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runDue = vi.spyOn(resets, 'runDue');
    const restock = vi.spyOn(resets, 'restock');
    const timer = await startDemoSweeper({ sessions: service, resets }, 60_000);
    clearInterval(timer);
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(restock).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.some(([line]) => typeof line === 'string' && line.startsWith('[demos] barrido'))).toBe(true);
    log.mockRestore();
  });
});
