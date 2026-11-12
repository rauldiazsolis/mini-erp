import { describe, it, expect, afterEach, vi } from 'vitest';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { readDemoConfig, type DemoConfig } from '../src/server/demo/demo-config.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import { DemoResetService } from '../src/server/demo/demo-reset-service.ts';
import { startDemoSweeper } from '../src/server/demo/demo-sweeper.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const HOUR = 60 * 60 * 1000;

function setup(overrides: Partial<DemoConfig> = {}) {
  const tenantManager = new TenantManager(db().system, { inMemory: true });
  const apiKeyService = new ApiKeyService(db().system);
  const clock = { now: new Date('2026-10-05T15:00:00.000Z') };
  const service = new DemoSessionService({
    db: db().system,
    tenantManager,
    apiKeyService,
    config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4, ...overrides },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  const registerOf = async (rawKey: string): Promise<string> => (await apiKeyService.validateApiKey(rawKey))?.registerId ?? '';
  const resets = new DemoResetService({ db: db().system, tenantManager, sessions: service, now: () => clock.now });
  return { service, resets, tenantManager, apiKeyService, advance, clock, registerOf };
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
  it('ensureDemoTenants crea los tres comercios sembrados, una vez', async () => {
    const { service, tenantManager, clock } = setup();
    expect(await service.ensureDemoTenants()).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(await service.ensureDemoTenants()).toEqual([]);
    const rows = await db().system.selectFrom('demo_tenants').select(['tenant_id', 'template', 'last_full_reset_at']).orderBy('tenant_id').execute();
    expect(rows).toEqual([
      { tenant_id: 'demo-almacen', template: 'almacen', last_full_reset_at: clock.now.toISOString() },
      { tenant_id: 'demo-ferreteria', template: 'ferreteria', last_full_reset_at: clock.now.toISOString() },
      { tenant_id: 'demo-kiosco', template: 'kiosco', last_full_reset_at: clock.now.toISOString() },
    ]);
    expect(await tenantManager.getTenantName('demo-kiosco')).toBe('Kiosco Demo');
    const sales = tenantManager.getTenantDb('demo-kiosco').prepare('SELECT COUNT(*) AS n FROM sales').get() as { n: number };
    expect(sales.n).toBeGreaterThan(0);
    expect(await service.isDemoTenant('demo-kiosco')).toBe(true);
    expect(await service.templateOf('demo-kiosco')).toBe('kiosco');
    expect(await service.isDemoTenant('tienda')).toBe(false);
  });

  it('create da una caja de visitante en el comercio del rubro, con su sesión', async () => {
    const { service, apiKeyService } = setup();
    const s = await service.create('almacen');
    expect(s).toMatchObject({ tenantId: 'demo-almacen', branch: 'CENTRAL', template: 'almacen' });
    expect(s.pointOfSale).toMatch(/^Demo [0-9A-F]{4}$/);
    const key = await apiKeyService.validateApiKey(s.apiKey);
    expect(key).toMatchObject({ tenantId: 'demo-almacen', pointOfSale: s.pointOfSale });
    const row = await db().system.selectFrom('demo_sessions').select(['id', 'template', 'tenant_id', 'register_id', 'revoked_at']).executeTakeFirst();
    expect(row).toEqual({ id: s.sessionId, template: 'almacen', tenant_id: 'demo-almacen', register_id: key?.registerId, revoked_at: null });
    expect(await service.activeSessionOfRegister(key?.registerId ?? '')).toEqual({
      id: s.sessionId,
      tenantId: 'demo-almacen',
      template: 'almacen',
      pointOfSale: s.pointOfSale,
    });
  });

  it('dos visitantes del mismo rubro comparten el comercio y tienen cajas distintas', async () => {
    const { service } = setup();
    const a = await service.create('kiosco');
    const b = await service.create('kiosco');
    expect(a.tenantId).toBe(b.tenantId);
    expect(a.pointOfSale).not.toBe(b.pointOfSale);
    expect(await service.countActive()).toBe(2);
  });

  it('touchRegister corre el último uso a lo sumo una vez por minuto', async () => {
    const { service, advance, clock, registerOf } = setup();
    const lastUsed = async () => await db().system.selectFrom('demo_sessions').select('last_used_at as at').executeTakeFirst();
    const reg = await registerOf((await service.create('kiosco')).apiKey);
    const t0 = clock.now.toISOString();
    advance(30_000);
    await service.touchRegister(reg);
    expect(await lastUsed()).toEqual({ at: t0 });
    advance(60_000);
    await service.touchRegister(reg);
    expect(await lastUsed()).toEqual({ at: clock.now.toISOString() });
  });

  it('revokeIdle revoca las cajas sin uso por ttlHours: su key deja de valer', async () => {
    const { service, apiKeyService, advance } = setup();
    const old = await service.create('kiosco');
    advance(23 * HOUR);
    const fresh = await service.create('kiosco');
    advance(2 * HOUR);
    expect(await service.revokeIdle()).toBe(1);
    expect(await apiKeyService.validateApiKey(old.apiKey)).toBeUndefined();
    expect(await apiKeyService.validateApiKey(fresh.apiKey)).toBeDefined();
    expect(await db().system.selectFrom('demo_sessions').select('revoke_reason as r').where('revoked_at', 'is not', null).execute()).toEqual([{ r: 'idle' }]);
    expect(await service.countActive()).toBe(1);
  });

  it('revokeTenant revoca todas las cajas del comercio y nunca borra el registro', async () => {
    const { service, registerOf } = setup();
    const a = await service.create('kiosco');
    await service.create('kiosco');
    await service.create('almacen');
    expect(await service.revokeTenant('demo-kiosco', 'reset')).toBe(2);
    expect(await db().system.selectFrom('demo_sessions').select((eb) => eb.fn.countAll<number>().as('n')).executeTakeFirst()).toEqual({ n: 3 });
    expect(await service.countActive()).toBe(1);
    expect(await service.activeSessionOfRegister(await registerOf(a.apiKey))).toBeUndefined();
  });

  it('isFull cuenta las cajas de visitante activas', async () => {
    const { service } = setup({ maxActive: 3 });
    await service.create('kiosco');
    await service.create('kiosco');
    expect(await service.isFull()).toBe(false);
    await service.create('almacen');
    expect(await service.isFull()).toBe(true);
    await service.revokeTenant('demo-almacen', 'reset');
    expect(await service.isFull()).toBe(false);
  });
});

describe('startDemoSweeper (#24)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('barre al arrancar y en cada intervalo', async () => {
    // Solo el intervalo es falso: el barrido espera a PostgreSQL, que necesita los timers de verdad
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const { service, resets } = setup();
    const sweep = vi.spyOn(service, 'revokeIdle');
    const timer = await startDemoSweeper({ sessions: service, resets }, 1000);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    await vi.waitFor(() => {
      expect(sweep).toHaveBeenCalledTimes(3);
    });
    clearInterval(timer);
  });

  it('loguea lo que hizo al arrancar (#3)', async () => {
    const { service, resets } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const timer = await startDemoSweeper({ sessions: service, resets }, 1000);
    expect(log.mock.calls.some(([line]) => typeof line === 'string' && line.startsWith('[demos] barrido'))).toBe(true);
    clearInterval(timer);
    log.mockRestore();
  });
});
