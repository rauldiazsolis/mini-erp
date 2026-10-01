import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { readRateLimitConfig } from '../src/server/middleware/rate-limit.ts';

function makeApp() {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const clock = { now: new Date('2026-09-30T12:00:00.000Z') };
  const { app } = createApp({
    systemDb,
    tenantManager: new TenantManager(systemDb, { inMemory: true }),
    demoConfig: { enabled: true, ttlHours: 24, maxActive: 200 },
    rateLimits: { demoPerHour: 10, authPer15Min: 20 },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { app, advance };
}

type App = ReturnType<typeof makeApp>['app'];

const demo = (app: App, ip = '203.0.113.1') =>
  request(app).post('/connector/demo-sessions').set('X-POS-Contract-Version', '4.4.0').set('X-Forwarded-For', ip);

const login = (app: App) =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email: 'x@y.com', password: 'nada' });

describe('límite de pedidos (#3)', () => {
  it('lee los límites del entorno, con 10 y 20 por defecto', () => {
    expect(readRateLimitConfig({})).toEqual({ demoPerHour: 10, authPer15Min: 20 });
    expect(readRateLimitConfig({ DEMO_RATE_LIMIT: '3', AUTH_RATE_LIMIT: 'x' })).toEqual({
      demoPerHour: 3,
      authPer15Min: 20,
    });
  });

  it('la demo 11 de una IP en una hora da 429 con Retry-After; otra IP pasa', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) {
      expect((await demo(app)).status).toBe(201);
    }
    const blocked = await demo(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'rate-limited' });
    expect(blocked.headers['retry-after']).toBe('3600');
    expect((await demo(app, '198.51.100.7')).status).toBe(201);
  });

  it('al vencer la ventana vuelve a dejar pasar', async () => {
    const { app, advance } = makeApp();
    for (let i = 0; i < 10; i++) {
      await demo(app);
    }
    advance(30 * 60 * 1000);
    expect((await demo(app)).headers['retry-after']).toBe('1800');
    advance(30 * 60 * 1000);
    expect((await demo(app)).status).toBe(201);
  });

  it('login y alta comparten 20 pedidos cada 15 minutos por IP', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) {
      expect((await login(app)).status).toBe(401);
      expect((await request(app).post('/api/alta').set('X-Forwarded-For', '203.0.113.9').send({})).status).toBe(400);
    }
    const blocked = await login(app);
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('900');
  });
});
