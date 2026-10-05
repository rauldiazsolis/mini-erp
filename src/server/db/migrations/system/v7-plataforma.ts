import type { Migration } from '../types.ts';

/**
 * Plataforma (#23, M7a): estado de los usuarios, períodos de suspensión de los comercios,
 * invitaciones de soporte (sin comercio), restablecimientos sin comercio (desde la plataforma) y el
 * impersonador en la auditoría (se llena desde M7b). `password_resets` se reconstruye para que
 * `tenant_id` acepte NULL.
 */
export const v7Plataforma: Migration = {
  version: 7,
  name: 'plataforma',
  up: (db) => {
    db.exec(`
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE audit_log ADD COLUMN impersonator_user_id TEXT;
CREATE INDEX idx_audit_at ON audit_log (at);

CREATE TABLE tenant_suspensions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_at TEXT NOT NULL,
  to_at TEXT,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_tenant_suspensions_tenant ON tenant_suspensions (tenant_id, from_at);

CREATE TABLE staff_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  revoked_at TEXT
);

CREATE TABLE password_resets_v7 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO password_resets_v7 (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at, used_at)
  SELECT id, user_id, token_hash, created_by, tenant_id, created_at, expires_at, used_at FROM password_resets;
DROP TABLE password_resets;
ALTER TABLE password_resets_v7 RENAME TO password_resets;
`);
  },
};
