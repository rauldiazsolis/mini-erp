import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

/** Solo hasta la v6: cada test de migración prueba la suya. */
const HASTA_V6 = { ...SYSTEM_SCHEMA, migrations: SYSTEM_SCHEMA.migrations.filter((m) => m.version <= 6) };

describe('migración de sistema v6 alta-whatsapp-rubro (#22)', () => {
  it('suma users.whatsapp y tenants.business_type nulos, y los datos sobreviven', () => {
    const db = createDbAtVersion(SYSTEM_SCHEMA, 5);
    const at = '2026-10-01T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'a@x.com', 'h', 'Ana', 'user', ?)").run(at);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES ('k', 'k', 'Kiosco', ?, 'u1')").run(at);
    migrateDb(db, HASTA_V6);
    expect(db.prepare('SELECT id, name, whatsapp FROM users').all()).toEqual([{ id: 'u1', name: 'Ana', whatsapp: null }]);
    expect(db.prepare('SELECT id, holder_user_id, business_type FROM tenants').all()).toEqual([
      { id: 'k', holder_user_id: 'u1', business_type: null },
    ]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
  });
});
