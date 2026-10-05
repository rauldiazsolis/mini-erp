import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

const HASTA_V8 = { ...SYSTEM_SCHEMA, migrations: SYSTEM_SCHEMA.migrations.filter((m) => m.version <= 8) };

describe('migración de sistema v8 impersonación y ayuda (#23)', () => {
  it('suma la impersonación a las sesiones y los pedidos de ayuda sin perder datos', () => {
    const db = createDbAtVersion(SYSTEM_SCHEMA, 7);
    const at = '2026-10-05T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'a@x.com', 'h', 'Ana', 'user', ?)").run(at);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES ('k', 'k', 'Kiosco', ?, 'u1')").run(at);
    db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES ('tok', 'u1', ?, ?)").run(at, at);

    migrateDb(db, HASTA_V8);

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    expect(
      db.prepare('SELECT token, impersonator_user_id, parent_token, help_request_id, tenant_id, last_used_at FROM sessions').all(),
    ).toEqual([{ token: 'tok', impersonator_user_id: null, parent_token: null, help_request_id: null, tenant_id: null, last_used_at: null }]);
    db.prepare(
      "INSERT INTO help_requests (id, tenant_id, user_id, path, message, created_at, expires_at) VALUES ('h1', 'k', 'u1', '/admin/k/dashboard', 'Hola', ?, ?)",
    ).run(at, at);
    db.prepare("INSERT INTO help_request_takes (request_id, staff_user_id, at) VALUES ('h1', 'u1', ?)").run(at);
    expect(db.prepare('SELECT id, closed_at FROM help_requests').all()).toEqual([{ id: 'h1', closed_at: null }]);
    const indices = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND (name LIKE 'idx_sessions_%' OR name LIKE 'idx_help_%')")
        .all() as { name: string }[]
    )
      .map((r) => r.name)
      .sort();
    expect(indices).toEqual(['idx_help_request_takes_request', 'idx_help_requests_created', 'idx_help_requests_user', 'idx_sessions_parent', 'idx_sessions_user']);
  });
});
