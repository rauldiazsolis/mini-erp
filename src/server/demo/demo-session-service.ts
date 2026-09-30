import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import { seedDemoSession, type DemoTemplate } from '../seeds/index.ts';
import type { DemoConfig } from './demo-config.ts';

export const DEMO_BRANCH = 'CENTRAL';
export const DEMO_POINT_OF_SALE = 'Caja 1';

const HOUR_MS = 60 * 60 * 1000;

export type DemoSession = {
  tenantId: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  template: DemoTemplate;
};

export type DemoSessionDeps = {
  systemDb: DatabaseSync;
  tenantManager: TenantManager;
  apiKeyService: ApiKeyService;
  config: DemoConfig;
  now: () => Date;
};

/**
 * Demos aisladas (#9): un tenant sin dueño por cada `POST /demo-sessions`, marcado en
 * `demo_sessions`. Vence a las `ttlHours` del último uso y lo borra `sweepExpired`.
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

  create(template: DemoTemplate): DemoSession {
    const { systemDb, tenantManager, apiKeyService } = this.deps;
    const id = `demo-${randomUUID().slice(0, 8)}`;
    const title = `${template.charAt(0).toUpperCase()}${template.slice(1)}`;
    const tenant = tenantManager.createTenant({ id, slug: id, name: `Demo ${title}` });
    seedDemoSession(tenantManager.getTenantDb(tenant.id), template);
    const { rawKey } = apiKeyService.createApiKey({
      tenantId: tenant.id,
      name: 'Demo',
      branch: DEMO_BRANCH,
      pointOfSale: DEMO_POINT_OF_SALE,
    });
    const at = this.deps.now().toISOString();
    systemDb
      .prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .run(tenant.id, template, at, at);
    return {
      tenantId: tenant.id,
      apiKey: rawKey,
      branch: DEMO_BRANCH,
      pointOfSale: DEMO_POINT_OF_SALE,
      template,
    };
  }

  /** Corre el vencimiento de una demo en uso. En un tenant real no hace nada. */
  touch(tenantId: string): void {
    this.deps.systemDb
      .prepare('UPDATE demo_sessions SET last_used_at = ? WHERE tenant_id = ?')
      .run(this.deps.now().toISOString(), tenantId);
  }

  /** Borra las demos sin uso por más de `ttlHours`. Devuelve cuántas borró. */
  sweepExpired(): number {
    const cutoff = new Date(this.deps.now().getTime() - this.deps.config.ttlHours * HOUR_MS).toISOString();
    const rows = this.deps.systemDb
      .prepare('SELECT tenant_id FROM demo_sessions WHERE last_used_at < ?')
      .all(cutoff) as { tenant_id: string }[];
    for (const row of rows) {
      this.deps.tenantManager.deleteTenant(row.tenant_id);
    }
    return rows.length;
  }

  countActive(): number {
    const row = this.deps.systemDb.prepare('SELECT COUNT(*) AS n FROM demo_sessions').get() as { n: number };
    return row.n;
  }

  isFull(): boolean {
    return this.countActive() >= this.deps.config.maxActive;
  }
}

/** Barre al arrancar y cada `intervalMs`, sin mantener vivo el proceso. */
export function startDemoSweeper(service: DemoSessionService, intervalMs: number): NodeJS.Timeout {
  service.sweepExpired();
  const timer = setInterval(() => {
    service.sweepExpired();
  }, intervalMs);
  timer.unref();
  return timer;
}
