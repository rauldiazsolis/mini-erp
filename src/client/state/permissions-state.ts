import { computed, effect } from '@preact/signals';
import {
  can,
  effectiveTenantRole,
  type Capability,
  type MembershipRole,
  type TenantRole,
} from '../../shared/permissions.ts';
import { activeTenantSignal, isRootOrSupportSignal, profileLoadedSignal } from './auth-state.ts';
import { navigate, routeSignal } from './route-state.ts';
import { adminUrl, type NavSection } from '../routing/admin-routes.ts';
import { activeSettingsTabSignal, type SettingsTab } from './settings-state.ts';

/** El rol con el que se opera el comercio activo (#19); impersonando, owner hasta M7. */
export const activeRoleSignal = computed<TenantRole | null>(() => {
  const tenant = activeTenantSignal.value;
  return tenant === null ? null : effectiveTenantRole(tenant.role);
});

/** Si el rol activo tiene la capacidad. Lee `activeRoleSignal`: un componente que lo usa se re-renderiza. */
export function canDo(capability: Capability): boolean {
  const role = activeRoleSignal.value;
  return role !== null && can(role, capability);
}

export const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Empleado',
  root_impersonator: 'Soporte',
  support_impersonator: 'Soporte',
};

const VIEW_CAPABILITY: Record<Exclude<NavSection, 'platform'>, Capability> = {
  dashboard: 'tenant.use',
  sales: 'tenant.use',
  catalog: 'tenant.use',
  stock: 'tenant.use',
  customers: 'tenant.use',
  bulk: 'bulk',
  users: 'users.manage',
  settings: 'tenant.use',
  credits: 'credits.view',
};

const TAB_CAPABILITY: Record<SettingsTab, Capability> = {
  pos: 'settings.manage',
  branches: 'settings.manage',
  connection: 'settings.manage',
  appearance: 'tenant.use',
  account: 'tenant.use',
};

/** La vista Plataforma (#21) es de root y soporte, no del comercio. */
export function isViewAllowed(view: NavSection): boolean {
  return view === 'platform' ? isRootOrSupportSignal.value : canDo(VIEW_CAPABILITY[view]);
}

export function isSettingsTabAllowed(tab: SettingsTab): boolean {
  return canDo(TAB_CAPABILITY[tab]);
}

/** Una sección no permitida para el rol vuelve al dashboard; Plataforma sin ser root o soporte, a /admin (#59). */
export function registerPermissionEffects(): () => void {
  return effect(() => {
    const route = routeSignal.value;
    if (route.kind === 'plataforma') {
      if (profileLoadedSignal.value && !isRootOrSupportSignal.value) navigate('/admin', { replace: true });
      return;
    }
    if (route.kind !== 'admin' || route.tenantSlug === null || activeRoleSignal.value === null) return;
    if (!isViewAllowed(route.section)) navigate(adminUrl(route.tenantSlug, 'dashboard'), { replace: true });
  });
}

// Si al cambiar de comercio la solapa ya no está permitida, se vuelve a una que sí
if (typeof window !== 'undefined') {
  registerPermissionEffects();
  effect(() => {
    if (activeRoleSignal.value !== null && !isSettingsTabAllowed(activeSettingsTabSignal.value)) {
      activeSettingsTabSignal.value = 'appearance';
    }
  });
}
