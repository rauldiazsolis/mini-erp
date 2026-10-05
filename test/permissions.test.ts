import { describe, it, expect } from 'vitest';
import { can, canAs, assignableRoles, REGISTER_ALLOWED, type Capability, type TenantRole } from '../src/shared/permissions.ts';
import { passwordSchema, PASSWORD_MIN_LENGTH } from '../src/shared/password.ts';

describe('matriz de capacidades (#19)', () => {
  const tabla: Record<Capability, Record<TenantRole, boolean>> = {
    'tenant.view': { owner: true, admin: true, member: true },
    'sales.view': { owner: true, admin: true, member: true },
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

  it('la contraseña pide 8 caracteres', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
  });
});

describe('canAs por tipo de acceso (#24, M10)', () => {
  it('un usuario puede lo que su rol', () => {
    expect(canAs('member', 'tenant.use', 'user')).toBe(true);
    expect(canAs('member', 'bulk', 'user')).toBe(false);
  });

  it('la demo es admin sin usuarios, owners, créditos ni configuración', () => {
    expect(canAs('admin', 'tenant.use', 'demo')).toBe(true);
    expect(canAs('admin', 'bulk', 'demo')).toBe(true);
    for (const cap of ['settings.manage', 'users.manage', 'owners.manage', 'credits.view'] as const) {
      expect(canAs('admin', cap, 'demo')).toBe(false);
      expect(canAs('admin', cap, 'user')).toBe(can('admin', cap));
    }
  });

  it('la caja real solo consulta el comercio y sus ventas', () => {
    expect(REGISTER_ALLOWED).toEqual(['tenant.view', 'sales.view']);
    expect(canAs('member', 'tenant.view', 'register')).toBe(true);
    expect(canAs('member', 'sales.view', 'register')).toBe(true);
    for (const cap of ['tenant.use', 'bulk', 'settings.manage', 'users.manage', 'owners.manage', 'credits.view'] as const) {
      expect(canAs('member', cap, 'register')).toBe(false);
    }
  });
});
