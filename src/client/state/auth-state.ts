import { signal, computed, effect } from '@preact/signals';
import { ApiError, apiFetch, setOnUnauthorized } from '../api/client.ts';
import { queryClient } from '../api/query-client.ts';
import { adminUrl } from '../routing/admin-routes.ts';
import { currentTenantSlugSignal, navigate, routeSignal, switchTenantUrl } from './route-state.ts';
import { z } from '../../shared/zod.ts';
import type { Access, TenantRole } from '../../shared/permissions.ts';
import type { PortalRedeemResponse } from '../../shared/portal-types.ts';

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
  role: TenantRole;
};

/** Quién impersona (#23). */
export type Impersonator = { id: string; name: string; globalRole: 'root' | 'support' };
/** La impersonación de la pestaña: como quién, quién y el comercio por el que entró. */
export type ImpersonationState = { user: AuthUser; impersonator: Impersonator; tenantSlug: string };
/** Lo que responde `POST /api/impersonations`. */
export type ImpersonationStart = ImpersonationState & { token: string; path: string };

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const TOKEN_KEY = 'mini_erp_token';
const TENANT_KEY = 'mini_erp_tenant_id';
/** La impersonación de la pestaña (#23): solo en su sessionStorage, que `noopener` no hereda. */
const IMPERSONATION_KEY = 'mini_erp_impersonation';
/** La sesión anónima de una demo (#24): también solo en el sessionStorage de su pestaña. */
const ANONYMOUS_KEY = 'mini_erp_demo';

const storedImpersonationSchema = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string(), email: z.string(), name: z.string(), globalRole: z.enum(['root', 'support', 'user']) }),
  impersonator: z.object({ id: z.string(), name: z.string(), globalRole: z.enum(['root', 'support']) }),
  tenantSlug: z.string(),
});

const storedAnonymousSchema = z.object({
  token: z.string().min(1),
  tenant: z.object({ id: z.string(), slug: z.string(), name: z.string() }),
  branch: z.string(),
  pointOfSale: z.string(),
  template: z.string(),
});

/** El acceso anónimo de la pestaña (#24): el comercio demo, la caja del visitante y el rubro. */
export type AnonymousState = { tenant: { id: string; slug: string; name: string }; pointOfSale: string; template: string };

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window[kind];
  } catch {
    return null; // Navegador sin almacenamiento
  }
}

/**
 * Dónde vive la sesión (#23): la propia en el localStorage (compartido por las pestañas) y la
 * impersonación en el sessionStorage de su pestaña. Solo este módulo toca el sessionStorage.
 */
let storages: { local: StorageLike | null; session: StorageLike | null } = {
  local: browserStorage('localStorage'),
  session: browserStorage('sessionStorage'),
};

/** Los tests corren sin navegador: le pasan almacenamientos en memoria. */
export function setStoragesForTests(next: { local: StorageLike | null; session: StorageLike | null }): void {
  storages = next;
}

