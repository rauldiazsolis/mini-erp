import type { Schema } from './types.ts';
import { v5CreditosYCobro } from './system/v5-creditos-y-cobro.ts';
import { v6AltaWhatsappRubro } from './system/v6-alta-whatsapp-rubro.ts';
import { v7Plataforma } from './system/v7-plataforma.ts';
import { v8ImpersonacionYAyuda } from './system/v8-impersonacion-y-ayuda.ts';
import { v9DemosV2 } from './system/v9-demos-v2.ts';
import { v10PortalCajas } from './system/v10-portal-cajas.ts';
import { v11Embudo } from './system/v11-embudo.ts';

/** Base de sistema (#47): línea de base 4 (la de M2). Desde acá, todo cambio es una migración. */
export const SYSTEM_SCHEMA: Schema = {
  kind: 'system',
  baselineVersion: 4,
  baselineSql: `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  global_role TEXT NOT NULL, -- 'root', 'support', 'user'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'maintenance', 'suspended'
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  role TEXT NOT NULL, -- 'owner', 'admin', 'member'
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'disabled'
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, tenant_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  key_prefix TEXT NOT NULL,
  branch TEXT NOT NULL,
  point_of_sale TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Demos aisladas (#9): un tenant sin dueño por demo, que vence por falta de uso
CREATE TABLE IF NOT EXISTS demo_sessions (
  tenant_id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Invitaciones por link (#19): un solo uso, vencen a las 48 h
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  revoked_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Links de restablecimiento de contraseña (#19)
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Auditoría (#19): sin FK al comercio, sobrevive si se borra
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  tenant_id TEXT,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, at);
`,
  migrations: [v5CreditosYCobro, v6AltaWhatsappRubro, v7Plataforma, v8ImpersonacionYAyuda, v9DemosV2, v10PortalCajas, v11Embudo],
};
