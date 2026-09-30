import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { readDemoConfig, type DemoConfig } from '../src/server/demo/demo-config.ts';
import { DemoSessionService, startDemoSweeper } from '../src/server/demo/demo-session-service.ts';

const HOUR = 60 * 60 * 1000;

function setup(overrides: Partial<DemoConfig> = {}) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const tenantManager = new TenantManager(systemDb, { inMemory: true });
  const apiKeyService = new ApiKeyService(systemDb);
  const clock = { now: new Date('2026-09-30T12:00:00.000Z') };
  const service = new DemoSessionService({
    systemDb,
    tenantManager,
    apiKeyService,
    config: { enabled: true, ttlHours: 24, maxActive: 200, ...overrides },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { service, tenantManager, apiKeyService, advance };
}

describe('readDemoConfig (#9)', () => {
  it('usa los valores por defecto', () => {
    expect(readDemoConfig({})).toEqual({ enabled: true, ttlHours: 24, maxActive: 200 });
  });

  it('lee el entorno', () => {
    expect(
      readDemoConfig({
        DEMO_SESSIONS: 'off',
        DEMO_TTL_HOURS: '2',
        DEMO_MAX_ACTIVE: '5',
        PUBLIC_URL: 'https://erp.example.com/',
      }),
    ).toEqual({ enabled: false, ttlHours: 2, maxActive: 5, publicUrl: 'https://erp.example.com' });
  });

  it('ignora números inválidos', () => {
    expect(readDemoConfig({ DEMO_TTL_HOURS: 'x', DEMO_MAX_ACTIVE: '-3' })).toMatchObject({
      ttlHours: 24,
      maxActive: 200,
    });
  });
});

describe('DemoSessionService (#9)', () => {
  it('crea una demo aislada con su key, sembrada con el template', () => {
    const { service, tenantManager, apiKeyService } = setup();
    const session = service.create('almacen');

    expect(session).toMatchObject({ branch: 'CENTRAL', pointOfSale: 'Caja 1', template: 'almacen' });
    expect(session.tenantId).toMatch(/^demo-/);
    expect(apiKeyService.validateApiKey(session.apiKey)).toEqual({
      tenantId: session.tenantId,
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
    });
    const row = tenantManager
      .getTenantDb(session.tenantId)
      .prepare('SELECT COUNT(*) AS n FROM products WHERE sku = ?')
      .get('ALM-001') as { n: number };
    expect(row.n).toBe(1);
    expect(service.countActive()).toBe(1);
  });

  it('dos demos son dos tenants distintos', () => {
    const { service } = setup();
    expect(service.create('kiosco').tenantId).not.toBe(service.create('kiosco').tenantId);
  });

  it('barre solo las demos sin uso por más del vencimiento', () => {
    const { service, tenantManager, advance } = setup();
    const vieja = service.create('kiosco');
    const usada = service.create('kiosco');
    advance(23 * HOUR);
    service.touch(usada.tenantId);
    advance(2 * HOUR);

    expect(service.sweepExpired()).toBe(1);
    expect(tenantManager.tenantExists(vieja.tenantId)).toBe(false);
    expect(tenantManager.tenantExists(usada.tenantId)).toBe(true);
    expect(service.countActive()).toBe(1);
  });

  it('touch sobre un tenant que no es demo no hace nada', () => {
    const { service } = setup();
    service.touch('tienda-real');
    expect(service.countActive()).toBe(0);
  });

  it('avisa cuando llega al tope', () => {
    const { service } = setup({ maxActive: 2 });
    service.create('kiosco');
    expect(service.isFull()).toBe(false);
    service.create('kiosco');
    expect(service.isFull()).toBe(true);
  });
});

describe('startDemoSweeper (#9)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('barre al arrancar y en cada intervalo', () => {
    vi.useFakeTimers();
    const { service } = setup();
    const sweep = vi.spyOn(service, 'sweepExpired');
    const timer = startDemoSweeper(service, 1000);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(sweep).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });

  it('loguea cuántas demos borró al arrancar (#3)', () => {
    const { service } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const timer = startDemoSweeper(service, 1000);
    expect(log).toHaveBeenCalledWith('[demos] barrido: 0 demos vencidas borradas');
    clearInterval(timer);
    log.mockRestore();
  });
});
