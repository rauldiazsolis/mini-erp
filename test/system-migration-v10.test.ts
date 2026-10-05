import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

const at = '2026-10-05T12:00:00.000Z';

function baseV9() {
  const db = createDbAtVersion(SYSTEM_SCHEMA, 9);
  db.prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run('demo-kiosco', 'demo-kiosco', 'Kiosco Demo', at);
  const reg = db.prepare('INSERT INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  reg.run('reg_a', 'demo-kiosco', 'Demo AAAA', 'CENTRAL', 'Demo AAAA', 1, at);
  reg.run('reg_b', 'demo-kiosco', 'Demo BBBB', 'CENTRAL', 'Demo BBBB', 0, at);
  const key = db.prepare(
    'INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at, register_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  key.run('key_a', 'demo-kiosco', 'Demo AAAA', 'h_a', 'mpos_a', 'CENTRAL', 'Demo AAAA', 1, at, 'reg_a');
  key.run('key_b', 'demo-kiosco', 'Demo BBBB', 'h_b', 'mpos_b', 'CENTRAL', 'Demo BBBB', 0, at, 'reg_b');
  const anon = db.prepare(
    'INSERT INTO anonymous_sessions (token_hash, tenant_id, register_id, demo_session_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  anon.run('s_a', 'demo-kiosco', 'reg_a', 'demo_a', at, at);
  anon.run('s_b', 'demo-kiosco', 'reg_b', 'demo_b', at, at);
  db.prepare('INSERT INTO portal_links (token_hash, tenant_id, register_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)').run('l_a', 'demo-kiosco', 'reg_a', at, at);
  db.prepare("INSERT INTO audit_log (id, at, actor_user_id, tenant_id, action, details) VALUES ('aud_1', ?, 'u1', 'demo-kiosco', 'demo.reset', '{}')").run(at);
  return db;
}

describe('migración de sistema v10 portal-cajas (M10)', () => {
  it('las sesiones de demo pasan con su key activa; sin key activa se descartan', () => {
    const db = baseV9();
    migrateDb(db, SYSTEM_SCHEMA);
    expect(
      db.prepare('SELECT token_hash, kind, tenant_id, register_id, api_key_id, demo_session_id, created_at, last_used_at FROM anonymous_sessions').all(),
    ).toEqual([
      { token_hash: 's_a', kind: 'demo', tenant_id: 'demo-kiosco', register_id: 'reg_a', api_key_id: 'key_a', demo_session_id: 'demo_a', created_at: at, last_used_at: at },
    ]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 10 });
  });

  it('una sesión de caja real no lleva sesión de demo', () => {
    const db = baseV9();
    migrateDb(db, SYSTEM_SCHEMA);
    db.prepare(
      "INSERT INTO anonymous_sessions (token_hash, kind, tenant_id, register_id, api_key_id, created_at, last_used_at) VALUES ('s_r', 'register', 'demo-kiosco', 'reg_a', 'key_a', ?, ?)",
    ).run(at, at);
    expect(db.prepare("SELECT demo_session_id FROM anonymous_sessions WHERE token_hash = 's_r'").get()).toEqual({ demo_session_id: null });
  });

  it('los links y la auditoría siguen, con las columnas nuevas vacías', () => {
    const db = baseV9();
    migrateDb(db, SYSTEM_SCHEMA);
    expect(db.prepare('SELECT token_hash, api_key_id FROM portal_links').all()).toEqual([{ token_hash: 'l_a', api_key_id: null }]);
    expect(db.prepare('SELECT id, actor_user_id, actor_register_id FROM audit_log').all()).toEqual([
      { id: 'aud_1', actor_user_id: 'u1', actor_register_id: null },
    ]);
  });
});
