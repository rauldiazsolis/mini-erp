import { computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createSignalQuery, type QuerySource } from '../api/query-client.ts';
import { currentUserSignal, tokenSignal } from './auth-state.ts';
import { routeSignal } from './route-state.ts';
import { platformKey } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import { showToast } from './toast-state.ts';
import { buildLinkUrl, linkOrigin, linkReadySignal } from './users-state.ts';
import type {
  PlatformAuditItem,
  PlatformMemberItem,
  PlatformTenantDetail,
  PlatformTenantItem,
  PlatformUserItem,
  StaffInvitationItem,
  StaffMemberItem,
} from '../../shared/platform-types.ts';

/**
 * El panel de plataforma (#23), para root y soporte: comercios y su detalle, usuarios, equipo de
 * soporte y registro. Los filtros y el comercio del detalle salen de la URL (`/plataforma?q=…`,
 * `/plataforma/comercios/<slug>`, `/plataforma/registro?comercio=<slug>`).
 */

function fail(err: unknown, title: string): false {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
  return false;
}

/** Si la solapa activa de `/plataforma` (sin detalle) es esa. Reactiva. */
function platformTabIs(tab: 'users' | 'staff' | 'audit'): boolean {
  const route = routeSignal.value;
  return route.kind === 'plataforma' && route.tab === tab && route.tenantSlug === null;
}

/** El texto de búsqueda de una solapa de la plataforma, si es la activa; si no, `null`. */
function searchOf(tab: 'tenants' | 'users'): string | null {
  const route = routeSignal.value;
  if (route.kind !== 'plataforma' || route.tab !== tab || route.tenantSlug !== null) return null;
  return route.params['q'] ?? '';
}

const tenantsQuery = createSignalQuery<PlatformTenantItem[]>({
  source: (): QuerySource<PlatformTenantItem[]> | null => {
    const t = tokenSignal.value;
    const q = searchOf('tenants') ?? '';
    if (t === null) return null;
    const query = q === '' ? '' : `?q=${encodeURIComponent(q)}`;
    return { key: platformKey('tenants', q), fn: () => apiFetch<PlatformTenantItem[]>(`/api/platform/tenants${query}`, { token: t }) };
  },
  // También en Registro: el selector de comercio usa esta lista
  enabled: () => searchOf('tenants') !== null || platformTabIs('audit'),
  keepPrevious: (prev, next) => prev[1] === next[1],
  onError: (err) => {
    fail(err, 'No se pudieron cargar los comercios');
  },
});

/** El slug del comercio del detalle, en `/plataforma/comercios/<slug>`. */
const detailSlugSignal = computed<string | null>(() => {
  const route = routeSignal.value;
  return route.kind === 'plataforma' ? route.tenantSlug : null;
});

const detailQuery = createSignalQuery<PlatformTenantDetail>({
  source: (): QuerySource<PlatformTenantDetail> | null => {
    const t = tokenSignal.value;
    const slug = detailSlugSignal.value;
    if (t === null || slug === null) return null;
    return {
      key: platformKey('tenant', slug),
      fn: () => apiFetch<PlatformTenantDetail>(`/api/platform/tenants/by-slug/${encodeURIComponent(slug)}`, { token: t }),
    };
  },
  onError: (err) => {
    fail(err, 'No se pudo cargar el comercio');
  },
});

export const platformTenantsSignal = computed<PlatformTenantItem[]>(() => tenantsQuery.data.value ?? []);
export const platformTenantsLoadingSignal = tenantsQuery.isLoading;
export const platformTenantDetailSignal = computed<PlatformTenantDetail | null>(() => detailQuery.data.value ?? null);
export const platformTenantDetailLoadingSignal = detailQuery.isLoading;
export const platformTenantDetailErrorSignal = detailQuery.error;

/** Los owners activos del comercio: los únicos que pueden ser titulares. */
export function activeOwners(detail: PlatformTenantDetail | null): PlatformMemberItem[] {
  return (detail?.members ?? []).filter((m) => m.role === 'owner' && m.status === 'active');
}

async function post(path: string, body: Record<string, unknown>, done: string, failTitle: string): Promise<boolean> {
  const t = tokenSignal.value;
  if (t === null) return false;
  try {
    await apiFetch(path, { method: 'POST', token: t, body });
    showToast({ type: 'success', title: 'Listo', message: done });
    await invalidateAfter('platform-changed');
    return true;
  } catch (err: unknown) {
    return fail(err, failTitle);
  }
}

export function suspendTenant(tenantId: string, reason: string): Promise<boolean> {
  return post(`/api/platform/tenants/${encodeURIComponent(tenantId)}/suspend`, { reason }, 'Comercio suspendido', 'No se pudo suspender');
}

export function reactivateTenant(tenantId: string): Promise<boolean> {
  return post(`/api/platform/tenants/${encodeURIComponent(tenantId)}/reactivate`, {}, 'Comercio reactivado', 'No se pudo reactivar');
}

// --- Usuarios ---

