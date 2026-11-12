import { describe, it, expect, beforeEach } from 'vitest';
import { BillingService } from '../src/server/billing/billing-service.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import { AuditLog } from '../src/server/audit/audit-log.ts';
import { PlatformQueryService } from '../src/server/platform/platform-query-service.ts';
import { SuspensionService } from '../src/server/platform/suspension-service.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

// Los comercios demo son los de `demo_tenants`
describe('la plataforma deja afuera a los comercios demo', () => {
  let queries: PlatformQueryService;
  let suspensions: SuspensionService;

  beforeEach(async () => {
    const now = () => new Date('2026-10-05T15:00:00.000Z');
    const audit = new AuditLog(db().system, now);
    await db().system.insertInto('users').values({ id: 'u1', email: 'u1@x.com', password_hash: 'x', name: 'Uno', global_role: 'root', created_at: now().toISOString() }).execute();
    for (const [id, name] of [['kiosco', 'Kiosco Ñandú'], ['demo-kiosco', 'Kiosco Demo']] as const) {
      await db().system.insertInto('tenants').values({ id, slug: id, name, created_at: now().toISOString() }).execute();
    }
    await db().system.insertInto('demo_tenants').values({ tenant_id: 'demo-kiosco', template: 'kiosco', last_full_reset_at: now().toISOString() }).execute();
    const billing = new BillingService({ db: db().system, now });
    queries = new PlatformQueryService({ db: db().system, billing, members: new MembershipService(db().system, audit) });
    suspensions = new SuspensionService({ db: db().system, audit, now });
  });

  it('Comercios, el detalle y el slug no muestran demos; la búsqueda ignora tildes', async () => {
    expect((await queries.listTenants()).map((t) => t.id)).toEqual(['kiosco']);
    expect((await queries.listTenants('nandu')).map((t) => t.id)).toEqual(['kiosco']);
    await expect(queries.tenantIdBySlug('demo-kiosco')).rejects.toMatchObject({ status: 404 });
    await expect(queries.tenantDetail('demo-kiosco')).rejects.toMatchObject({ status: 404 });
  });

  it('un comercio demo no se suspende', async () => {
    await expect(suspensions.suspend({ tenantId: 'demo-kiosco', reason: 'x', actorUserId: 'u1' })).rejects.toMatchObject({ status: 404 });
    await suspensions.suspend({ tenantId: 'kiosco', reason: 'x', actorUserId: 'u1' });
    expect((await queries.tenantDetail('kiosco')).suspension).toMatchObject({ reason: 'x', byName: 'Uno' });
  });
});
