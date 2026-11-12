import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import { DEMO_BRANCH_CODE, DEMO_COMMERCES, DEMO_TEMPLATES, isDemoTemplate, seedDemoCommerce, type DemoTemplate } from '../seeds/index.ts';
import type { DemoConfig } from './demo-config.ts';
import { isDemoTenant } from './demo-tenant-ids.ts';

const HOUR_MS = 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;

export type RevokeReason = 'reset' | 'idle' | 'legacy';

export type DemoSession = {
  sessionId: string;
  tenantId: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  template: DemoTemplate;
};

export type ActiveDemoSession = { id: string; tenantId: string; template: DemoTemplate; pointOfSale: string };

export type DemoSessionDeps = {
  db: Kysely<SystemDatabase>;
  tenantManager: TenantManager;
  apiKeyService: ApiKeyService;
  config: DemoConfig;
  now: () => Date;
};

/**
 * Demos v2 (#24): un comercio fijo por rubro y una caja por visitante. Cada `POST /demo-sessions` crea
 * una caja (key) en el comercio del rubro y su fila de `demo_sessions`, el registro que usa M9 y que
 * nunca se borra. Revocar una caja (reinicio total o inactividad) le da 401 a su key.
 */
export class DemoSessionService {
  private deps: DemoSessionDeps;

  constructor(deps: DemoSessionDeps) {
    this.deps = deps;
  }

  enabled(): boolean {
    return this.deps.config.enabled;
  }

  publicUrl(): string | undefined {
    return this.deps.config.publicUrl;
  }

  resetHour(): number {
    return this.deps.config.resetHour;
  }

  /** Crea los comercios demo que falten. Devuelve los rubros creados. */
  async ensureDemoTenants(): Promise<DemoTemplate[]> {
    const created: DemoTemplate[] = [];
    for (const t of DEMO_TEMPLATES) {
      if (await this.hasDemoTenant(t)) continue;
      await this.ensureDemoTenant(t);
      created.push(t);
    }
    return created;
  }

  /** El comercio demo del rubro; si falta, lo crea y lo siembra. */
  async ensureDemoTenant(template: DemoTemplate): Promise<string> {
    const { tenantId, name } = DEMO_COMMERCES[template];
    if (await this.hasDemoTenant(template)) return tenantId;
    const now = this.deps.now();
    if (!(await this.deps.tenantManager.tenantExists(tenantId))) {
      await this.deps.tenantManager.createTenant({ id: tenantId, slug: tenantId, name });
    }
    await seedDemoCommerce(this.deps.tenantManager.getTenantDb(tenantId), template, now);
    await this.deps.db
      .insertInto('demo_tenants')
      .values({ tenant_id: tenantId, template, last_full_reset_at: now.toISOString() })
      .onConflict((oc) => oc.doNothing())
      .execute();
    return tenantId;
  }

  async create(template: DemoTemplate): Promise<DemoSession> {
    const tenantId = await this.ensureDemoTenant(template);
    const sessionId = randomUUID();
    const pointOfSale = await this.freePointOfSale(tenantId, sessionId);
    const at = this.deps.now().toISOString();
    // La caja, su key y la demo nacen juntas
    const rawKey = await this.deps.db.transaction().execute(async (trx) => {
      const key = await this.deps.apiKeyService.createApiKey({ tenantId, name: pointOfSale, branch: DEMO_BRANCH_CODE, pointOfSale }, trx);
      await trx
        .insertInto('demo_sessions')
        .values({ id: sessionId, template, tenant_id: tenantId, register_id: key.registerId, created_at: at, last_used_at: at })
        .execute();
      return key.rawKey;
    });
    return { sessionId, tenantId, apiKey: rawKey, branch: DEMO_BRANCH_CODE, pointOfSale, template };
  }

  /** Corre el último uso de la demo de una caja (a lo sumo por minuto). En una caja real no hace nada. */
  async touchRegister(registerId: string): Promise<void> {
    const now = this.deps.now();
    const since = new Date(now.getTime() - TOUCH_EVERY_MS).toISOString();
    await this.deps.db
      .updateTable('demo_sessions')
      .set({ last_used_at: now.toISOString() })
      .where('register_id', '=', registerId)
      .where('revoked_at', 'is', null)
      .where('last_used_at', '<=', since)
      .execute();
  }

