import { sql } from 'kysely';
import type { Migration } from '../types.ts';

/**
 * Línea de base del esquema `system` en PostgreSQL: lo que en SQLite era `system.sqlite` v11.
 * No se toca nunca más: cada cambio es una migración nueva.
 *
 * Dinero en `numeric(14,2)`, instantes en `timestamptz`, días argentinos en `date` (también
 * `tenants.grace_until`). Las columnas
 * `seq` desempatan el orden donde antes se usaba el `rowid` de SQLite.
 */
export const v1LineaDeBase: Migration = {
  version: 1,
  name: 'linea-de-base',
  up: async (db) => {
    await sql
      .raw(
        `
CREATE TABLE users (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  name text NOT NULL,
  global_role text NOT NULL,
  whatsapp text,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL
);

CREATE TABLE tenants (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL,
  holder_user_id text,
  grace_until date,
  business_type text,
  demo_session_id text
);
CREATE INDEX idx_tenants_demo_session ON tenants (demo_session_id);

CREATE TABLE sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  impersonator_user_id text,
  parent_token text,
  help_request_id text,
  tenant_id text,
  last_used_at timestamptz
);
CREATE INDEX idx_sessions_user ON sessions (user_id);
CREATE INDEX idx_sessions_parent ON sessions (parent_token);

CREATE TABLE memberships (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, tenant_id)
);

CREATE TABLE registers (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  branch text NOT NULL,
  point_of_sale text NOT NULL,
  device_id text,
  bound_at timestamptz,
  last_seen_at timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_registers_tenant ON registers (tenant_id);

CREATE TABLE register_devices (
  register_id text NOT NULL REFERENCES registers (id) ON DELETE CASCADE,
  device_id text NOT NULL,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  PRIMARY KEY (register_id, device_id)
);

CREATE TABLE tenant_api_keys (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL,
  key_prefix text NOT NULL,
  branch text NOT NULL,
  point_of_sale text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL,
  register_id text
);

CREATE TABLE invitations (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by text,
  revoked_at timestamptz
);

CREATE TABLE staff_invitations (
  id text PRIMARY KEY,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by text,
  revoked_at timestamptz
);

CREATE TABLE password_resets (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  created_by text NOT NULL,
  tenant_id text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

-- Sin FK a propósito: la auditoría sobrevive a lo que nombra.
CREATE TABLE audit_log (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  at timestamptz NOT NULL,
  actor_user_id text NOT NULL,
  tenant_id text,
  action text NOT NULL,
  target_user_id text,
  details jsonb NOT NULL DEFAULT '{}',
  impersonator_user_id text,
  actor_register_id text
);
CREATE INDEX idx_audit_at ON audit_log (at);
CREATE INDEX idx_audit_tenant ON audit_log (tenant_id, at);

CREATE TABLE tenant_suspensions (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  from_at timestamptz NOT NULL,
  to_at timestamptz,
  reason text NOT NULL,
  created_by text NOT NULL
);
CREATE INDEX idx_tenant_suspensions_tenant ON tenant_suspensions (tenant_id, from_at);

CREATE TABLE help_requests (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  path text NOT NULL,
  message text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz
);
CREATE INDEX idx_help_requests_user ON help_requests (user_id, closed_at);
CREATE INDEX idx_help_requests_created ON help_requests (created_at);

CREATE TABLE help_request_takes (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  request_id text NOT NULL REFERENCES help_requests (id) ON DELETE CASCADE,
  staff_user_id text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX idx_help_request_takes_request ON help_request_takes (request_id);

CREATE TABLE demo_tenants (
  seq bigint GENERATED ALWAYS AS IDENTITY,
  tenant_id text PRIMARY KEY,
  template text NOT NULL UNIQUE,
  last_full_reset_at timestamptz NOT NULL,
  last_partial_reset_at timestamptz
);

-- El registro de demos nunca se borra: sin FK al comercio ni a la caja.
CREATE TABLE demo_sessions (
  id text PRIMARY KEY,
  template text NOT NULL,
  tenant_id text NOT NULL,
  register_id text NOT NULL,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoke_reason text
);
CREATE INDEX idx_demo_sessions_open ON demo_sessions (revoked_at, last_used_at);
CREATE INDEX idx_demo_sessions_register ON demo_sessions (register_id);

CREATE TABLE anonymous_sessions (
  token_hash text PRIMARY KEY,
  kind text NOT NULL,
  tenant_id text NOT NULL,
  register_id text NOT NULL,
  api_key_id text NOT NULL,
  demo_session_id text,
  created_at timestamptz NOT NULL,
  last_used_at timestamptz NOT NULL
);
CREATE INDEX idx_anonymous_sessions_register ON anonymous_sessions (register_id);

CREATE TABLE portal_links (
  token_hash text PRIMARY KEY,
  tenant_id text NOT NULL,
  register_id text NOT NULL,
  api_key_id text,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX idx_portal_links_register ON portal_links (register_id);

CREATE TABLE billing_settings (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL
);

-- device_id '' es el cargo de la caja; si no, el de un equipo ajeno.
CREATE TABLE charges (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  register_id text NOT NULL,
  device_id text NOT NULL,
  day date NOT NULL,
  amount numeric(14,2) NOT NULL,
  paid_amount numeric(14,2) NOT NULL,
  gift_amount numeric(14,2) NOT NULL,
  debt_amount numeric(14,2) NOT NULL,
  debt_settled_at timestamptz,
  rule text NOT NULL,
  created_at timestamptz NOT NULL,
  UNIQUE (register_id, device_id, day)
);
CREATE INDEX idx_charges_tenant_day ON charges (tenant_id, day);

CREATE TABLE paid_movements (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  kind text NOT NULL,
  amount numeric(14,2) NOT NULL,
  tenant_id text,
  charge_id text,
  payment_ref text,
  day date NOT NULL,
  info text,
  created_by text,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_paid_movements_user ON paid_movements (user_id, created_at);
CREATE INDEX idx_paid_movements_tenant ON paid_movements (tenant_id, created_at);
CREATE UNIQUE INDEX idx_paid_movements_ref ON paid_movements (payment_ref) WHERE payment_ref IS NOT NULL;

CREATE TABLE gift_credits (
  id text PRIMARY KEY,
  tenant_id text NOT NULL,
  amount numeric(14,2) NOT NULL,
  expires_at timestamptz NOT NULL,
  origin text NOT NULL,
  granted_by text,
  reason text,
  voided_at timestamptz,
  voided_by text,
  void_reason text,
  created_at timestamptz NOT NULL
);
CREATE INDEX idx_gift_credits_tenant ON gift_credits (tenant_id, expires_at);

CREATE TABLE gift_consumptions (
  charge_id text NOT NULL,
  credit_id text NOT NULL,
  amount numeric(14,2) NOT NULL,
  PRIMARY KEY (charge_id, credit_id)
);
CREATE INDEX idx_gift_consumptions_credit ON gift_consumptions (credit_id);

CREATE TABLE funnel_events (
  id text PRIMARY KEY,
  type text NOT NULL,
  demo_session_id text,
  tenant_id text,
  at timestamptz NOT NULL,
  data jsonb
);
CREATE INDEX idx_funnel_events_at ON funnel_events (at);
CREATE UNIQUE INDEX idx_funnel_events_demo ON funnel_events (demo_session_id, type) WHERE demo_session_id IS NOT NULL;
CREATE UNIQUE INDEX idx_funnel_events_tenant ON funnel_events (tenant_id, type) WHERE tenant_id IS NOT NULL;

CREATE TABLE funnel_daily (
  day date NOT NULL,
  kind text NOT NULL,
  count integer NOT NULL,
  PRIMARY KEY (day, kind)
);

CREATE TABLE funnel_contacts (
  id text PRIMARY KEY,
  demo_session_id text,
  source text NOT NULL,
  name text,
  whatsapp text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  handled_at timestamptz,
  handled_by text,
  erased_at timestamptz
);
CREATE INDEX idx_funnel_contacts_created ON funnel_contacts (created_at);
CREATE UNIQUE INDEX idx_funnel_contacts_demo ON funnel_contacts (demo_session_id) WHERE demo_session_id IS NOT NULL;
`,
      )
      .execute(db);
  },
};
