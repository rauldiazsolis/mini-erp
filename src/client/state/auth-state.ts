import { signal, computed, effect } from '@preact/signals';
import { ApiError, apiFetch, setOnUnauthorized } from '../api/client.ts';
import { queryClient } from '../api/query-client.ts';
import { adminUrl } from '../routing/admin-routes.ts';
import { currentTenantSlugSignal, navigate, routeSignal, switchTenantUrl } from './route-state.ts';
import type { MembershipRole } from '../../shared/permissions.ts';

export type GlobalRole = 'root' | 'support' | 'user';

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
};

export type TenantMembershipItem = {
  tenantId: string;
  slug: string;
  name: string;
  status: 'active' | 'maintenance' | 'suspended';
  role: MembershipRole;
};

const TOKEN_KEY = 'mini_erp_token';
const TENANT_KEY = 'mini_erp_tenant_id';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage;
    }
  } catch {
    // Entorno no navegador
  }
  return null;
}

export function getStoredToken(): string | null {
  return getStorage()?.getItem(TOKEN_KEY) ?? null;
}

export function setStoredToken(token: string | null): void {
  const s = getStorage();
  if (token) {
    s?.setItem(TOKEN_KEY, token);
  } else {
    s?.removeItem(TOKEN_KEY);
  }
}

export function getStoredTenantId(): string | null {
  return getStorage()?.getItem(TENANT_KEY) ?? null;
}

export function setStoredTenantId(tenantId: string | null): void {
  const s = getStorage();
  if (tenantId) {
    s?.setItem(TENANT_KEY, tenantId);
  } else {
    s?.removeItem(TENANT_KEY);
  }
}

// Signals de estado de autenticación
export const tokenSignal = signal<string | null>(getStoredToken());
export const currentUserSignal = signal<AuthUser | null>(null);
export const userTenantsSignal = signal<TenantMembershipItem[]>([]);
export const authLoadingSignal = signal<boolean>(false);
export const authErrorSignal = signal<string | null>(null);

// Señales computadas
export const isAuthenticatedSignal = computed<boolean>(() => {
  return tokenSignal.value !== null && currentUserSignal.value !== null;
});

export const isRootOrSupportSignal = computed<boolean>(() => {
  const role = currentUserSignal.value?.globalRole;
  return role === 'root' || role === 'support';
});

/** Si ya llegó `auth/me`: antes, un slug de la URL no se puede juzgar (#59). */
export const profileLoadedSignal = signal<boolean>(false);
/** El último comercio usado (#59): solo decide adónde va `/admin` pelado. */
export const lastTenantIdSignal = signal<string | null>(getStoredTenantId());

/** El comercio de la URL, si es uno de "tus comercios". */
export const activeTenantSignal = computed<TenantMembershipItem | null>(() => {
  const slug = currentTenantSlugSignal.value;
  if (slug === null) return null;
  return userTenantsSignal.value.find((t) => t.slug === slug) ?? null;
});

export const effectiveTenantIdSignal = computed<string | null>(() => activeTenantSignal.value?.tenantId ?? null);

export type TenantAccess = 'none' | 'loading' | 'ok' | 'denied';
export const tenantAccessSignal = computed<TenantAccess>(() => {
  if (currentTenantSlugSignal.value === null) return 'none';
  if (!profileLoadedSignal.value) return 'loading';
  return activeTenantSignal.value === null ? 'denied' : 'ok';
});

/** Adónde llevan `/admin` y el menú cuando la URL no tiene comercio: el de la URL, el último o el primero. */
export const homeTenantSlugSignal = computed<string | null>(() => {
  const current = activeTenantSignal.value;
  if (current !== null) return current.slug;
  const tenants = userTenantsSignal.value;
  return (tenants.find((t) => t.tenantId === lastTenantIdSignal.value) ?? tenants[0])?.slug ?? null;
});

export function rememberTenant(tenantId: string | null): void {
  lastTenantIdSignal.value = tenantId;
  setStoredTenantId(tenantId);
}

/** La impersonación de hoy, en memoria, hasta que M7 la reemplace: el comercio y desde cuál se entró. */
export const impersonationSignal = signal<{ slug: string; fromSlug: string | null } | null>(null);
export const isImpersonatingSignal = computed<boolean>(() => {
  const imp = impersonationSignal.value;
  return imp !== null && imp.slug === currentTenantSlugSignal.value;
});

// Callback ante 401
setOnUnauthorized(() => {
  logout();
});

