import { describe, it, expect, beforeEach } from 'vitest';
import { BillingService } from '../src/server/billing/billing-service.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import { AuditLog } from '../src/server/audit/audit-log.ts';
import { PlatformQueryService } from '../src/server/platform/platform-query-service.ts';
import { SuspensionService } from '../src/server/platform/suspension-service.ts';
import { setupTestDb } from './helpers/test-db.ts';
import { fakeBillingBridge } from './helpers/billing-bridge.ts';

const db = setupTestDb();

// Fase 3 de PostgreSQL: los comercios demo salen del puente a SQLite (lo borra el dominio 7)
describe('la plataforma deja afuera a los comercios demo', () => {
  let queries: PlatformQueryService;
  let suspensions: SuspensionService;

  beforeEach(async () => {
    const now = () => new Date('2026-10-05T15:00:00.000Z');
    const demos = fakeBillingBridge({ demos: ['demo-kiosco'] });
    const audit = new AuditLog(db().system, now);
    await db().system.insertInto('users').values({ id: 'u1', email: 'u1@x.com', password_hash: 'x', name: 'Uno', global_role: 'root', created_at: now().toISOString() }).execute();
    for (const [id, name] of [['kiosco', 'Kiosco Ñandú'], ['demo-kiosco', 'Kiosco Demo']] as const) {
      await db().system.insertInto('tenants').values({ id, slug: id, name, created_at: now().toISOString() }).execute();
    }
    const billing = new BillingService({ db: db().system, now, legacy: demos });
    queries = new PlatformQueryService({ db: db().system, billing, members: new MembershipService(db().system, audit), demos });
    suspensions = new SuspensionService({ db: db().system, audit, now, demos });
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
