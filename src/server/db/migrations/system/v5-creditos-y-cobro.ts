import type { Migration } from '../types.ts';

/**
 * Créditos y cobro (#21): la caja como entidad (con su equipo ligado y sus keys), el titular y la
 * gracia del comercio, y las tablas de cobro. Cada key existente genera su caja. Los comercios con
 * titular reciben el bono de alta ($50.000 a 90 días): los valores quedan fijos acá, aunque la
 * configuración cambie después.
 */
export const v5CreditosYCobro: Migration = {
  version: 5,
  name: 'creditos-y-cobro',
  up: (db) => {
    db.exec(`
CREATE TABLE registers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  branch TEXT NOT NULL,
  point_of_sale TEXT NOT NULL,
  device_id TEXT,
  bound_at TEXT,
  last_seen_at TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_registers_tenant ON registers (tenant_id);

ALTER TABLE tenant_api_keys ADD COLUMN register_id TEXT;
INSERT INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at)
  SELECT 'reg_' || id, tenant_id, name, branch, point_of_sale, active, created_at FROM tenant_api_keys;
UPDATE tenant_api_keys SET register_id = 'reg_' || id;

CREATE TABLE register_devices (
  register_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (register_id, device_id),
  FOREIGN KEY (register_id) REFERENCES registers(id) ON DELETE CASCADE
);

ALTER TABLE tenants ADD COLUMN holder_user_id TEXT;
ALTER TABLE tenants ADD COLUMN grace_until TEXT;
UPDATE tenants SET holder_user_id = (
  SELECT m.user_id FROM memberships m
  WHERE m.tenant_id = tenants.id AND m.role = 'owner' AND m.status = 'active'
  ORDER BY m.created_at, m.user_id LIMIT 1
) WHERE id NOT IN (SELECT tenant_id FROM demo_sessions);

CREATE TABLE billing_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE paid_movements (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL, -- 'payment', 'charge', 'debt-settlement', 'refund'
  amount REAL NOT NULL,
  tenant_id TEXT,
  charge_id TEXT,
  payment_ref TEXT,
  day TEXT NOT NULL,
  info TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_paid_movements_user ON paid_movements (user_id, created_at);
CREATE INDEX idx_paid_movements_tenant ON paid_movements (tenant_id, created_at);
CREATE UNIQUE INDEX idx_paid_movements_ref ON paid_movements (payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE gift_credits (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  amount REAL NOT NULL,
  expires_at TEXT NOT NULL,
  origin TEXT NOT NULL, -- 'signup', 'grant'
  granted_by TEXT,
  reason TEXT,
  voided_at TEXT,
  voided_by TEXT,
  void_reason TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_gift_credits_tenant ON gift_credits (tenant_id, expires_at);

CREATE TABLE gift_consumptions (
  charge_id TEXT NOT NULL,
  credit_id TEXT NOT NULL,
  amount REAL NOT NULL,
  PRIMARY KEY (charge_id, credit_id)
);
CREATE INDEX idx_gift_consumptions_credit ON gift_consumptions (credit_id);

CREATE TABLE charges (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  register_id TEXT NOT NULL,
  device_id TEXT NOT NULL, -- '' = el cargo de la caja; si no, el equipo ajeno
  day TEXT NOT NULL,
  amount REAL NOT NULL,
  paid_amount REAL NOT NULL,
  gift_amount REAL NOT NULL,
  debt_amount REAL NOT NULL,
  debt_settled_at TEXT,
  rule TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (register_id, device_id, day)
);
CREATE INDEX idx_charges_tenant_day ON charges (tenant_id, day);

INSERT INTO gift_credits (id, tenant_id, amount, expires_at, origin, reason, created_at)
  SELECT 'gift_' || lower(hex(randomblob(16))), id, 50000,
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+90 days'), 'signup', 'Bono de alta',
         strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM tenants WHERE holder_user_id IS NOT NULL;
`);
  },
};