export async function fetchProfile(): Promise<boolean> {
  const token = tokenSignal.value;
  if (!token) {
    currentUserSignal.value = null;
    userTenantsSignal.value = [];
    return false;
  }

  try {
    authLoadingSignal.value = true;
    authErrorSignal.value = null;

    const data = await apiFetch<{
      user: AuthUser;
      tenants: TenantMembershipItem[];
    }>('auth/me', { token });

    currentUserSignal.value = data.user;
    userTenantsSignal.value = data.tenants;

    profileLoadedSignal.value = true;

    return true;
  } catch (err: unknown) {
    // Solo una sesión vencida la cierra (#47): con el servidor en mantenimiento o sin red, se conserva
    if (err instanceof ApiError && err.status === 401) {
      authErrorSignal.value = err.message;
      logout();
    }
    return false;
  } finally {
    authLoadingSignal.value = false;
  }
}

export async function login(credentials: { email: string; password: string }): Promise<boolean> {
  try {
    authLoadingSignal.value = true;
    authErrorSignal.value = null;

    const res = await apiFetch<{
      user: AuthUser;
      token: string;
    }>('auth/login', {
      method: 'POST',
      body: credentials,
    });

    queryClient.clear();
    tokenSignal.value = res.token;
    setStoredToken(res.token);
    currentUserSignal.value = res.user;

    await fetchProfile();
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al iniciar sesión';
    authErrorSignal.value = msg;
    return false;
  } finally {
    authLoadingSignal.value = false;
  }
}

/** Adopta una sesión que dio el servidor (alta, invitación, restablecimiento, #19). */
export async function adoptSession(token: string): Promise<boolean> {
  queryClient.clear();
  tokenSignal.value = token;
  setStoredToken(token);
  return fetchProfile();
}

export function logout(): void {
  queryClient.clear();
  tokenSignal.value = null;
  setStoredToken(null);
  currentUserSignal.value = null;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  rememberTenant(null);
  impersonationSignal.value = null;
  authErrorSignal.value = null;
}

/**
 * "Cerrar sesión" (#59): además suelta el comercio de la URL, así el próximo login va al suyo y no al
 * del usuario anterior. Una sesión vencida (401) usa `logout` y conserva la pantalla.
 */
export function signOut(): void {
  logout();
  navigate('/admin');
}

function findTenant(tenantId: string): TenantMembershipItem | undefined {
  return userTenantsSignal.peek().find((t) => t.tenantId === tenantId);
}

/** Cambia de comercio desde el selector, en la misma pantalla; devuelve el nombre para el aviso (#45). */
export function selectTenant(tenantId: string): string {
  impersonationSignal.value = null;
  const tenant = findTenant(tenantId);
  if (tenant !== undefined) navigate(switchTenantUrl(routeSignal.peek(), tenant.slug));
  return tenant?.name ?? tenantId;
}

export function impersonateTenant(tenantId: string): void {
  if (!isRootOrSupportSignal.value) {
    throw new Error('Solo usuarios root o support pueden impersonar comercios');
  }
  const tenant = findTenant(tenantId);
  if (tenant === undefined) throw new Error('Comercio desconocido');
  impersonationSignal.value = { slug: tenant.slug, fromSlug: currentTenantSlugSignal.peek() };
  navigate(switchTenantUrl(routeSignal.peek(), tenant.slug));
}

export function stopImpersonation(): void {
  const from = impersonationSignal.peek()?.fromSlug ?? null;
  impersonationSignal.value = null;
  navigate(from === null ? '/admin' : adminUrl(from, 'dashboard'));
}

/**
 * Recuerda el comercio de la URL y lleva `/admin` pelado al último usado (#59). Devuelve la función
 * que corta los efectos.
 */
export function registerTenantRouteEffects(): () => void {
  const stopRemember = effect(() => {
    const tenant = activeTenantSignal.value;
    if (tenant !== null) rememberTenant(tenant.tenantId);
  });
  const stopHome = effect(() => {
    const route = routeSignal.value;
    if (route.kind !== 'admin' || route.tenantSlug !== null || !profileLoadedSignal.value) return;
    const home = homeTenantSlugSignal.value;
    if (home !== null) navigate(adminUrl(home, 'dashboard'), { replace: true });
  });
  return () => {
    stopRemember();
    stopHome();
  };
}

if (typeof window !== 'undefined') {
  registerTenantRouteEffects();
}
