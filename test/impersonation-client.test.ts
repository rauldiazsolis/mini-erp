import { describe, it, expect, beforeEach } from 'vitest';
import { impersonationBarText } from '../src/client/components/shell/ImpersonationBar.tsx';
import { canEnterAs } from '../src/client/components/platform/UsersTab.tsx';
import { suspendedNoticeSignal } from '../src/client/state/suspension-state.ts';
import { currentUserSignal, impersonationSignal, logout, profileLoadedSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { invitationInfoSignal, linkErrorSignal, linkKindSignal, submitInvitation } from '../src/client/state/link-pages-state.ts';
import { navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import type { PlatformUserItem } from '../src/shared/platform-types.ts';

const juan = { id: 'u-juan', email: 'juan@x.com', name: 'Juan', globalRole: 'user' as const };
const ana = { id: 'u-ana', name: 'Ana', globalRole: 'support' as const };

describe('UI de la impersonación (#23, M7b)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    impersonationSignal.value = null;
    logout();
  });

  it('la franja dice como quién, con qué rol y en qué comercio', () => {
    const state = { user: juan, impersonator: ana, tenantSlug: 'kiosco' };
    expect(impersonationBarText(state, { name: 'Kiosco X', role: 'owner' })).toBe('Estás viendo como Juan (owner de Kiosco X)');
    expect(impersonationBarText(state, null)).toBe('Estás viendo como Juan');
  });

  it('"Entrar como": cuentas user activas con algún comercio activo', () => {
    const base: PlatformUserItem = {
      id: 'u',
      name: 'U',
      email: 'u@x.com',
      whatsapp: null,
      globalRole: 'user',
      status: 'active',
      createdAt: '2026-10-01',
      tenants: [{ id: 'k', slug: 'k', name: 'K', role: 'owner', status: 'active' }],
    };
    expect(canEnterAs(base)).toBe(true);
    expect(canEnterAs({ ...base, status: 'disabled' })).toBe(false);
    expect(canEnterAs({ ...base, globalRole: 'support' })).toBe(false);
    expect(canEnterAs({ ...base, tenants: [] })).toBe(false);
    expect(canEnterAs({ ...base, tenants: [{ id: 'k', slug: 'k', name: 'K', role: 'owner', status: 'disabled' }] })).toBe(false);
  });

  it('impersonando, un comercio suspendido no tapa el admin', () => {
    currentUserSignal.value = juan;
    userTenantsSignal.value = [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco X', status: 'suspended', role: 'owner' }];
    profileLoadedSignal.value = true;
    navigate('/admin/kiosco/dashboard');
    expect(suspendedNoticeSignal.value).toBe(true);
    impersonationSignal.value = { user: juan, impersonator: ana, tenantSlug: 'kiosco' };
    expect(suspendedNoticeSignal.value).toBe(false);
  });

  it('impersonando no se acepta una invitación', async () => {
    impersonationSignal.value = { user: juan, impersonator: ana, tenantSlug: 'kiosco' };
    linkKindSignal.value = 'tenant';
    invitationInfoSignal.value = { tenantName: 'K', role: 'member', email: 'juan@x.com', invitedByName: 'X', accountExists: true, expiresAt: '2026-10-10' };
    await submitInvitation();
    expect(linkErrorSignal.value).toBe('No disponible mientras ves como otro usuario');
  });
});
