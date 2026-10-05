import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

const at = '2026-10-05T15:00:00.000Z';

describe('rutas públicas del embudo (#25)', () => {
  let app: Express;
  let systemDb: DatabaseSync;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    app = createApp({
      systemDb,
      tenantManager,
      now: () => new Date(at),
      rateLimits: { demoPerHour: 10, authPer15Min: 20, contactPerHour: 2, beaconPerHour: 3 },
    }).app;
    systemDb
      .prepare(
        "INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at) VALUES ('demo_a', 'kiosco', 'demo-kiosco', 'reg_a', ?, ?)",
      )
      .run(at, at);
  });

  const daily = () => systemDb.prepare('SELECT kind, count FROM funnel_daily ORDER BY kind').all();
  const beacon = (body: object) => request(app).post('/api/funnel/beacon').send(body);
  const contact = (body: object) => request(app).post('/api/funnel/contacts').send(body);

  it('los beacons suman al día y siempre dan 204', async () => {
    expect((await beacon({ kind: 'landing' })).status).toBe(204);
    expect((await beacon({ kind: 'demo-click' })).status).toBe(204);
    expect((await beacon({ kind: 'cualquiera' })).status).toBe(204);
    expect(daily()).toEqual([
      { kind: 'demo-click', count: 1 },
      { kind: 'landing', count: 1 },
    ]);
  });

  it('alta-open con una demo conocida es el evento alta-opened; sin demo, el total del día', async () => {
    await beacon({ kind: 'alta-open', demoSessionId: 'demo_a' });
    await beacon({ kind: 'alta-open', demoSessionId: 'demo_a' });
    await beacon({ kind: 'alta-open' });
    expect(systemDb.prepare('SELECT type, demo_session_id AS demo FROM funnel_events').all()).toEqual([{ type: 'alta-opened', demo: 'demo_a' }]);
    expect(daily()).toEqual([{ kind: 'alta-open', count: 1 }]);
  });

  it('pasado el límite, el beacon da 204 sin contar', async () => {
    for (let i = 0; i < 5; i++) expect((await beacon({ kind: 'landing' })).status).toBe(204);
    expect(daily()).toEqual([{ kind: 'landing', count: 3 }]);
  });

  it('guarda un contacto válido, con la demo', async () => {
    const res = await contact({ name: ' Ana ', whatsapp: '+54 9 11 5555-0000', source: 'demo', demoSessionId: 'demo_a' });
    expect(res.status).toBe(201);
    expect(systemDb.prepare('SELECT name, whatsapp, source, demo_session_id AS demo FROM funnel_contacts').all()).toEqual([
      { name: 'Ana', whatsapp: '5491155550000', source: 'demo', demo: 'demo_a' },
    ]);
  });

  it('valida nombre y WhatsApp con mensajes en castellano', async () => {
    const sinNombre = await contact({ name: 'A', whatsapp: '1155550000', source: 'landing' });
    expect(sinNombre.status).toBe(400);
    expect((sinNombre.body as { error: string }).error).toBe('Escribí tu nombre (2 a 80 letras)');
    const sinWhatsapp = await contact({ name: 'Ana', whatsapp: '12', source: 'landing' });
    expect(sinWhatsapp.status).toBe(400);
    expect((sinWhatsapp.body as { error: string }).error).toBe('Escribí un WhatsApp con código de área (8 a 15 números)');
  });

  it('el límite de contactos da 429 con Retry-After', async () => {
    const body = { name: 'Ana', whatsapp: '1155550000', source: 'landing' };
    await contact(body);
    await contact(body);
    const res = await contact(body);
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
