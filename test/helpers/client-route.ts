import { navigate } from '../../src/client/state/route-state.ts';
import { profileLoadedSignal, tokenSignal, userTenantsSignal } from '../../src/client/state/auth-state.ts';
import { queryClient } from '../../src/client/api/query-client.ts';
import type { MembershipRole } from '../../src/shared/permissions.ts';

/**
 * Deja la app en una pantalla de un comercio (#59): `path` es lo que va después del slug
 * (`'catalogo'`, `'ventas/cobranzas?rango=semana'`). Si el comercio no está en "tus comercios", lo agrega.
 */
export function atTenant(idOrSlug: string, path = 'dashboard', role: MembershipRole = 'owner'): void {
  const found = userTenantsSignal.value.find((t) => t.slug === idOrSlug || t.tenantId === idOrSlug);
  if (found === undefined) {
    userTenantsSignal.value = [...userTenantsSignal.value, { tenantId: idOrSlug, slug: idOrSlug, name: idOrSlug, role, status: 'active' }];
  }
  profileLoadedSignal.value = true;
  navigate(`/admin/${found?.slug ?? idOrSlug}/${path}`);
}

/**
 * Caché vacía y una sesión con ese token, como después de un login (#59). Solo `queryClient.clear()`
 * no alcanza: las consultas ya creadas siguen mirando la entrada borrada hasta que algo de su clave
 * cambie; en la app, `login` y `logout` borran la caché y cambian el token. Sale del admin antes, para
 * que ninguna consulta de la pantalla del test anterior pida con el `fetch` real.
 */
export function freshSession(token = 'tok'): void {
  navigate('/');
  tokenSignal.value = null;
  queryClient.clear();
  tokenSignal.value = token;
}