function readImpersonation(): (ImpersonationState & { token: string }) | null {
  const raw = storages.session?.getItem(IMPERSONATION_KEY) ?? null;
  if (raw === null) return null;
  try {
    const parsed = storedImpersonationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function readAnonymous(): (AnonymousState & { token: string }) | null {
  const raw = storages.session?.getItem(ANONYMOUS_KEY) ?? null;
  if (raw === null) return null;
  try {
    const parsed = storedAnonymousSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** El token de la sesión propia (la de soporte, en una pestaña que impersona). */
export function ownToken(): string | null {
  return storages.local?.getItem(TOKEN_KEY) ?? null;
}

// Signals de estado de autenticación
export const tokenSignal = signal<string | null>(null);
export const currentUserSignal = signal<AuthUser | null>(null);
export const userTenantsSignal = signal<TenantMembershipItem[]>([]);
export const authLoadingSignal = signal<boolean>(false);
export const authErrorSignal = signal<string | null>(null);

/** La impersonación de esta pestaña (#23), o `null` si usa la sesión propia. */
export const impersonationSignal = signal<ImpersonationState | null>(null);
export const isImpersonatingSignal = computed<boolean>(() => impersonationSignal.value !== null);
/** La impersonación de la pestaña terminó (venció, salió o cerró soporte): "La sesión como Juan terminó". */
export const impersonationEndedSignal = signal<{ userName: string } | null>(null);

// Señales computadas
export const isAuthenticatedSignal = computed<boolean>(() => {
  return tokenSignal.value !== null && currentUserSignal.value !== null;
});

export const isRootOrSupportSignal = computed<boolean>(() => {
  const role = currentUserSignal.value?.globalRole;
  return role === 'root' || role === 'support';
});

/** El acceso anónimo de la demo de esta pestaña (#24), o `null`. */
export const anonymousSignal = signal<AnonymousState | null>(null);
export const isAnonymousSignal = computed<boolean>(() => anonymousSignal.value !== null);
/** El tipo de acceso de la pestaña (M10): lo usa `canDo`. */
export const accessSignal = computed<Access>(() => (anonymousSignal.value === null ? 'user' : 'demo'));
/** La demo de la pestaña terminó (su caja se revocó): "Esta demo terminó". */
export const demoEndedSignal = signal<{ template: string } | null>(null);

/** El "usuario" de un acceso anónimo: no es una cuenta, solo lo que muestra la cabecera. */
const VISITOR: AuthUser = { id: 'demo', email: '', name: 'Visitante', globalRole: 'user' };

/** Si ya llegó `auth/me`: antes, un slug de la URL no se puede juzgar (#59). */
export const profileLoadedSignal = signal<boolean>(false);
/** El último comercio usado (#59): solo decide adónde va `/admin` pelado. */
export const lastTenantIdSignal = signal<string | null>(null);

/** Deja la pestaña con la sesión anónima: el "Visitante" y el comercio demo como admin, sin pedir `auth/me`. */
function applyAnonymous(state: AnonymousState, token: string): void {
  anonymousSignal.value = state;
  impersonationSignal.value = null;
  tokenSignal.value = token;
  currentUserSignal.value = VISITOR;
  userTenantsSignal.value = [{ tenantId: state.tenant.id, slug: state.tenant.slug, name: state.tenant.name, status: 'active', role: 'admin' }];
  profileLoadedSignal.value = true;
  lastTenantIdSignal.value = null;
}

/** Lee la sesión de la pestaña: primero la anónima de una demo, después su impersonación, después la propia. */
export function loadSessionFromStorage(): void {
  const anon = readAnonymous();
  if (anon !== null) {
    applyAnonymous({ tenant: anon.tenant, pointOfSale: anon.pointOfSale, template: anon.template }, anon.token);
    return;
  }
  anonymousSignal.value = null;
  const imp = readImpersonation();
  if (imp !== null) {
    tokenSignal.value = imp.token;
    impersonationSignal.value = { user: imp.user, impersonator: imp.impersonator, tenantSlug: imp.tenantSlug };
    lastTenantIdSignal.value = null;
    return;
  }
  impersonationSignal.value = null;
  tokenSignal.value = ownToken();
  lastTenantIdSignal.value = storages.local?.getItem(TENANT_KEY) ?? null;
}

loadSessionFromStorage();

/** Una pestaña que impersona nunca escribe el localStorage (#23): es de la sesión de soporte. */
function writeLocal(key: string, value: string | null): void {
  if (impersonationSignal.peek() !== null || anonymousSignal.peek() !== null) return;
  if (value === null) storages.local?.removeItem(key);
  else storages.local?.setItem(key, value);
}

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

/**
 * Adónde llevan `/admin` y el menú cuando la URL no tiene comercio: el de la URL, el de entrada de la
 * impersonación, el último o el primero.
 */
export const homeTenantSlugSignal = computed<string | null>(() => {
  const current = activeTenantSignal.value;
  if (current !== null) return current.slug;
  const tenants = userTenantsSignal.value;
  const imp = impersonationSignal.value;
  const entry = imp === null ? undefined : tenants.find((t) => t.slug === imp.tenantSlug);
  return (entry ?? tenants.find((t) => t.tenantId === lastTenantIdSignal.value) ?? tenants[0])?.slug ?? null;
});

export function rememberTenant(tenantId: string | null): void {
  lastTenantIdSignal.value = tenantId;
  writeLocal(TENANT_KEY, tenantId);
}

// Un 401 con sesión (#23): impersonando, solo termina la pestaña y se avisa
setOnUnauthorized(() => {
  // La sesión anónima de una demo (#24): su caja se revocó
  const anon = anonymousSignal.peek();
  if (anon !== null) demoEndedSignal.value = { template: anon.template };
  const imp = impersonationSignal.peek();
  if (imp !== null) impersonationEndedSignal.value = { userName: imp.user.name };
  logout();
});

export async function fetchProfile(): Promise<boolean> {
  // La sesión anónima no es una cuenta: ya tiene todo lo que hace falta
  if (anonymousSignal.peek() !== null) return true;
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

    // La sesión cambió mientras esperaba (el canje de una demo, #24, o un login): esta respuesta ya no es de la pestaña
    if (tokenSignal.peek() !== token) return false;

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
    dropAnonymous();
    impersonationEndedSignal.value = null;
    tokenSignal.value = res.token;
    writeLocal(TOKEN_KEY, res.token);
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

/** Suelta el acceso anónimo de la pestaña (#24): una cuenta de verdad la reemplaza. */
function dropAnonymous(): void {
  if (anonymousSignal.peek() === null) return;
  storages.session?.removeItem(ANONYMOUS_KEY);
  anonymousSignal.value = null;
}

/** Adopta una sesión que dio el servidor (alta, invitación, restablecimiento, #19). */
export async function adoptSession(token: string): Promise<boolean> {
  queryClient.clear();
  dropAnonymous();
  impersonationEndedSignal.value = null;
  tokenSignal.value = token;
  writeLocal(TOKEN_KEY, token);
  return fetchProfile();
}

/** Suelta la impersonación de la pestaña: borra su sessionStorage, nunca el localStorage. */
function dropImpersonation(): void {
  storages.session?.removeItem(IMPERSONATION_KEY);
  impersonationSignal.value = null;
}

export function logout(): void {
  queryClient.clear();
  if (anonymousSignal.peek() !== null) {
    dropAnonymous();
  } else if (impersonationSignal.peek() !== null) {
    dropImpersonation();
  } else {
    writeLocal(TOKEN_KEY, null);
    writeLocal(TENANT_KEY, null);
  }
  tokenSignal.value = null;
  currentUserSignal.value = null;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  lastTenantIdSignal.value = null;
  authErrorSignal.value = null;
}

/**
 * "Cerrar sesión" (#59): además suelta el comercio de la URL, así el próximo login va al suyo y no al
 * del usuario anterior. También la cierra en el servidor, así mueren sus impersonaciones (#23). Una
 * sesión vencida (401) usa `logout` y conserva la pantalla.
 */
export function signOut(): void {
  const token = tokenSignal.peek();
  if (token !== null) void apiFetch('auth/logout', { method: 'POST', token }).catch(() => undefined);
  logout();
  navigate('/admin');
}

/** La pestaña pasa a ser la impersonación que dio el servidor y va a su pantalla (#23). */
export async function adoptImpersonation(start: ImpersonationStart): Promise<boolean> {
  queryClient.clear();
  storages.session?.setItem(IMPERSONATION_KEY, JSON.stringify(start));
  impersonationSignal.value = { user: start.user, impersonator: start.impersonator, tenantSlug: start.tenantSlug };
  impersonationEndedSignal.value = null;
  tokenSignal.value = start.token;
  currentUserSignal.value = start.user;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  lastTenantIdSignal.value = null;
  navigate(start.path, { replace: true });
  return fetchProfile();
}

/** La pestaña pasa a ser el acceso anónimo de la demo que dio el canje del portal (#24). */
export function adoptAnonymous(start: PortalRedeemResponse): void {
  queryClient.clear();
  storages.session?.setItem(ANONYMOUS_KEY, JSON.stringify(start));
  demoEndedSignal.value = null;
  impersonationEndedSignal.value = null;
  // La caja real (M10) llega en la Tarea 5 del plan; mientras, el cliente sigue tratando todo como demo
  applyAnonymous({ tenant: start.tenant, pointOfSale: start.pointOfSale, template: start.access === 'demo' ? start.template : '' }, start.token);
}

/** Vuelve a la sesión propia de la pestaña (después de "Salir" o de que terminó la impersonación). */
export async function resumeOwnSession(): Promise<boolean> {
  queryClient.clear();
  dropImpersonation();
  impersonationEndedSignal.value = null;
  loadSessionFromStorage();
  currentUserSignal.value = null;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  navigate('/plataforma');
  return fetchProfile();
}

function findTenant(tenantId: string): TenantMembershipItem | undefined {
  return userTenantsSignal.peek().find((t) => t.tenantId === tenantId);
}

/** Cambia de comercio desde el selector, en la misma pantalla; devuelve el nombre para el aviso (#45). */
export function selectTenant(tenantId: string): string {
  const tenant = findTenant(tenantId);
  if (tenant !== undefined) navigate(switchTenantUrl(routeSignal.peek(), tenant.slug));
  return tenant?.name ?? tenantId;
}

/**
 * Recuerda el comercio de la URL y lleva `/admin` pelado al último usado (#59); root y soporte, sin
 * comercios propios, a la plataforma (#16). Devuelve la función que corta los efectos.
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
    else if (isRootOrSupportSignal.value && !isImpersonatingSignal.value) navigate('/plataforma', { replace: true });
  });
  return () => {
    stopRemember();
    stopHome();
  };
}

if (typeof window !== 'undefined') {
  registerTenantRouteEffects();
}
