import type { Migration } from '../types.ts';

/**
 * El embudo (M9, #25): el comercio queda ligado a la demo de la que salió, los eventos que no quedan
 * en ningún otro lado (la venta demo se borra con el reinicio, la sesión anónima al revocar), los
 * totales anónimos del landing y los contactos. Sin IP ni navegador.
 */
export const v11Embudo: Migration = {
  version: 11,
  name: 'embudo',
  up: (db) => {
    db.exec(`
ALTER TABLE tenants ADD COLUMN demo_session_id TEXT;
CREATE INDEX idx_tenants_demo_session ON tenants (demo_session_id);

CREATE TABLE funnel_events (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  demo_session_id TEXT,
  tenant_id TEXT,
  at TEXT NOT NULL,
  data TEXT
);
CREATE UNIQUE INDEX idx_funnel_events_demo ON funnel_events (demo_session_id, type) WHERE demo_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_funnel_events_tenant ON funnel_events (tenant_id, type) WHERE tenant_id IS NOT NULL;
CREATE INDEX idx_funnel_events_at ON funnel_events (at);

CREATE TABLE funnel_daily (
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (day, kind)
);

CREATE TABLE funnel_contacts (
  id TEXT PRIMARY KEY,
  demo_session_id TEXT,
  source TEXT NOT NULL,
  name TEXT,
  whatsapp TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  handled_at TEXT,
  handled_by TEXT,
  erased_at TEXT
);
CREATE UNIQUE INDEX idx_funnel_contacts_demo ON funnel_contacts (demo_session_id) WHERE demo_session_id IS NOT NULL;
CREATE INDEX idx_funnel_contacts_created ON funnel_contacts (created_at);
`);
  },
};
