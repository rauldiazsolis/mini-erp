/**
 * Roles del comercio y capacidades (#19), compartidos por servidor y cliente. Permisos fijos: nada
 * configurable en el MVP. Root y support impersonando cuentan como owner hasta M7.
 */
export const TENANT_ROLES = ['owner', 'admin', 'member'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export type MembershipRole = TenantRole | 'root_impersonator' | 'support_impersonator';
export type Capability = 'tenant.use' | 'bulk' | 'settings.manage' | 'users.manage' | 'owners.manage' | 'credits.view';

const MATRIX: Record<Capability, readonly TenantRole[]> = {
  'tenant.use': ['owner', 'admin', 'member'],
  bulk: ['owner', 'admin'],
  'settings.manage': ['owner', 'admin'],
  'users.manage': ['owner', 'admin'],
  'owners.manage': ['owner'],
  // Créditos y cobro (#21): saldos, consumo y cómo pagar
  'credits.view': ['owner', 'admin'],
};

export function can(role: TenantRole, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

export function assignableRoles(actor: TenantRole): TenantRole[] {
  if (actor === 'owner') return ['owner', 'admin', 'member'];
  if (actor === 'admin') return ['admin', 'member'];
  return [];
}

export function effectiveTenantRole(role: MembershipRole): TenantRole {
  return role === 'root_impersonator' || role === 'support_impersonator' ? 'owner' : role;
}

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}
