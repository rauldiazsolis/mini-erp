import { computed, effect } from '@preact/signals';
import { canAs, type Capability, type TenantRole } from '../../shared/permissions.ts';
import { activeTenantSignal, anonymousSignal, isRootOrSupportSignal, profileLoadedSignal } from './auth-state.ts';
import { navigate, routeSignal } from './route-state.ts';
import { adminUrl, type NavSection } from '../routing/admin-routes.ts';
import { activeSettingsTabSignal, type SettingsTab } from './settings-state.ts';

/** El rol con el que se opera el comercio activo (#19): el de la membresía (impersonando, la del usuario). */
export const activeRoleSignal = computed<TenantRole | null>(() => {
  const tenant = activeTenantSignal.value;
  return tenant === null ? null : tenant.role;
});

/** Si el rol activo tiene la capacidad. Lee `activeRoleSignal`: un componente que lo usa se re-renderiza. */
export function canDo(capability: Capability): boolean {
  const role = activeRoleSignal.value;
  // El acceso anónimo de una demo (#24): admin sin usuarios, owners, créditos ni configuración
  return role !== null && canAs(role, capability, anonymousSignal.value !== null);
}

export const ROLE_LABEL: Record<TenantRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Empleado',
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
  // Cuenta es de una cuenta: el acceso anónimo de una demo (#24) no tiene contraseña
  if (tab === 'account' && anonymousSignal.value !== null) return false;
  return canDo(TAB_CAPABILITY[tab]);
}

/**
 * Una sección no permitida para el rol vuelve al dashboard, una solapa de Configuración no permitida a
 * Apariencia y Plataforma sin ser root o soporte, a /admin (#59).
 */
export function registerPermissionEffects(): () => void {
  return effect(() => {
    const route = routeSignal.value;
    if (route.kind === 'plataforma') {
      if (profileLoadedSignal.value && !isRootOrSupportSignal.value) navigate('/admin', { replace: true });
      return;
    }
    if (route.kind !== 'admin' || route.tenantSlug === null || activeRoleSignal.value === null) return;
    if (!isViewAllowed(route.section)) {
      navigate(adminUrl(route.tenantSlug, 'dashboard'), { replace: true });
    } else if (route.section === 'settings' && !isSettingsTabAllowed(activeSettingsTabSignal.value)) {
      navigate(adminUrl(route.tenantSlug, 'settings', { tab: 'appearance' }), { replace: true });
    }
  });
}

if (typeof window !== 'undefined') {
  registerPermissionEffects();
}
