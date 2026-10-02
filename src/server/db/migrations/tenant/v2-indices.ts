import type { Migration } from '../types.ts';

/** Índices para el dashboard, el Kardex, el extracto de cuenta corriente y los holds (#47). */
export const v2Indices: Migration = {
  version: 2,
  name: 'indices',
  up: (db) => {
    db.exec(`
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales (created_at);
CREATE INDEX IF NOT EXISTS idx_sales_voids_sale_id ON sales (voids_sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements (product_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stock_movements_created_at ON stock_movements (created_at);
CREATE INDEX IF NOT EXISTS idx_account_movements_customer ON account_movements (customer_id, created_at);
CREATE INDEX IF NOT EXISTS idx_account_holds_customer ON account_holds (customer_id, status);
`);
  },
};