const usersQuery = createSignalQuery<PlatformUserItem[]>({
  source: (): QuerySource<PlatformUserItem[]> | null => {
    const t = tokenSignal.value;
    const q = searchOf('users') ?? '';
    if (t === null) return null;
    const query = q === '' ? '' : `?q=${encodeURIComponent(q)}`;
    return { key: platformKey('users', q), fn: () => apiFetch<PlatformUserItem[]>(`/api/platform/users${query}`, { token: t }) };
  },
  enabled: () => searchOf('users') !== null,
  keepPrevious: (prev, next) => prev[1] === next[1],
  onError: (err) => {
    fail(err, 'No se pudieron cargar los usuarios');
  },
});

export const platformUsersSignal = computed<PlatformUserItem[]>(() => usersQuery.data.value ?? []);
export const platformUsersLoadingSignal = usersQuery.isLoading;

export function setUserStatus(userId: string, status: 'active' | 'disabled'): Promise<boolean> {
  const path = status === 'disabled' ? 'disable' : 'enable';
  return post(
    `/api/platform/users/${encodeURIComponent(userId)}/${path}`,
    {},
    status === 'disabled' ? 'Cuenta desactivada: sus sesiones se cerraron' : 'Cuenta reactivada',
    'No se pudo cambiar la cuenta',
  );
}

/** Genera el link de restablecimiento y lo muestra una sola vez, como en Usuarios del comercio. */
export async function createPlatformResetLink(user: { id: string; email: string }): Promise<void> {
  const t = tokenSignal.value;
  if (t === null) return;
  try {
    const res = await apiFetch<{ token: string; expiresAt: string }>(`/api/platform/users/${encodeURIComponent(user.id)}/password-reset`, {
      method: 'POST',
      token: t,
      body: {},
    });
    linkReadySignal.value = { kind: 'reset', url: buildLinkUrl('reset', res.token, linkOrigin()), email: user.email, expiresAt: res.expiresAt };
    void invalidateAfter('platform-changed');
  } catch (err: unknown) {
    fail(err, 'No se pudo generar el link');
  }
}

// --- Equipo de soporte (solo root) ---

export type StaffView = { members: StaffMemberItem[]; invitations: StaffInvitationItem[] };

const staffQuery = createSignalQuery<StaffView>({
  source: (): QuerySource<StaffView> | null => {
    const t = tokenSignal.value;
    if (t === null) return null;
    return { key: platformKey('staff'), fn: () => apiFetch<StaffView>('/api/platform/staff', { token: t }) };
  },
  enabled: () => platformTabIs('staff') && currentUserSignal.value?.globalRole === 'root',
  onError: (err) => {
    fail(err, 'No se pudo cargar el equipo');
  },
});

export const staffSignal = computed<StaffView | null>(() => staffQuery.data.value ?? null);

export async function inviteStaff(email: string): Promise<boolean> {
  const t = tokenSignal.value;
  if (t === null) return false;
  try {
    const res = await apiFetch<{ id: string; token: string; expiresAt: string }>('/api/platform/staff/invitations', {
      method: 'POST',
      token: t,
      body: { email },
    });
    linkReadySignal.value = {
      kind: 'staff-invitation',
      url: buildLinkUrl('staff-invitation', res.token, linkOrigin()),
      email: email.trim().toLowerCase(),
      expiresAt: res.expiresAt,
    };
    void invalidateAfter('platform-changed');
    return true;
  } catch (err: unknown) {
    return fail(err, 'No se pudo invitar');
  }
}

export async function revokeStaffInvitation(invitationId: string): Promise<boolean> {
  const t = tokenSignal.value;
  if (t === null) return false;
  try {
    await apiFetch(`/api/platform/staff/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE', token: t });
    showToast({ type: 'success', title: 'Listo', message: 'Invitación revocada' });
    await invalidateAfter('platform-changed');
    return true;
  } catch (err: unknown) {
    return fail(err, 'No se pudo revocar');
  }
}

// --- Registro ---

/** El slug del comercio del filtro de Registro, o '' para todos. */
function auditSlug(): string {
  const route = routeSignal.value;
  return route.kind === 'plataforma' ? (route.params['comercio'] ?? '') : '';
}

const auditQuery = createSignalQuery<PlatformAuditItem[]>({
  source: (): QuerySource<PlatformAuditItem[]> | null => {
    const t = tokenSignal.value;
    const slug = auditSlug();
    if (t === null) return null;
    const query = slug === '' ? '' : `?tenantSlug=${encodeURIComponent(slug)}`;
    return { key: platformKey('audit', slug), fn: () => apiFetch<PlatformAuditItem[]>(`/api/platform/audit${query}`, { token: t }) };
  },
  enabled: () => platformTabIs('audit'),
  keepPrevious: (prev, next) => prev[1] === next[1],
  onError: (err) => {
    fail(err, 'No se pudo cargar el registro');
  },
});

export const platformAuditSignal = computed<PlatformAuditItem[]>(() => auditQuery.data.value ?? []);
export const platformAuditLoadingSignal = auditQuery.isLoading;
