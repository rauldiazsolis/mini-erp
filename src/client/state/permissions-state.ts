import { computed, effect } from '@preact/signals';
import {
  can,
  effectiveTenantRole,
  type Capability,
  type MembershipRole,
  type TenantRole,
} from '../../shared/permissions.ts';
import { activeTenantSignal, isRootOrSupportSignal } from './auth-state.ts';
import { activeViewSignal, type ActiveNavView } from './navigation-state.ts';
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

const VIEW_CAPABILITY: Record<Exclude<ActiveNavView, 'platform'>, Capability> = {
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
export function isViewAllowed(view: ActiveNavView): boolean {
  return view === 'platform' ? isRootOrSupportSignal.value : canDo(VIEW_CAPABILITY[view]);
}

export function isSettingsTabAllowed(tab: SettingsTab): boolean {
  return canDo(TAB_CAPABILITY[tab]);
}

// Si al cambiar de comercio la vista o la solapa ya no está permitida, se vuelve a una que sí
if (typeof window !== 'undefined') {
  effect(() => {
    if (activeRoleSignal.value !== null && !isViewAllowed(activeViewSignal.value)) {
      activeViewSignal.value = 'dashboard';
    }
  });
  effect(() => {
    if (activeRoleSignal.value !== null && !isSettingsTabAllowed(activeSettingsTabSignal.value)) {
      activeSettingsTabSignal.value = 'appearance';
    }
  });
}
