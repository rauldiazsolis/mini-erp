import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { readDemoConfig, type DemoConfig } from '../src/server/demo/demo-config.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import { DemoResetService } from '../src/server/demo/demo-reset-service.ts';
import { startDemoSweeper } from '../src/server/demo/demo-sweeper.ts';

const HOUR = 60 * 60 * 1000;

function setup(overrides: Partial<DemoConfig> = {}) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const tenantManager = new TenantManager(systemDb, { inMemory: true });
  const apiKeyService = new ApiKeyService(systemDb);
  const clock = { now: new Date('2026-10-05T15:00:00.000Z') };
  const service = new DemoSessionService({
    systemDb,
    tenantManager,
    apiKeyService,
    config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4, ...overrides },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const registerOf = (rawKey: string): string => apiKeyService.validateApiKey(rawKey)?.registerId ?? '';
  const resets = new DemoResetService({ systemDb, tenantManager, sessions: service, now: () => clock.now });
  return { service, resets, tenantManager, apiKeyService, advance, systemDb, clock, registerOf };
}

describe('readDemoConfig (#9, #24)', () => {
  it('usa los valores por defecto', () => {
    expect(readDemoConfig({})).toEqual({ enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4 });
  });

  it('lee el entorno', () => {
    expect(
      readDemoConfig({
        DEMO_SESSIONS: 'off',
        DEMO_TTL_HOURS: '2',
        DEMO_MAX_ACTIVE: '5',
        PUBLIC_URL: 'https://erp.example.com/',
      }),
    ).toEqual({ enabled: false, ttlHours: 2, maxActive: 5, resetHour: 4, publicUrl: 'https://erp.example.com' });
  });

  it('ignora números inválidos', () => {
    expect(readDemoConfig({ DEMO_TTL_HOURS: 'x', DEMO_MAX_ACTIVE: '-3' })).toMatchObject({
      ttlHours: 24,
      maxActive: 200,
    });
  });
});

