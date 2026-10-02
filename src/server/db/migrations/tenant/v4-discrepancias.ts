import type { Migration } from '../types.ts';

/** Discrepancias del push para revisar (#2): de ahí salen los avisos (`notices`) de cada caja. */
export const v4Discrepancias: Migration = {
  version: 4,
  name: 'discrepancias',
  up: (db) => {
    db.exec(`
CREATE TABLE IF NOT EXISTS discrepancies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  device_id TEXT,
  origin_branch TEXT,
  origin_pos TEXT,
  customer_id TEXT NOT NULL,
  ref_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  amount REAL NOT NULL,
  pending TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolution TEXT,
  resolved_by TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_discrepancies_open ON discrepancies (resolved_at, device_id);
CREATE INDEX IF NOT EXISTS idx_discrepancies_customer ON discrepancies (customer_id, resolved_at);
`);
  },
};
