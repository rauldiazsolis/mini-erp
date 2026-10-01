import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import { AuditLog } from '../src/server/audit/audit-log.ts';

describe('MembershipService y AuditLog (#19)', () => {
  let systemDb: DatabaseSync;
  let auth: AuthService;
  let tm: TenantManager;
  let members: MembershipService;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    auth = new AuthService(systemDb);
    tm = new TenantManager(systemDb, { inMemory: true });
    members = new MembershipService(systemDb);
  });

  it('resuelve el rol: membresía activa, nada si está desactivada, owner para root', () => {
    const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
    const root = auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' }).user;
    tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: ana.id });
    expect(members.resolveRole(ana, 'kiosco-a')).toBe('owner');
    expect(members.resolveRole(root, 'kiosco-a')).toBe('owner');
    expect(members.resolveRole(root, 'no-existe')).toBeUndefined();
    systemDb.prepare("UPDATE memberships SET status = 'disabled'").run();
    expect(members.resolveRole(ana, 'kiosco-a')).toBeUndefined();
  });

  it('isFullyOwnedBy: solo si todas las membresías activas del usuario son en comercios del actor', () => {
    const owner = auth.createUser({ email: 'o@x.com', password: 'password123', name: 'O' }).user;
    const otro = auth.createUser({ email: 'p@x.com', password: 'password123', name: 'P' }).user;
    const emp = auth.createUser({ email: 'e@x.com', password: 'password123', name: 'E' }).user;
    tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: owner.id });
    tm.createTenant({ id: 'kiosco-b', slug: 'kiosco-b', name: 'B', ownerUserId: otro.id });
    members.addMembership('kiosco-a', emp.id, 'member');
    expect(members.isFullyOwnedBy(emp.id, owner.id)).toBe(true);
    members.addMembership('kiosco-b', emp.id, 'member');
    expect(members.isFullyOwnedBy(emp.id, owner.id)).toBe(false);
  });

  it('lista los miembros en orden de llegada y cuenta los owners activos', () => {
    const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
    const bob = auth.createUser({ email: 'bob@x.com', password: 'password123', name: 'Bob' }).user;
    tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: ana.id });
    members.addMembership('kiosco-a', bob.id, 'admin');
    expect(members.listMembers('kiosco-a').map((m) => [m.name, m.role, m.status])).toEqual([
      ['Ana', 'owner', 'active'],
      ['Bob', 'admin', 'active'],
    ]);
    expect(members.countActiveOwners('kiosco-a')).toBe(1);
  });

  it('el último owner activo no se baja ni se desactiva (409)', () => {
    const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
    const root = auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' }).user;
    tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: ana.id });
    const actor = { userId: root.id, role: 'owner' as const };
    expect(() => members.updateMember({ tenantId: 'kiosco-a', actor, targetUserId: ana.id, status: 'disabled' })).toThrow(
      'El comercio necesita al menos un owner activo',
    );
    expect(() => members.updateMember({ tenantId: 'kiosco-a', actor, targetUserId: ana.id, role: 'admin' })).toThrow(
      'El comercio necesita al menos un owner activo',
    );
  });

  it('AuditLog registra y lista con nombres, lo más nuevo primero', () => {
    let t = 0;
    const audit = new AuditLog(systemDb, () => new Date(Date.UTC(2026, 9, 1, 10, t++)));
    const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
    const bob = auth.createUser({ email: 'bob@x.com', password: 'password123', name: 'Bob' }).user;
    audit.record({ actorUserId: ana.id, tenantId: 'kiosco-a', action: 'tenant.created' });
    audit.record({ actorUserId: ana.id, tenantId: 'kiosco-a', action: 'member.disabled', targetUserId: bob.id, details: { role: 'member' } });
    audit.record({ actorUserId: ana.id, tenantId: 'otro', action: 'tenant.created' });
    const list = audit.listForTenant('kiosco-a');
    expect(list.map((e) => e.action)).toEqual(['member.disabled', 'tenant.created']);
    expect(list[0]).toMatchObject({ actorName: 'Ana', targetName: 'Bob', details: { role: 'member' } });
    expect(list[1]?.targetName).toBeNull();
  });
});
