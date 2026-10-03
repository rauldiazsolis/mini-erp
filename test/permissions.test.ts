import { describe, it, expect } from 'vitest';
import { can, assignableRoles, effectiveTenantRole, type Capability, type TenantRole } from '../src/shared/permissions.ts';
import { passwordSchema, PASSWORD_MIN_LENGTH } from '../src/shared/password.ts';

describe('matriz de capacidades (#19)', () => {
  const tabla: Record<Capability, Record<TenantRole, boolean>> = {
    'tenant.use': { owner: true, admin: true, member: true },
    bulk: { owner: true, admin: true, member: false },
    'settings.manage': { owner: true, admin: true, member: false },
    'users.manage': { owner: true, admin: true, member: false },
    'owners.manage': { owner: true, admin: false, member: false },
    'credits.view': { owner: true, admin: true, member: false },
  };

  for (const [cap, roles] of Object.entries(tabla) as [Capability, Record<TenantRole, boolean>][]) {
    for (const [role, esperado] of Object.entries(roles) as [TenantRole, boolean][]) {
      it(`${role} ${esperado ? 'puede' : 'no puede'} ${cap}`, () => {
        expect(can(role, cap)).toBe(esperado);
      });
    }
  }

  it('owner asigna los tres roles, admin solo admin y member, member ninguno', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'member']);
    expect(assignableRoles('admin')).toEqual(['admin', 'member']);
    expect(assignableRoles('member')).toEqual([]);
  });

  it('root y support impersonando cuentan como owner hasta M7', () => {
    expect(effectiveTenantRole('root_impersonator')).toBe('owner');
    expect(effectiveTenantRole('support_impersonator')).toBe('owner');
    expect(effectiveTenantRole('member')).toBe('member');
  });

  it('la contraseña pide 8 caracteres', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
  });
});