describe('DemoSessionService (#24)', () => {
  it('ensureDemoTenants crea los tres comercios sembrados, una vez', () => {
    const { service, systemDb, tenantManager, clock } = setup();
    expect(service.ensureDemoTenants()).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(service.ensureDemoTenants()).toEqual([]);
    const rows = systemDb.prepare('SELECT tenant_id, template, last_full_reset_at FROM demo_tenants ORDER BY tenant_id').all();
    expect(rows).toEqual([
      { tenant_id: 'demo-almacen', template: 'almacen', last_full_reset_at: clock.now.toISOString() },
      { tenant_id: 'demo-ferreteria', template: 'ferreteria', last_full_reset_at: clock.now.toISOString() },
      { tenant_id: 'demo-kiosco', template: 'kiosco', last_full_reset_at: clock.now.toISOString() },
    ]);
    expect(tenantManager.getTenantName('demo-kiosco')).toBe('Kiosco Demo');
    const sales = tenantManager.getTenantDb('demo-kiosco').prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
    expect(sales.n).toBeGreaterThan(0);
    expect(service.isDemoTenant('demo-kiosco')).toBe(true);
    expect(service.templateOf('demo-kiosco')).toBe('kiosco');
    expect(service.isDemoTenant('tienda')).toBe(false);
  });

  it('create da una caja de visitante en el comercio del rubro, con su sesión', () => {
    const { service, apiKeyService, systemDb } = setup();
    const s = service.create('almacen');
    expect(s).toMatchObject({ tenantId: 'demo-almacen', branch: 'CENTRAL', template: 'almacen' });
    expect(s.pointOfSale).toMatch(/^Demo [0-9A-F]{4}$/);
    const key = apiKeyService.validateApiKey(s.apiKey);
    expect(key).toMatchObject({ tenantId: 'demo-almacen', pointOfSale: s.pointOfSale });
    const row = systemDb.prepare('SELECT id, template, tenant_id, register_id, revoked_at FROM demo_sessions').get();
    expect(row).toEqual({ id: s.sessionId, template: 'almacen', tenant_id: 'demo-almacen', register_id: key?.registerId, revoked_at: null });
    expect(service.activeSessionOfRegister(key?.registerId ?? '')).toEqual({
      id: s.sessionId,
      tenantId: 'demo-almacen',
      template: 'almacen',
      pointOfSale: s.pointOfSale,
    });
  });

  it('dos visitantes del mismo rubro comparten el comercio y tienen cajas distintas', () => {
    const { service } = setup();
    const a = service.create('kiosco');
    const b = service.create('kiosco');
    expect(a.tenantId).toBe(b.tenantId);
    expect(a.pointOfSale).not.toBe(b.pointOfSale);
    expect(service.countActive()).toBe(2);
  });

  it('touchRegister corre el último uso a lo sumo una vez por minuto', () => {
    const { service, systemDb, advance, clock, registerOf } = setup();
    const reg = registerOf(service.create('kiosco').apiKey);
    const t0 = clock.now.toISOString();
    advance(30_000);
    service.touchRegister(reg);
    expect(systemDb.prepare('SELECT last_used_at AS at FROM demo_sessions').get()).toEqual({ at: t0 });
    advance(60_000);
    service.touchRegister(reg);
    expect(systemDb.prepare('SELECT last_used_at AS at FROM demo_sessions').get()).toEqual({ at: clock.now.toISOString() });
  });

  it('revokeIdle revoca las cajas sin uso por ttlHours: su key deja de valer', () => {
    const { service, apiKeyService, systemDb, advance } = setup();
    const old = service.create('kiosco');
    advance(23 * HOUR);
    const fresh = service.create('kiosco');
    advance(2 * HOUR);
    expect(service.revokeIdle()).toBe(1);
    expect(apiKeyService.validateApiKey(old.apiKey)).toBeUndefined();
    expect(apiKeyService.validateApiKey(fresh.apiKey)).toBeDefined();
    expect(systemDb.prepare('SELECT revoke_reason AS r FROM demo_sessions WHERE revoked_at IS NOT NULL').all()).toEqual([{ r: 'idle' }]);
    expect(service.countActive()).toBe(1);
  });

  it('revokeTenant revoca todas las cajas del comercio y nunca borra el registro', () => {
    const { service, systemDb, registerOf } = setup();
    const a = service.create('kiosco');
    service.create('kiosco');
    service.create('almacen');
    expect(service.revokeTenant('demo-kiosco', 'reset')).toBe(2);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM demo_sessions').get()).toEqual({ n: 3 });
    expect(service.countActive()).toBe(1);
    expect(service.activeSessionOfRegister(registerOf(a.apiKey))).toBeUndefined();
  });

  it('isFull cuenta las cajas de visitante activas', () => {
    const { service } = setup({ maxActive: 3 });
    service.create('kiosco');
    service.create('kiosco');
    expect(service.isFull()).toBe(false);
    service.create('almacen');
    expect(service.isFull()).toBe(true);
    service.revokeTenant('demo-almacen', 'reset');
    expect(service.isFull()).toBe(false);
  });

  it('sweepLegacy borra los tenants por visitante de antes de M8', () => {
    const { service, tenantManager, systemDb } = setup();
    tenantManager.createTenant({ id: 'demo-ab12', slug: 'demo-ab12', name: 'Demo' });
    systemDb
      .prepare('INSERT INTO legacy_demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .run('demo-ab12', 'kiosco', 'x', 'x');
    expect(service.sweepLegacy()).toBe(1);
    expect(tenantManager.tenantExists('demo-ab12')).toBe(false);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM legacy_demo_sessions').get()).toEqual({ n: 0 });
  });
});

describe('startDemoSweeper (#24)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('barre al arrancar y en cada intervalo', () => {
    vi.useFakeTimers();
    const { service, resets } = setup();
    const sweep = vi.spyOn(service, 'revokeIdle');
    const timer = startDemoSweeper({ sessions: service, resets }, 1000);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(sweep).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });

  it('loguea lo que hizo al arrancar (#3)', () => {
    const { service, resets } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const timer = startDemoSweeper({ sessions: service, resets }, 1000);
    expect(log.mock.calls.some(([line]) => typeof line === 'string' && line.startsWith('[demos] barrido'))).toBe(true);
    clearInterval(timer);
    log.mockRestore();
  });
});
