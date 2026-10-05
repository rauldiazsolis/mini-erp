import type { Migration } from '../types.ts';

/**
 * Demos v2 (#24, M8): un comercio fijo por rubro (`demo_tenants`), una caja por visitante con su
 * sesión (`demo_sessions`, que nunca se borra: la usa M9), las sesiones anónimas del portal y sus
 * links. Las demos por tenant de #9 quedan en `legacy_demo_sessions` para que el arranque las borre:
 * una migración no borra archivos.
 */
export const v9DemosV2: Migration = {
  version: 9,
  name: 'demos-v2',
  up: (db) => {
    db.exec(`
ALTER TABLE demo_sessions RENAME TO legacy_demo_sessions;

CREATE TABLE demo_tenants (
  tenant_id TEXT PRIMARY KEY,
  template TEXT NOT NULL UNIQUE,
  last_full_reset_at TEXT NOT NULL,
  last_partial_reset_at TEXT
);

CREATE TABLE demo_sessions (
  id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT,
  revoke_reason TEXT
);
CREATE INDEX idx_demo_sessions_register ON demo_sessions (register_id);
CREATE INDEX idx_demo_sessions_open ON demo_sessions (revoked_at, last_used_at);

CREATE TABLE anonymous_sessions (
  token_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  demo_session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
CREATE INDEX idx_anonymous_sessions_register ON anonymous_sessions (register_id);

CREATE TABLE portal_links (
  token_hash TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT
);
CREATE INDEX idx_portal_links_register ON portal_links (register_id);
`);
  },
};
