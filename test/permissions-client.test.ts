import { describe, it, expect, beforeEach } from 'vitest';
import { activeRoleSignal, canDo, isViewAllowed, isSettingsTabAllowed, ROLE_LABEL } from '../src/client/state/permissions-state.ts';
import { userTenantsSignal } from '../src/client/state/auth-state.ts';
import type { TenantRole } from '../src/shared/permissions.ts';
import { atTenant } from './helpers/client-route.ts';
import { navigate } from '../src/client/state/route-state.ts';

function como(role: TenantRole): void {
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T1', status: 'active', role }];
  atTenant('t1');
}

describe('permisos en el cliente (#19)', () => {
  beforeEach(() => {
    como('owner');
  });

  it('el member no ve masivas, usuarios ni las solapas de keys, sucursales y guía', () => {
    como('member');
    expect(activeRoleSignal.value).toBe('member');
    expect(isViewAllowed('bulk')).toBe(false);
    expect(isViewAllowed('users')).toBe(false);
    expect(isViewAllowed('catalog')).toBe(true);
    expect(isViewAllowed('sales')).toBe(true);
    expect(isViewAllowed('settings')).toBe(true);
    expect(isSettingsTabAllowed('pos')).toBe(false);
    expect(isSettingsTabAllowed('branches')).toBe(false);
    expect(isSettingsTabAllowed('connection')).toBe(false);
    expect(isSettingsTabAllowed('appearance')).toBe(true);
    expect(isSettingsTabAllowed('account')).toBe(true);
  });

  it('el admin ve usuarios pero no la auditoría', () => {
    como('admin');
    expect(isViewAllowed('users')).toBe(true);
    expect(canDo('owners.manage')).toBe(false);
  });

  it('Créditos lo ven owner y admin, no el member (#21)', () => {
    como('owner');
    expect(isViewAllowed('credits')).toBe(true);
    como('admin');
    expect(isViewAllowed('credits')).toBe(true);
    como('member');
    expect(isViewAllowed('credits')).toBe(false);
  });

  it('sin comercio activo no se puede nada', () => {
    navigate('/admin');
    userTenantsSignal.value = [];
    expect(activeRoleSignal.value).toBeNull();
    expect(canDo('tenant.use')).toBe(false);
  });

  it('las etiquetas de rol', () => {
    expect(ROLE_LABEL.member).toBe('Empleado');
  });
});
