import { navigate } from '../../src/client/state/route-state.ts';
import { profileLoadedSignal, userTenantsSignal } from '../../src/client/state/auth-state.ts';
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
