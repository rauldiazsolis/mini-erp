import { sql } from 'kysely';
import type { Migration } from '../types.ts';

/**
 * Línea de base del esquema de un comercio (`tenant_<id>`) en PostgreSQL: lo que en SQLite era
 * `tenants/<id>.sqlite` v6. No se toca nunca más: cada cambio es una migración nueva.
 *
 * Dinero en `numeric(14,2)`, cantidades en `numeric(14,4)` (pesables y fracciones), instantes en
 * `timestamptz`, días argentinos en `date` (también la fecha de un ticket o de un recibo) y lo que
 * era JSON en texto, en `jsonb`. Las columnas `seq` desempatan el orden donde antes se usaba el
 * `rowid` de SQLite.
 */
export const v1LineaDeBase: Migration = {
  version: 1,
  name: 'linea-de-base',
  up: async (db) => {
    await sql
      .raw(
        `
CREATE TABLE branches (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL
);

CREATE TABLE products (
  id text PRIMARY KEY,
  sku text NOT NULL UNIQUE,
  barcodes jsonb NOT NULL DEFAULT '[]',
  name text NOT NULL,
  price numeric(14,2) NOT NULL DEFAULT 0,
  tax_rate numeric(7,4) NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'General',
  tracks_stock boolean NOT NULL DEFAULT true,
  blocked_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE stock (
  product_id text NOT NULL REFERENCES products (id) ON DELETE CASCADE,
  branch_id text NOT NULL REFERENCES branches (id) ON DELETE CASCADE,
  quantity numeric(14,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (product_id, branch_id)
);

-- product_id sin FK: el kardex guarda también el movimiento de un producto que el comercio no tiene
-- (el push nunca rechaza) y sobrevive al producto.
CREATE TABLE stock_movements (
  id text PRIMARY KEY,
  product_id text NOT NULL,
  branch_id text NOT NULL,
  delta numeric(14,4) NOT NULL,
  reason text NOT NULL,
  notes text,
  sale_id text,
  device_id text,
  branch text,
  point_of_sale text,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_stock_movements_product ON stock_movements (product_id, created_at);
CREATE INDEX idx_stock_movements_created_at ON stock_movements (created_at);

CREATE TABLE customers (
  id text PRIMARY KEY,
  name text NOT NULL,
  document text,
  phone text,
  credit_limit numeric(14,2),
  margin numeric(14,2),
  balance numeric(14,2),
  unrestricted boolean NOT NULL DEFAULT false,
  blocked_reason text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE account_holds (
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  amount numeric(14,2) NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  released_at timestamptz
);
CREATE INDEX idx_account_holds_customer ON account_holds (customer_id, status);

-- amount positivo aumenta el saldo deudor; negativo, acredita.
CREATE TABLE account_movements (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  customer_id text NOT NULL REFERENCES customers (id) ON DELETE CASCADE,
  type text NOT NULL,
  amount numeric(14,2) NOT NULL,
  balance_after numeric(14,2) NOT NULL,
  description text,
  sale_id text,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_account_movements_customer ON account_movements (customer_id, created_at);

-- payload es la Sale completa del contrato; las demás columnas se derivan de ahí.
CREATE TABLE sales (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  device_id text,
  branch text,
  point_of_sale text,
  total numeric(14,2) NOT NULL,
  voids_sale_id text,
  created_at timestamptz NOT NULL,
  day date,
  customer_id text,
  ticket_date date,
  ticket_number bigint,
  register_id text,
  charge_device text
);
CREATE INDEX idx_sales_created_at ON sales (created_at);
CREATE INDEX idx_sales_voids_sale_id ON sales (voids_sale_id);
CREATE INDEX idx_sales_day ON sales (day, branch, point_of_sale);
CREATE INDEX idx_sales_customer ON sales (customer_id);
CREATE INDEX idx_sales_register_day ON sales (register_id, charge_device, day);

CREATE TABLE cash_movements (
  id text PRIMARY KEY,
  payload jsonb NOT NULL,
  device_id text,
  branch text,
  point_of_sale text,
  created_at timestamptz NOT NULL,
  day date
);
CREATE INDEX idx_cash_movements_day ON cash_movements (day, branch, point_of_sale);

CREATE TABLE customer_payments (
  id text PRIMARY KEY,
  customer_id text NOT NULL,
  payload jsonb NOT NULL,
  device_id text,
  branch text,
  point_of_sale text,
  voids_payment_id text,
  created_at timestamptz NOT NULL,
  day date,
  receipt_date date,
  receipt_number bigint
);
CREATE INDEX idx_customer_payments_customer ON customer_payments (customer_id);
CREATE INDEX idx_customer_payments_voids ON customer_payments (voids_payment_id);
CREATE INDEX idx_customer_payments_day ON customer_payments (day, branch, point_of_sale);

CREATE TABLE push_lots (
  id text PRIMARY KEY,
  device_id text NOT NULL,
  status text NOT NULL,
  events jsonb NOT NULL,
  issues jsonb,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE idempotency_keys (
  key text PRIMARY KEY,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE tenant_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- customer_id sin FK: una discrepancia puede nombrar a un cliente que todavía no existe.
CREATE TABLE discrepancies (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  kind text NOT NULL,
  device_id text,
  origin_branch text,
  origin_pos text,
  customer_id text NOT NULL,
  ref_type text NOT NULL,
  ref_id text NOT NULL,
  amount numeric(14,2) NOT NULL,
  pending jsonb,
  created_at timestamptz NOT NULL,
  resolved_at timestamptz,
  resolution text,
  resolved_by text,
  note text
);
CREATE INDEX idx_discrepancies_open ON discrepancies (resolved_at, device_id);
CREATE INDEX idx_discrepancies_customer ON discrepancies (customer_id, resolved_at);
`,
      )
      .execute(db);
  },
};
