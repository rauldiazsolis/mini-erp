import type { Migration } from '../types.ts';

/** Una fecha numerada (`ticket.date`, `receipt.date`) válida, o NULL. */
const numberedDate = (path: string): string =>
  `CASE WHEN json_extract(payload, '${path}') GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' THEN json_extract(payload, '${path}') END`;

/** El día argentino del `createdAt` del payload o, si no hay, del de la fila. */
const instantDay = `COALESCE(date(json_extract(payload, '$.createdAt'), '-3 hours'), date(created_at, '-3 hours'))`;

/**
 * Ventas y caja (#20): columnas derivadas del payload para filtrar y agrupar con SQL (el día
 * argentino como el `/RESUMEN` del POS, el cliente de la venta, los números de ticket y de recibo),
 * las cobranzas del admin con la forma del contrato e índices. El payload sigue siendo la fuente.
 * Un payload que no es JSON no tumba la migración: su día sale de `created_at`.
 */
export const v5VentasYCaja: Migration = {
  version: 5,
  name: 'ventas-y-caja',
  up: (db) => {
    db.exec(`
ALTER TABLE sales ADD COLUMN day TEXT;
ALTER TABLE sales ADD COLUMN customer_id TEXT;
ALTER TABLE sales ADD COLUMN ticket_date TEXT;
ALTER TABLE sales ADD COLUMN ticket_number INTEGER;
UPDATE sales SET
  customer_id = json_extract(payload, '$.customerId'),
  ticket_date = ${numberedDate('$.ticket.date')},
  ticket_number = json_extract(payload, '$.ticket.number'),
  day = COALESCE(${numberedDate('$.ticket.date')}, ${instantDay})
WHERE json_valid(payload);
UPDATE sales SET day = date(created_at, '-3 hours') WHERE day IS NULL;

ALTER TABLE customer_payments ADD COLUMN day TEXT;
ALTER TABLE customer_payments ADD COLUMN receipt_date TEXT;
ALTER TABLE customer_payments ADD COLUMN receipt_number INTEGER;
UPDATE customer_payments SET payload = json_object(
  'id', id,
  'customerId', customer_id,
  'payments', json_array(
    CASE WHEN json_extract(payload, '$.reference') IS NULL
      THEN json_object('method', COALESCE(json_extract(payload, '$.method'), 'cash'), 'amount', json_extract(payload, '$.total'))
      ELSE json_object('method', COALESCE(json_extract(payload, '$.method'), 'cash'), 'amount', json_extract(payload, '$.total'), 'reference', json_extract(payload, '$.reference'))
    END),
  'total', json_extract(payload, '$.total'),
  'createdAt', created_at)
WHERE json_valid(payload) AND json_type(payload, '$.payments') IS NULL AND device_id = 'admin_panel';
UPDATE customer_payments SET
  receipt_date = ${numberedDate('$.receipt.date')},
  receipt_number = json_extract(payload, '$.receipt.number'),
  day = COALESCE(${numberedDate('$.receipt.date')}, ${instantDay})
WHERE json_valid(payload);
UPDATE customer_payments SET day = date(created_at, '-3 hours') WHERE day IS NULL;

ALTER TABLE cash_movements ADD COLUMN day TEXT;
UPDATE cash_movements SET day = ${instantDay} WHERE json_valid(payload);
UPDATE cash_movements SET day = date(created_at, '-3 hours') WHERE day IS NULL;

CREATE INDEX IF NOT EXISTS idx_sales_day ON sales (day, branch, point_of_sale);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales (customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_payments_day ON customer_payments (day, branch, point_of_sale);
CREATE INDEX IF NOT EXISTS idx_cash_movements_day ON cash_movements (day, branch, point_of_sale);
`);
  },
};
