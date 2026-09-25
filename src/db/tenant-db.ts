import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const TENANT_SCHEMA_VERSION = 1;

const TENANT_SCHEMA = `
CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  sku TEXT UNIQUE NOT NULL,
  barcodes TEXT NOT NULL DEFAULT '[]', -- JSON array de strings
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'General',
  tracks_stock INTEGER NOT NULL DEFAULT 1,
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock (
  product_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (product_id, branch_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  document TEXT,
  phone TEXT,
  credit_limit REAL,
  margin REAL,
  balance REAL,
  unrestricted INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS account_holds (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  amount REAL NOT NULL,
  status TEXT NOT NULL, -- 'pending', 'confirmed', 'released'
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  released_at TEXT,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS account_movements (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'sale', 'payment', 'adjustment', 'interest'
  amount REAL NOT NULL, -- positivo aumenta deuda / saldo deudor, negativo acredita
  balance_after REAL NOT NULL,
  description TEXT,
  sale_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL, -- JSON completo de Sale según OpenAPI
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  total REAL NOT NULL,
  voids_sale_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  delta REAL NOT NULL,
  reason TEXT NOT NULL, -- 'sale', 'sale-void', 'adjustment', 'restock'
  sale_id TEXT,
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  payload TEXT NOT NULL, -- JSON de CashMovement
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_payments (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  payload TEXT NOT NULL, -- JSON de CustomerPayment
  device_id TEXT,
  branch TEXT,
  point_of_sale TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS push_lots (
  id TEXT PRIMARY KEY, -- ULID o Idempotency-Key
  device_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'queued', 'processing', 'ok', 'issues'
  events TEXT NOT NULL, -- JSON array de OutboxBatchItem
  issues TEXT, -- JSON array de LotIssue
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key TEXT PRIMARY KEY,
  status INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export function initTenantDb(db: DatabaseSync): void {
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number };
  if (versionRow.user_version !== TENANT_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${TENANT_SCHEMA_VERSION}`);
  }
  db.exec(TENANT_SCHEMA);
}

export function openTenantDb(path: string): DatabaseSync {
  if (path !== ':memory:') {
    const dir = dirname(path);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  const db = new DatabaseSync(path);
  initTenantDb(db);
  return db;
}
