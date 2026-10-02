import type { Migration } from '../types.ts';

/**
 * Cobranzas (#2): la anulación (4.3.0) apunta a la original (`voids_payment_id`, rellenado del payload)
 * y la tabla deja de tener clave foránea a `customers`, para guardar la cobranza de un cliente que el
 * mini-erp todavía no tiene (queda como discrepancia y se aplica cuando llega). SQLite no saca una
 * clave foránea con ALTER: se reconstruye la tabla.
 */
export const v3AnulacionCobranzas: Migration = {
  version: 3,
  name: 'anulacion-cobranzas',
  up: (db) => {
    db.exec(`
CREATE TABLE customer_payments_v3 (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON de CustomerPayment
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  voids_payment_id TEXT, -- la cobranza que anula (4.3.0)
  created_at TEXT NOT NULL
);
INSERT INTO customer_payments_v3 (id, customer_id, payload, device_id, branch, point_of_sale, voids_payment_id, created_at)
  SELECT id, customer_id, payload, device_id, branch, point_of_sale, json_extract(payload, '$.voidsPaymentId'), created_at
  FROM customer_payments;
DROP TABLE customer_payments;
ALTER TABLE customer_payments_v3 RENAME TO customer_payments;
CREATE INDEX IF NOT EXISTS idx_customer_payments_voids ON customer_payments (voids_payment_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_customer ON customer_payments (customer_id);
`);
  },
};
