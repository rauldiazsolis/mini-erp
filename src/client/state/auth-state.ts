import { signal, computed } from '@preact/signals';
import { apiFetch, setOnUnauthorized, type ApiError } from '../api/client.ts';

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
  role: 'owner' | 'member' | 'impersonated';
};

const TOKEN_KEY = 'mini_erp_token';
const TENANT_KEY = 'mini_erp_tenant_id';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
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
export const activeTenantIdSignal = signal<string | null>(getStoredTenantId());
export const impersonatedTenantIdSignal = signal<string | null>(null);
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

export const effectiveTenantIdSignal = computed<string | null>(() => {
  return impersonatedTenantIdSignal.value ?? activeTenantIdSignal.value;
});

export const isImpersonatingSignal = computed<boolean>(() => {
  return impersonatedTenantIdSignal.value !== null;
});

export const activeTenantSignal = computed<TenantMembershipItem | null>(() => {
  const effectiveId = effectiveTenantIdSignal.value;
  if (!effectiveId) return null;
  return userTenantsSignal.value.find((t) => t.tenantId === effectiveId) ?? null;
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

    // Si no hay tenant activo o el activo ya no está disponible, seleccionar el primero
    const currentActive = activeTenantIdSignal.value;
    const exists = data.tenants.some((t) => t.tenantId === currentActive);
    if (!exists && data.tenants.length > 0) {
      const firstTenant = data.tenants[0];
      if (firstTenant !== undefined) {
        setActiveTenant(firstTenant.tenantId);
      }
    }

    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al verificar sesión';
    authErrorSignal.value = msg;
    logout();
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

export async function register(data: { email: string; password: string; name: string }): Promise<boolean> {
  try {
    authLoadingSignal.value = true;
    authErrorSignal.value = null;

    const res = await apiFetch<{
      user: AuthUser;
      token: string;
    }>('auth/register', {
      method: 'POST',
      body: data,
    });

    tokenSignal.value = res.token;
    setStoredToken(res.token);
    currentUserSignal.value = res.user;

    await fetchProfile();
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Error al registrar usuario';
    authErrorSignal.value = msg;
    return false;
  } finally {
    authLoadingSignal.value = false;
  }
}

export function logout(): void {
  tokenSignal.value = null;
  setStoredToken(null);
  currentUserSignal.value = null;
  userTenantsSignal.value = [];
  activeTenantIdSignal.value = null;
  setStoredTenantId(null);
  impersonatedTenantIdSignal.value = null;
  authErrorSignal.value = null;
}

export function setActiveTenant(tenantId: string): void {
  activeTenantIdSignal.value = tenantId;
  setStoredTenantId(tenantId);
  if (impersonatedTenantIdSignal.value !== null) {
    impersonatedTenantIdSignal.value = null;
  }
}

export function impersonateTenant(tenantId: string): void {
  if (!isRootOrSupportSignal.value) {
    throw new Error('Solo usuarios root o support pueden impersonar comercios');
  }
  impersonatedTenantIdSignal.value = tenantId;
}

export function stopImpersonation(): void {
  impersonatedTenantIdSignal.value = null;
}
