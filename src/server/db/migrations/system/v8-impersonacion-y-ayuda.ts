import type { Migration } from '../types.ts';

/**
 * Impersonación y pedidos de ayuda (#23, M7b): una impersonación es una sesión más, con quién la
 * abrió, su sesión padre, el comercio de entrada, el pedido que atiende y el último uso (vence a las
 * 2 h sin uso). Los pedidos de ayuda vencen a las 24 h y registran cada toma de soporte.
 */
export const v8ImpersonacionYAyuda: Migration = {
  version: 8,
  name: 'impersonacion-y-ayuda',
  up: (db) => {
    db.exec(`
ALTER TABLE sessions ADD COLUMN impersonator_user_id TEXT;
ALTER TABLE sessions ADD COLUMN parent_token TEXT;
ALTER TABLE sessions ADD COLUMN help_request_id TEXT;
ALTER TABLE sessions ADD COLUMN tenant_id TEXT;
ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
CREATE INDEX idx_sessions_parent ON sessions (parent_token);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE help_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_help_requests_created ON help_requests (created_at);
CREATE INDEX idx_help_requests_user ON help_requests (user_id, closed_at);

CREATE TABLE help_request_takes (
  request_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES help_requests(id) ON DELETE CASCADE
);
CREATE INDEX idx_help_request_takes_request ON help_request_takes (request_id);
`);
  },
};
