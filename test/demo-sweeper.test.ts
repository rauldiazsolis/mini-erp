import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import { DemoResetService } from '../src/server/demo/demo-reset-service.ts';
import { startDemoSweeper } from '../src/server/demo/demo-sweeper.ts';
import { lastResetBoundary } from '../src/server/demo/reset-schedule.ts';
import { readDemoConfig } from '../src/server/demo/demo-config.ts';

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
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;
  let apiKeyService: ApiKeyService;
  let service: DemoSessionService;
  let resets: DemoResetService;
  let clock: Date;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    apiKeyService = new ApiKeyService(systemDb);
    clock = new Date('2026-10-05T06:00:00.000Z'); // 3:00 AR
    service = new DemoSessionService({
      systemDb,
      tenantManager,
      apiKeyService,
      config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4 },
      now: () => clock,
    });
    resets = new DemoResetService({ systemDb, tenantManager, sessions: service, now: () => clock });
    service.ensureDemoTenants();
  });

  it('runDue reinicia los rubros que no se reiniciaron desde las 4:00 AR, una vez', () => {
    const a = service.create('kiosco');
    expect(resets.runDue()).toEqual([]);
    clock = new Date('2026-10-05T07:05:00.000Z'); // 4:05 AR
    expect(resets.runDue()).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(apiKeyService.validateApiKey(a.apiKey)).toBeUndefined();
    expect(resets.runDue()).toEqual([]);
  });

  it('restock repone lo que bajó de un cuarto de la semilla, con su movimiento', () => {
    const db = tenantManager.getTenantDb('demo-kiosco');
    resets.restock(); // lo que el historial sembrado ya haya bajado
    db.prepare("UPDATE stock SET quantity = 11 WHERE product_id = 'demo_KIO-001'").run(); // 48 / 4 = 12
    db.prepare("UPDATE stock SET quantity = 14 WHERE product_id = 'demo_KIO-002'").run(); // 60 / 4 = 15
    db.prepare("UPDATE stock SET quantity = 30 WHERE product_id = 'demo_KIO-004'").run(); // 72 / 4 = 18: no
    expect(resets.restock()).toBe(2);
    expect(db.prepare("SELECT quantity FROM stock WHERE product_id = 'demo_KIO-001'").get()).toEqual({ quantity: 48 });
    expect(
      db.prepare("SELECT reason, notes FROM stock_movements WHERE product_id = 'demo_KIO-001' ORDER BY created_at DESC, rowid DESC LIMIT 1").get(),
    ).toEqual({ reason: 'restock', notes: 'Reposición automática' });
    expect(db.prepare("SELECT quantity FROM stock WHERE product_id = 'demo_KIO-004'").get()).toEqual({ quantity: 30 });
    expect(resets.restock()).toBe(0);
  });

  it('el barrido al arrancar hace todo y loguea', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const runDue = vi.spyOn(resets, 'runDue');
    const restock = vi.spyOn(resets, 'restock');
    const timer = startDemoSweeper({ sessions: service, resets }, 60_000);
    clearInterval(timer);
    expect(runDue).toHaveBeenCalledTimes(1);
    expect(restock).toHaveBeenCalledTimes(1);
    expect(log.mock.calls.some(([line]) => typeof line === 'string' && line.startsWith('[demos] barrido'))).toBe(true);
    log.mockRestore();
  });
});
