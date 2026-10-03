import type { Migration } from '../types.ts';

/**
 * Caja de cada venta (#21): la caja de la key que la empujó y a qué equipo se cobró (`''` = la caja,
 * si no el equipo ajeno). Las ventas anteriores quedan en NULL y nunca se cobran.
 */
export const v6CajaDeVenta: Migration = {
  version: 6,
  name: 'caja-de-venta',
  up: (db) => {
    db.exec(`
ALTER TABLE sales ADD COLUMN register_id TEXT;
ALTER TABLE sales ADD COLUMN charge_device TEXT;
CREATE INDEX IF NOT EXISTS idx_sales_register_day ON sales (register_id, charge_device, day);
`);
  },
};
