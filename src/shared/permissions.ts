/**
 * Roles del comercio y capacidades (#19), compartidos por servidor y cliente. Permisos fijos: nada
 * configurable en el MVP. Root y soporte no son miembros: entran impersonando a un usuario (#16, #23).
 */
export const TENANT_ROLES = ['owner', 'admin', 'member'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export type Capability =
  | 'tenant.view'
  | 'sales.view'
  | 'tenant.use'
  | 'bulk'
  | 'settings.manage'
  | 'users.manage'
  | 'owners.manage'
  | 'credits.view';

const MATRIX: Record<Capability, readonly TenantRole[]> = {
  // Consultar el comercio (M10): catálogo, stock, clientes, sucursales y estado de cobro
  'tenant.view': ['owner', 'admin', 'member'],
  // Consultar Ventas & Caja (M10)
  'sales.view': ['owner', 'admin', 'member'],
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

/** Quién opera (M10): un usuario (o quien lo impersona), el visitante de una demo o una caja real desde el POS. */
export type Access = 'user' | 'demo' | 'register';

/** Lo que no puede el acceso anónimo de una demo (#24): usuarios, owners, créditos ni configuración. */
export const ANONYMOUS_DENIED: readonly Capability[] = ['settings.manage', 'users.manage', 'owners.manage', 'credits.view'];

/** Lo único que puede una caja real desde el POS (M10): consultar el comercio y las ventas de su caja. */
export const REGISTER_ALLOWED: readonly Capability[] = ['tenant.view', 'sales.view'];

/** `can`, con lo que resta el tipo de acceso. */
export function canAs(role: TenantRole, capability: Capability, access: Access): boolean {
  if (!can(role, capability)) return false;
  if (access === 'demo') return !ANONYMOUS_DENIED.includes(capability);
  if (access === 'register') return REGISTER_ALLOWED.includes(capability);
  return true;
}

export function assignableRoles(actor: TenantRole): TenantRole[] {
  if (actor === 'owner') return ['owner', 'admin', 'member'];
  if (actor === 'admin') return ['admin', 'member'];
  return [];
}

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}
