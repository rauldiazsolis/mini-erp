import { computed, effect } from '@preact/signals';
import { canAs, type Capability, type TenantRole } from '../../shared/permissions.ts';
import { accessSignal, activeTenantSignal, anonymousSignal, currentUserSignal, isRootOrSupportSignal, profileLoadedSignal } from './auth-state.ts';
import { navigate, routeSignal } from './route-state.ts';
import { adminUrl, type NavSection, type PlatformSectionId } from '../routing/admin-routes.ts';
import { activeSettingsTabSignal, type SettingsTab } from './settings-state.ts';

/** El rol con el que se opera el comercio activo (#19): el de la membresía (impersonando, la del usuario). */
export const activeRoleSignal = computed<TenantRole | null>(() => {
  const tenant = activeTenantSignal.value;
  return tenant === null ? null : tenant.role;
});

/** Si el rol activo tiene la capacidad. Lee `activeRoleSignal`: un componente que lo usa se re-renderiza. */
export function canDo(capability: Capability): boolean {
  const role = activeRoleSignal.value;
  // El acceso anónimo (#24, M10): la demo y la caja restan capacidades
  return role !== null && canAs(role, capability, accessSignal.value);
}

export const ROLE_LABEL: Record<TenantRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Empleado',
};

const VIEW_CAPABILITY: Record<Exclude<NavSection, 'platform'>, Capability> = {
  dashboard: 'tenant.use',
  sales: 'sales.view',
  catalog: 'tenant.view',
  stock: 'tenant.view',
  customers: 'tenant.view',
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

/** Las secciones de la plataforma (#23, #81): todas para root; Soporte y Configuración, solo root. */
const ROOT_ONLY_PLATFORM_SECTIONS: ReadonlySet<PlatformSectionId> = new Set<PlatformSectionId>(['staff', 'settings']);

export function isPlatformSectionAllowed(section: PlatformSectionId): boolean {
  const role = currentUserSignal.value?.globalRole;
  if (role === 'root') return true;
  return role === 'support' && !ROOT_ONLY_PLATFORM_SECTIONS.has(section);
}

export function isSettingsTabAllowed(tab: SettingsTab): boolean {
  // Cuenta es de una cuenta: el acceso anónimo de una demo (#24) no tiene contraseña
  if (tab === 'account' && anonymousSignal.value !== null) return false;
  return canDo(TAB_CAPABILITY[tab]);
}

/**
 * Una sección no permitida para el rol vuelve al dashboard, una solapa de Configuración no permitida a
 * Apariencia y Plataforma sin ser root o soporte, a /admin (#59). Una sección de la plataforma que es solo
 * de root, para soporte, vuelve a Comercios (#81).
 */
export function registerPermissionEffects(): () => void {
  return effect(() => {
    const route = routeSignal.value;
    if (route.kind === 'plataforma') {
      if (!profileLoadedSignal.value) return;
      if (!isRootOrSupportSignal.value) navigate('/admin', { replace: true });
      else if (!isPlatformSectionAllowed(route.section)) navigate('/plataforma', { replace: true });
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
