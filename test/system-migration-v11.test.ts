import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

const at = '2026-10-05T12:00:00.000Z';
/** El esquema hasta v11 (#25). */
const HASTA_V11 = { ...SYSTEM_SCHEMA, migrations: SYSTEM_SCHEMA.migrations.filter((m) => m.version <= 11) };

function baseV10() {
  const db = createDbAtVersion(SYSTEM_SCHEMA, 10);
  db.prepare('INSERT INTO tenants (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run('kiosco-ana', 'kiosco-ana', 'Kiosco Ana', at);
  db.prepare('INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    'demo_a',
    'kiosco',
    'demo-kiosco',
    'reg_a',
    at,
    at,
  );
  return db;
}

describe('migración de sistema v11 embudo (M9)', () => {
  it('los comercios y las demos siguen; el comercio arranca sin demo ligada', () => {
    const db = baseV10();
    migrateDb(db, HASTA_V11);
    expect(db.prepare('SELECT id, name, demo_session_id FROM tenants').all()).toEqual([{ id: 'kiosco-ana', name: 'Kiosco Ana', demo_session_id: null }]);
    expect(db.prepare('SELECT id, template FROM demo_sessions').all()).toEqual([{ id: 'demo_a', template: 'kiosco' }]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 11 });
  });

  it('crea las tablas del embudo vacías', () => {
    const db = baseV10();
    migrateDb(db, HASTA_V11);
    for (const table of ['funnel_events', 'funnel_daily', 'funnel_contacts']) {
      expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
    }
  });

  it('un evento de demo y uno de comercio son únicos por tipo', () => {
    const db = baseV10();
    migrateDb(db, HASTA_V11);
    const insert = db.prepare('INSERT OR IGNORE INTO funnel_events (id, type, demo_session_id, tenant_id, at) VALUES (?, ?, ?, ?, ?)');
    insert.run('e1', 'demo-sale', 'demo_a', null, at);
    insert.run('e2', 'demo-sale', 'demo_a', null, at);
    insert.run('e3', 'catalog-loaded', null, 'kiosco-ana', at);
    insert.run('e4', 'catalog-loaded', null, 'kiosco-ana', at);
    expect(db.prepare('SELECT id FROM funnel_events ORDER BY id').all()).toEqual([{ id: 'e1' }, { id: 'e3' }]);
  });
});