  async countActive(): Promise<number> {
    const row = await this.deps.db
      .selectFrom('demo_sessions')
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .where('revoked_at', 'is', null)
      .executeTakeFirstOrThrow();
    return row.n;
  }

  async isFull(): Promise<boolean> {
    return (await this.countActive()) >= this.deps.config.maxActive;
  }

  async isDemoTenant(tenantId: string): Promise<boolean> {
    return await isDemoTenant(this.deps.db, tenantId);
  }

  async templateOf(tenantId: string): Promise<DemoTemplate | undefined> {
    const row = await this.deps.db.selectFrom('demo_tenants').select('template').where('tenant_id', '=', tenantId).executeTakeFirst();
    return row !== undefined && isDemoTemplate(row.template) ? row.template : undefined;
  }

  /** La sesión vigente de una caja de visitante, o `undefined` (caja real o revocada). */
  async activeSessionOfRegister(registerId: string): Promise<ActiveDemoSession | undefined> {
    const row = await this.deps.db
      .selectFrom('demo_sessions as s')
      .innerJoin('registers as r', 'r.id', 's.register_id')
      .select(['s.id', 's.tenant_id', 's.template', 'r.point_of_sale'])
      .where('s.register_id', '=', registerId)
      .where('s.revoked_at', 'is', null)
      .where('r.active', '=', true)
      .executeTakeFirst();
    if (row === undefined || !isDemoTemplate(row.template)) return undefined;
    return { id: row.id, tenantId: row.tenant_id, template: row.template, pointOfSale: row.point_of_sale };
  }

  /** Revoca las cajas sin uso por `ttlHours`. */
  async revokeIdle(): Promise<number> {
    const cutoff = new Date(this.deps.now().getTime() - this.deps.config.ttlHours * HOUR_MS).toISOString();
    return await this.revoke({ idleBefore: cutoff }, 'idle');
  }

  /** Revoca todas las cajas de visitante de un comercio (reinicio total). */
  async revokeTenant(tenantId: string, reason: 'reset'): Promise<number> {
    return await this.revoke({ tenantId }, reason);
  }

  private async hasDemoTenant(template: DemoTemplate): Promise<boolean> {
    return (await this.deps.db.selectFrom('demo_tenants').select('tenant_id').where('template', '=', template).executeTakeFirst()) !== undefined;
  }

  /** `Demo XXXX` con 4 caracteres del id, distinto de las cajas activas del comercio. */
  private async freePointOfSale(tenantId: string, sessionId: string): Promise<string> {
    let candidate = `Demo ${sessionId.slice(0, 4).toUpperCase()}`;
    while (await this.deps.apiKeyService.pointOfSaleInUse(tenantId, candidate)) {
      candidate = `Demo ${randomUUID().slice(0, 4).toUpperCase()}`;
    }
    return candidate;
  }

  /** Revoca en una transacción las cajas y keys, la demo, sus sesiones anónimas y sus links. */
  private async revoke(which: { idleBefore: string } | { tenantId: string }, reason: RevokeReason): Promise<number> {
    const at = this.deps.now().toISOString();
    return await this.deps.db.transaction().execute(async (trx) => {
      let query = trx.selectFrom('demo_sessions').select(['id', 'register_id']).where('revoked_at', 'is', null);
      query = 'tenantId' in which ? query.where('tenant_id', '=', which.tenantId) : query.where('last_used_at', '<', which.idleBefore);
      const rows = await query.forUpdate().execute();
      if (rows.length === 0) return 0;
      const registerIds = rows.map((r) => r.register_id);
      await this.deps.apiKeyService.deactivateRegisters(registerIds, trx);
      await trx
        .updateTable('demo_sessions')
        .set({ revoked_at: at, revoke_reason: reason })
        .where('id', 'in', rows.map((r) => r.id))
        .execute();
      await trx.deleteFrom('anonymous_sessions').where('register_id', 'in', registerIds).execute();
      await trx.deleteFrom('portal_links').where('register_id', 'in', registerIds).execute();
      return rows.length;
    });
  }
}
