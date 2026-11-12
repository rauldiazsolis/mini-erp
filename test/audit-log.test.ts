import { describe, it, expect } from 'vitest';
import { AuditLog, REGISTER_ACTOR, SYSTEM_ACTOR } from '../src/server/audit/audit-log.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const AT = '2026-10-01T10:00:00.000Z';

async function insertUser(id: string, name: string): Promise<void> {
  await db().system.insertInto('users').values({ id, email: `${id}@x.com`, password_hash: 'hash', name, global_role: 'user', created_at: AT }).execute();
}

async function insertTenant(id: string, name: string): Promise<void> {
  await db().system.insertInto('tenants').values({ id, slug: id, name, created_at: AT }).execute();
}

/** Un reloj que avanza un minuto por llamada; `fixed` lo deja quieto (para ver el desempate por `seq`). */
function clock(fixed = false): () => Date {
  let t = 0;
  return () => new Date(Date.UTC(2026, 9, 1, 10, fixed ? 0 : t++));
}

describe('AuditLog (#19, #23, M10)', () => {
  it('registra y lista con nombres, lo más nuevo primero', async () => {
    await insertUser('ana', 'Ana');
    await insertUser('bob', 'Bob');
    const audit = new AuditLog(db().system, clock());
    await audit.record({ actorUserId: 'ana', tenantId: 'kiosco-a', action: 'tenant.created' });
    await audit.record({ actorUserId: 'ana', tenantId: 'kiosco-a', action: 'member.disabled', targetUserId: 'bob', details: { role: 'member' } });
    await audit.record({ actorUserId: 'ana', tenantId: 'otro', action: 'tenant.created' });
    const list = await audit.listForTenant('kiosco-a');
    expect(list.map((e) => e.action)).toEqual(['member.disabled', 'tenant.created']);
    expect(list[0]).toMatchObject({ actorName: 'Ana', targetName: 'Bob', impersonatorName: null, details: { role: 'member' }, at: '2026-10-01T10:01:00.000Z' });
    expect(list[1]).toMatchObject({ targetName: null, details: {} });
    expect(list[0]?.id).toMatch(/^aud_/);
  });

  it('guarda details como jsonb (con anidados y arrays) y "como quién" impersonaba', async () => {
    await insertUser('juan', 'Juan');
    await insertUser('sop', 'Soporte');
    const audit = new AuditLog(db().system, clock());
    await audit.record({ actorUserId: 'juan', impersonatorUserId: 'sop', tenantId: 'k', action: 'register.created', details: { ids: ['a', 'b'], nested: { n: 1 } } });
    const row = await db().system.selectFrom('audit_log').select(['details', 'impersonator_user_id']).executeTakeFirstOrThrow();
    expect(row).toEqual({ details: { ids: ['a', 'b'], nested: { n: 1 } }, impersonator_user_id: 'sop' });
    expect(await audit.listForTenant('k')).toMatchObject([{ actorName: 'Juan', impersonatorName: 'Soporte', details: { ids: ['a', 'b'] } }]);
  });

  it('nombra al servidor, a la caja desde el POS y a los usuarios borrados', async () => {
    await insertTenant('k', 'Kiosco');
    await db().system.insertInto('registers').values({ id: 'reg-1', tenant_id: 'k', name: 'Caja 1', branch: 'CENTRAL', point_of_sale: 'Caja 1', created_at: AT }).execute();
    const audit = new AuditLog(db().system, clock());
    await audit.record({ actorUserId: SYSTEM_ACTOR, tenantId: 'k', action: 'demo.reset' });
    await audit.record({ actorUserId: REGISTER_ACTOR, actorRegisterId: 'reg-1', tenantId: 'k', action: 'portal.opened' });
    await audit.record({ actorUserId: REGISTER_ACTOR, actorRegisterId: 'reg-borrada', tenantId: 'k', action: 'portal.opened' });
    await audit.record({ actorUserId: 'usr-borrado', tenantId: 'k', action: 'tenant.created' });
    expect((await audit.listForTenant('k')).map((e) => e.actorName)).toEqual([
      'Usuario borrado',
      'Caja borrada (desde el POS)',
      'Caja 1 (desde el POS)',
      'Automático',
    ]);
  });

  it('listPlatform: todo o un comercio, con su nombre; a la misma hora desempata por orden de llegada', async () => {
    await insertTenant('k', 'Kiosco');
    const audit = new AuditLog(db().system, clock(true));
    await audit.record({ actorUserId: SYSTEM_ACTOR, tenantId: 'k', action: 'tenant.suspended' });
    await audit.record({ actorUserId: SYSTEM_ACTOR, tenantId: null, action: 'billing.settings_updated' });
    await audit.record({ actorUserId: SYSTEM_ACTOR, tenantId: 'k', action: 'tenant.reactivated' });
    const all = await audit.listPlatform();
    expect(all.map((e) => [e.action, e.tenantId, e.tenantName])).toEqual([
      ['tenant.reactivated', 'k', 'Kiosco'],
      ['billing.settings_updated', null, null],
      ['tenant.suspended', 'k', 'Kiosco'],
    ]);
    expect((await audit.listPlatform({ tenantId: 'k' })).map((e) => e.action)).toEqual(['tenant.reactivated', 'tenant.suspended']);
    expect(await audit.listPlatform({ limit: 1 })).toHaveLength(1);
  });

  it('record con el trx de quien llama: se deshace con su transacción', async () => {
    const audit = new AuditLog(db().system, clock());
    await expect(
      db()
        .system.transaction()
        .execute(async (trx) => {
          await audit.record({ actorUserId: SYSTEM_ACTOR, tenantId: 'k', action: 'demo.reset' }, trx);
          throw new Error('algo falló después');
        }),
    ).rejects.toThrow('algo falló después');
    expect(await audit.listForTenant('k')).toEqual([]);

    await db()
      .system.transaction()
      .execute(async (trx) => {
        await audit.record({ actorUserId: SYSTEM_ACTOR, tenantId: 'k', action: 'demo.reset' }, trx);
      });
    expect(await audit.listForTenant('k')).toHaveLength(1);
  });
});
