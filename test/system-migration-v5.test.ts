import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

const at = '2026-10-01T12:00:00.000Z';

function baseV4() {
  const db = createDbAtVersion(SYSTEM_SCHEMA, 4);
  const user = db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, 'h', ?, 'user', ?)");
  user.run('u-ana', 'ana@x.com', 'Ana', at);
  user.run('u-beto', 'beto@x.com', 'Beto', '2026-10-01T13:00:00.000Z');
  const tenant = db.prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)');
  tenant.run('kiosco', 'kiosco', 'Kiosco', at);
  tenant.run('demo-x', 'demo-x', 'Demo', at);
  const member = db.prepare('INSERT INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, ?, ?)');
  member.run('u-beto', 'kiosco', 'owner', 'active', '2026-10-01T13:00:00.000Z');
  member.run('u-ana', 'kiosco', 'owner', 'active', at);
  db.prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('demo-x', 'kiosco', at, at);
  const key = db.prepare(
    'INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  key.run('key_1', 'kiosco', 'Caja 1', 'hash1', 'mpos_1', 'CENTRAL', 'Caja 1', 1, at);
  key.run('key_2', 'kiosco', 'Caja vieja', 'hash2', 'mpos_2', 'CENTRAL', 'Caja 2', 0, at);
  key.run('key_d', 'demo-x', 'Demo', 'hashd', 'mpos_d', 'DEMO', 'Caja', 1, at);
  return db;
}

describe('migración de sistema v5 creditos-y-cobro (#21)', () => {
  it('cada key pasa a tener su caja, activa si la key lo está, sin equipo', () => {
    const db = baseV4();
    migrateDb(db, SYSTEM_SCHEMA);
    const regs = db.prepare('SELECT id, tenant_id, name, branch, point_of_sale, device_id, active FROM registers ORDER BY id').all();
    expect(regs).toEqual([
      { id: 'reg_key_1', tenant_id: 'kiosco', name: 'Caja 1', branch: 'CENTRAL', point_of_sale: 'Caja 1', device_id: null, active: 1 },
      { id: 'reg_key_2', tenant_id: 'kiosco', name: 'Caja vieja', branch: 'CENTRAL', point_of_sale: 'Caja 2', device_id: null, active: 0 },
      { id: 'reg_key_d', tenant_id: 'demo-x', name: 'Demo', branch: 'DEMO', point_of_sale: 'Caja', device_id: null, active: 1 },
    ]);
    const keys = db.prepare('SELECT id, register_id, key_hash FROM tenant_api_keys ORDER BY id').all();
    expect(keys).toEqual([
      { id: 'key_1', register_id: 'reg_key_1', key_hash: 'hash1' },
      { id: 'key_2', register_id: 'reg_key_2', key_hash: 'hash2' },
      { id: 'key_d', register_id: 'reg_key_d', key_hash: 'hashd' },
    ]);
  });

  it('el titular es el owner activo más antiguo; las demos quedan sin titular', () => {
    const db = baseV4();
    migrateDb(db, SYSTEM_SCHEMA);
    const rows = db.prepare('SELECT id, holder_user_id, grace_until FROM tenants ORDER BY id').all();
    expect(rows).toEqual([
      { id: 'demo-x', holder_user_id: null, grace_until: null },
      { id: 'kiosco', holder_user_id: 'u-ana', grace_until: null },
    ]);
  });

  it('los comercios con titular reciben el bono de $50.000 a 90 días; las demos no', () => {
    const db = baseV4();
    const before = Date.now();
    migrateDb(db, SYSTEM_SCHEMA);
    const gifts = db.prepare('SELECT tenant_id, amount, origin, expires_at FROM gift_credits').all() as {
      tenant_id: string;
      amount: number;
      origin: string;
      expires_at: string;
    }[];
    expect(gifts).toHaveLength(1);
    expect(gifts[0]).toMatchObject({ tenant_id: 'kiosco', amount: 50000, origin: 'signup' });
    const days = (Date.parse(gifts[0]?.expires_at ?? '') - before) / 86_400_000;
    expect(days).toBeGreaterThan(89.9);
    expect(days).toBeLessThan(90.1);
  });

  it('los datos de v4 sobreviven y las tablas de cobro nacen vacías', () => {
    const db = baseV4();
    migrateDb(db, SYSTEM_SCHEMA);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM memberships').get()).toEqual({ n: 2 });
    for (const table of ['register_devices', 'billing_settings', 'paid_movements', 'gift_consumptions', 'charges']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 5 });
  });
});
