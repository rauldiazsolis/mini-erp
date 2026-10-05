import type { Migration } from '../types.ts';

/**
 * El portal de las cajas reales (M10, #26): la sesión anónima pasa a tener tipo (`demo` o `register`)
 * y queda atada a la key que pidió el link, así rotarla la corta. Las de demo ya existentes toman la
 * key activa de su caja; sin key activa, su caja ya está revocada y se descartan. La auditoría suma la
 * caja como actor.
 */
export const v10PortalCajas: Migration = {
  version: 10,
  name: 'portal-cajas',
  up: (db) => {
    db.exec(`
CREATE TABLE anonymous_sessions_v10 (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  demo_session_id TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL
);
INSERT INTO anonymous_sessions_v10 (token_hash, kind, tenant_id, register_id, api_key_id, demo_session_id, created_at, last_used_at)
  SELECT s.token_hash, 'demo', s.tenant_id, s.register_id, k.id, s.demo_session_id, s.created_at, s.last_used_at
  FROM anonymous_sessions s JOIN tenant_api_keys k ON k.register_id = s.register_id AND k.active = 1;
DROP TABLE anonymous_sessions;
ALTER TABLE anonymous_sessions_v10 RENAME TO anonymous_sessions;
CREATE INDEX idx_anonymous_sessions_register ON anonymous_sessions (register_id);

ALTER TABLE portal_links ADD COLUMN api_key_id TEXT;
ALTER TABLE audit_log ADD COLUMN actor_register_id TEXT;
`);
  },
};
