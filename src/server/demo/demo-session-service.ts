import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import { DEMO_BRANCH_CODE, DEMO_COMMERCES, DEMO_TEMPLATES, isDemoTemplate, seedDemoCommerce, type DemoTemplate } from '../seeds/index.ts';
import type { DemoConfig } from './demo-config.ts';

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
  systemDb: DatabaseSync;
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
    this.deps.systemDb
      .prepare('INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES (?, ?, ?)')
      .run(tenantId, template, now.toISOString());
    return tenantId;
  }

  async create(template: DemoTemplate): Promise<DemoSession> {
    const tenantId = await this.ensureDemoTenant(template);
    const sessionId = randomUUID();
    const pointOfSale = await this.freePointOfSale(tenantId, sessionId);
    const { rawKey, registerId } = await this.deps.apiKeyService.createApiKey({
      tenantId,
      name: pointOfSale,
      branch: DEMO_BRANCH_CODE,
      pointOfSale,
    });
    const at = this.deps.now().toISOString();
    this.deps.systemDb
      .prepare('INSERT INTO demo_sessions (id, template, tenant_id, register_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sessionId, template, tenantId, registerId, at, at);
    return { sessionId, tenantId, apiKey: rawKey, branch: DEMO_BRANCH_CODE, pointOfSale, template };
  }

  /** Corre el último uso de la demo de una caja (a lo sumo por minuto). En una caja real no hace nada. */
  async touchRegister(registerId: string): Promise<void> {
    const now = this.deps.now();
    const since = new Date(now.getTime() - TOUCH_EVERY_MS).toISOString();
    this.deps.systemDb
      .prepare('UPDATE demo_sessions SET last_used_at = ? WHERE register_id = ? AND revoked_at IS NULL AND last_used_at <= ?')
      .run(now.toISOString(), registerId, since);
  }

  async countActive(): Promise<number> {
    const row = this.deps.systemDb.prepare('SELECT COUNT(*) AS n FROM demo_sessions WHERE revoked_at IS NULL').get() as { n: number };
    return row.n;
  }

  async isFull(): Promise<boolean> {
    return (await this.countActive()) >= this.deps.config.maxActive;
  }

  async isDemoTenant(tenantId: string): Promise<boolean> {
    return (await this.templateOf(tenantId)) !== undefined;
  }

  async templateOf(tenantId: string): Promise<DemoTemplate | undefined> {
    const row = this.deps.systemDb.prepare('SELECT template FROM demo_tenants WHERE tenant_id = ?').get(tenantId) as
      | { template: string }
      | undefined;
    return row !== undefined && isDemoTemplate(row.template) ? row.template : undefined;
  }

  /** La sesión vigente de una caja de visitante, o `undefined` (caja real o revocada). */
  async activeSessionOfRegister(registerId: string): Promise<ActiveDemoSession | undefined> {
    // Fase 3 de PostgreSQL: la caja ya está en PostgreSQL y la demo, todavía en SQLite.
    const row = this.deps.systemDb
      .prepare('SELECT id, tenant_id, template FROM demo_sessions WHERE register_id = ? AND revoked_at IS NULL')
      .get(registerId) as { id: string; tenant_id: string; template: string } | undefined;
    if (row === undefined || !isDemoTemplate(row.template)) return undefined;
    const register = await this.deps.apiKeyService.activeRegister(registerId);
    if (register === undefined) return undefined;
    return { id: row.id, tenantId: row.tenant_id, template: row.template, pointOfSale: register.pointOfSale };
  }

  /** Revoca las cajas sin uso por `ttlHours`. */
  async revokeIdle(): Promise<number> {
    const cutoff = new Date(this.deps.now().getTime() - this.deps.config.ttlHours * HOUR_MS).toISOString();
    return await this.revoke('last_used_at < ?', [cutoff], 'idle');
  }

  /** Revoca todas las cajas de visitante de un comercio (reinicio total). */
  async revokeTenant(tenantId: string, reason: 'reset'): Promise<number> {
    return await this.revoke('tenant_id = ?', [tenantId], reason);
  }

  private async hasDemoTenant(template: DemoTemplate): Promise<boolean> {
    return this.deps.systemDb.prepare('SELECT 1 FROM demo_tenants WHERE template = ?').get(template) !== undefined;
  }

  /** `Demo XXXX` con 4 caracteres del id, distinto de las cajas activas del comercio. */
  private async freePointOfSale(tenantId: string, sessionId: string): Promise<string> {
    let candidate = `Demo ${sessionId.slice(0, 4).toUpperCase()}`;
    while (await this.deps.apiKeyService.pointOfSaleInUse(tenantId, candidate)) {
      candidate = `Demo ${randomUUID().slice(0, 4).toUpperCase()}`;
    }
    return candidate;
  }

  private async revoke(where: string, params: string[], reason: RevokeReason): Promise<number> {
    const db = this.deps.systemDb;
    const rows = db.prepare(`SELECT id, register_id FROM demo_sessions WHERE revoked_at IS NULL AND ${where}`).all(...params) as {
      id: string;
      register_id: string;
    }[];
    if (rows.length === 0) return 0;
    const at = this.deps.now().toISOString();
    // Fase 3 de PostgreSQL: las cajas y keys se revocan primero, en PostgreSQL (lo que corta el 401);
    // la demo, sus sesiones anónimas y sus links siguen en SQLite hasta el dominio 7.
    await this.deps.apiKeyService.deactivateRegisters(rows.map((r) => r.register_id));
    db.exec('BEGIN');
    try {
      for (const r of rows) {
        db.prepare('UPDATE demo_sessions SET revoked_at = ?, revoke_reason = ? WHERE id = ?').run(at, reason, r.id);
        db.prepare('DELETE FROM anonymous_sessions WHERE register_id = ?').run(r.register_id);
        db.prepare('DELETE FROM portal_links WHERE register_id = ?').run(r.register_id);
      }
      db.exec('COMMIT');
    } catch (err: unknown) {
      db.exec('ROLLBACK');
      throw err;
    }
    return rows.length;
  }
}
