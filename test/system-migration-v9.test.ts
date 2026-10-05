import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

const at = '2026-10-04T12:00:00.000Z';

function baseV8() {
  const db = createDbAtVersion(SYSTEM_SCHEMA, 8);
  db.prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run('demo-ab12', 'demo-ab12', 'Demo Kiosco', at);
  db.prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run('kiosco', 'kiosco', 'Kiosco', at);
  db.prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('demo-ab12', 'kiosco', at, at);
  return db;
}

describe('migración de sistema v9 demos-v2 (#24)', () => {
  it('las demos de antes quedan en legacy_demo_sessions, con sus datos', () => {
    const db = baseV8();
    migrateDb(db, SYSTEM_SCHEMA);
    expect(db.prepare('SELECT tenant_id, template, created_at, last_used_at FROM legacy_demo_sessions').all()).toEqual([
      { tenant_id: 'demo-ab12', template: 'kiosco', created_at: at, last_used_at: at },
    ]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tenants').get()).toEqual({ n: 2 });
  });

  it('crea demo_tenants, la demo_sessions nueva, anonymous_sessions y portal_links vacías', () => {
    const db = baseV8();
    migrateDb(db, SYSTEM_SCHEMA);
    for (const table of ['demo_tenants', 'demo_sessions', 'anonymous_sessions', 'portal_links']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
    const cols = (db.prepare("SELECT name FROM pragma_table_info('demo_sessions') ORDER BY cid").all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'template', 'tenant_id', 'register_id', 'created_at', 'last_used_at', 'revoked_at', 'revoke_reason']);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 });
  });
});
