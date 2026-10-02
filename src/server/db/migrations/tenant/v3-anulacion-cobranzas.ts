import type { Migration } from '../types.ts';

/** La anulación de una cobranza (4.3.0) apunta a la original: columna e índice, rellenados del payload (#2). */
export const v3AnulacionCobranzas: Migration = {
  version: 3,
  name: 'anulacion-cobranzas',
  up: (db) => {
    db.exec(`
ALTER TABLE customer_payments ADD COLUMN voids_payment_id TEXT;
UPDATE customer_payments SET voids_payment_id = json_extract(payload, '$.voidsPaymentId')
  WHERE json_extract(payload, '$.voidsPaymentId') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_customer_payments_voids ON customer_payments (voids_payment_id);
`);
  },
};
