import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

/** Solo hasta la v7: cada test de migración prueba la suya. */
const HASTA_V7 = { ...SYSTEM_SCHEMA, migrations: SYSTEM_SCHEMA.migrations.filter((m) => m.version <= 7) };

describe('migración de sistema v7 plataforma (#23)', () => {
  it('suma estado de usuarios, suspensiones, invitaciones de soporte y el impersonador de la auditoría sin perder datos', () => {
    const db = createDbAtVersion(SYSTEM_SCHEMA, 6);
    const at = '2026-10-01T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'a@x.com', 'h', 'Ana', 'user', ?)").run(at);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES ('k', 'k', 'Kiosco', ?, 'u1')").run(at);
    db.prepare(
      "INSERT INTO password_resets (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at, used_at) VALUES ('r1', 'u1', 'th', 'u1', 'k', ?, ?, ?)",
    ).run(at, at, at);
    db.prepare("INSERT INTO audit_log (id, at, actor_user_id, tenant_id, action, details) VALUES ('a1', ?, 'u1', 'k', 'tenant.created', '{}')").run(at);

    migrateDb(db, HASTA_V7);

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(db.prepare('SELECT id, status FROM users').all()).toEqual([{ id: 'u1', status: 'active' }]);
    expect(db.prepare('SELECT id, tenant_id, token_hash, used_at FROM password_resets').all()).toEqual([
      { id: 'r1', tenant_id: 'k', token_hash: 'th', used_at: at },
    ]);
    // Un restablecimiento desde la plataforma no tiene comercio
    db.prepare(
      "INSERT INTO password_resets (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at) VALUES ('r2', 'u1', 'th2', 'u1', NULL, ?, ?)",
    ).run(at, at);
    expect(db.prepare('SELECT id, impersonator_user_id FROM audit_log').all()).toEqual([{ id: 'a1', impersonator_user_id: null }]);
    db.prepare("INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES ('s1', 'k', ?, NULL, 'Pedido', 'u1')").run(at);
    db.prepare("INSERT INTO staff_invitations (id, email, token_hash, created_by, created_at, expires_at) VALUES ('i1', 's@x.com', 'h1', 'u1', ?, ?)").run(at, at);
    const indices = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_audit_at', 'idx_tenant_suspensions_tenant')").all() as { name: string }[]
    ).map((r) => r.name).sort();
    expect(indices).toEqual(['idx_audit_at', 'idx_tenant_suspensions_tenant']);
  });
});
