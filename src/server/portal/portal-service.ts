import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { hashLinkToken } from '../auth/crypto.ts';
import { DomainError } from '../errors.ts';
import type { DemoSessionService } from '../demo/demo-session-service.ts';
import { REGISTER_ACTOR, type AuditLog } from '../audit/audit-log.ts';
import type { PortalRedeemResponse } from '../../shared/portal-types.ts';
import type { FunnelService } from '../funnel/funnel-service.ts';
import type { ActiveRegister, ApiKeyService } from '../tenant/api-key-service.ts';

const LINK_TTL_MS = 60 * 1000;
/** Una sesión de caja real vence a las 2 h sin uso (M10), como la impersonación. */
const REGISTER_IDLE_MS = 2 * 60 * 60 * 1000;
/** El último uso se escribe a lo sumo una vez por minuto. */
const TOUCH_EVERY_MS = 60 * 1000;
export const PORTAL_EXPIRED = 'Este link venció: volvé a abrir mini desde el POS';

/** El acceso anónimo (#24, M10): su comercio, su caja y, en una demo, la sesión que lo originó. */
export type AnonymousContext = {
  kind: 'demo' | 'register';
  tenantId: string;
  registerId: string;
  branch: string;
  pointOfSale: string;
  registerName: string;
  demoSessionId?: string;
};

/**
 * El portal (#24, M10): el POS pide con su key la URL para abrir mini, un link de un uso que vence en
 * 60 s. Se canjea por una sesión anónima atada a esa key: la de una demo es admin del comercio demo y
 * vive mientras su demo; la de una caja real consulta su caja y muere al rotar la key, al desactivar la
 * caja o a las 2 h sin uso.
 */
export class PortalService {
  private db: Kysely<SystemDatabase>;
  private now: () => Date;
  private demos: DemoSessionService;
  private audit: AuditLog;
  private funnel: FunnelService;
  private apiKeys: ApiKeyService;

  constructor(deps: {
    db: Kysely<SystemDatabase>;
    now: () => Date;
    demos: DemoSessionService;
    audit: AuditLog;
    funnel: FunnelService;
    apiKeys: ApiKeyService;
  }) {
    this.db = deps.db;
    this.now = deps.now;
    this.demos = deps.demos;
    this.audit = deps.audit;
    this.funnel = deps.funnel;
    this.apiKeys = deps.apiKeys;
  }

  async createLink(p: { tenantId: string; registerId: string; keyId: string; origin: string }): Promise<{ url: string; expiresAt: string }> {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    await this.db
      .insertInto('portal_links')
      .values({
        token_hash: hashLinkToken(token),
        tenant_id: p.tenantId,
        register_id: p.registerId,
        api_key_id: p.keyId,
        created_at: now.toISOString(),
        expires_at: expiresAt,
      })
      .execute();
    return { url: `${p.origin}/portal#t=${token}`, expiresAt };
  }

  async redeem(token: string): Promise<PortalRedeemResponse> {
    const now = this.now().toISOString();
    const tokenHash = hashLinkToken(token);
    const link = await this.db
      .selectFrom('portal_links')
      .select(['tenant_id', 'register_id', 'api_key_id'])
      .where('token_hash', '=', tokenHash)
      .where('used_at', 'is', null)
      .where('expires_at', '>', now)
      .executeTakeFirst();
    if (link === undefined || link.api_key_id === null) throw new DomainError(410, PORTAL_EXPIRED);
    const keyId = link.api_key_id;
    // Las lecturas van antes de la transacción: adentro no se pide otra conexión al pool
    const register = await this.activeRegister(link.register_id, keyId);
    const tenant = await this.db.selectFrom('tenants').select(['id', 'slug', 'name']).where('id', '=', link.tenant_id).executeTakeFirst();
    const demo = await this.demos.activeSessionOfRegister(link.register_id);
    // Una caja de un comercio demo sin su demo activa ya terminó
    if (register === undefined || tenant === undefined || (demo === undefined && (await this.demos.isDemoTenant(link.tenant_id)))) {
      throw new DomainError(410, PORTAL_EXPIRED);
    }
    const session = randomBytes(32).toString('base64url');
    await this.db.transaction().execute(async (trx) => {
      // Un uso: si otro canje ganó (o venció en el medio), no actualiza nada
      const used = await trx
        .updateTable('portal_links')
        .set({ used_at: now })
        .where('token_hash', '=', tokenHash)
        .where('used_at', 'is', null)
        .where('expires_at', '>', now)
        .executeTakeFirst();
      if (Number(used.numUpdatedRows) === 0) throw new DomainError(410, PORTAL_EXPIRED);
      await trx
        .insertInto('anonymous_sessions')
        .values({
          token_hash: hashLinkToken(session),
          kind: demo === undefined ? 'register' : 'demo',
          tenant_id: link.tenant_id,
          register_id: link.register_id,
          api_key_id: keyId,
          demo_session_id: demo?.id ?? null,
          created_at: now,
          last_used_at: now,
        })
        .execute();
      if (demo === undefined) {
        await this.audit.record(
          {
            actorUserId: REGISTER_ACTOR,
            actorRegisterId: link.register_id,
            tenantId: link.tenant_id,
            action: 'portal.opened',
            details: { registerName: register.name },
          },
          trx,
        );
      }
    });
    // Mini desde el POS (#25): la sesión anónima se borra al revocar, así que se registra
    if (demo !== undefined) await this.funnel.tryRecord('portal-opened', { demoSessionId: demo.id });
    const base = {
      token: session,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      branch: register.branch,
      pointOfSale: register.pointOfSale,
    };
    return demo === undefined ? { access: 'register', ...base, registerName: register.name } : { access: 'demo', ...base, template: demo.template, demoSessionId: demo.id };
  }

  /** La sesión anónima del token, si sigue valiendo; si no, la borra. Usarla corre su último uso. */
  async resolveAnonymous(token: string): Promise<AnonymousContext | undefined> {
    const hash = hashLinkToken(token);
    const row = await this.db
      .selectFrom('anonymous_sessions')
      .select(['kind', 'tenant_id', 'register_id', 'api_key_id', 'demo_session_id', 'last_used_at'])
      .where('token_hash', '=', hash)
      .executeTakeFirst();
    if (row === undefined) return undefined;
    const now = this.now();
    const register = await this.activeRegister(row.register_id, row.api_key_id);
    const idle = now.getTime() - Date.parse(row.last_used_at);
    const demoSessionId = row.kind === 'demo' ? row.demo_session_id : null;
    const alive =
      demoSessionId !== null ? (await this.demos.activeSessionOfRegister(row.register_id)) !== undefined : row.kind === 'register' && idle < REGISTER_IDLE_MS;
    if (register === undefined || !alive) {
      await this.db.deleteFrom('anonymous_sessions').where('token_hash', '=', hash).execute();
      return undefined;
    }
    if (demoSessionId !== null) await this.demos.touchRegister(row.register_id);
    else if (idle >= TOUCH_EVERY_MS) await this.db.updateTable('anonymous_sessions').set({ last_used_at: now.toISOString() }).where('token_hash', '=', hash).execute();
    const context = {
      tenantId: row.tenant_id,
      registerId: row.register_id,
      branch: register.branch,
      pointOfSale: register.pointOfSale,
      registerName: register.name,
    };
    return demoSessionId === null ? { kind: 'register', ...context } : { kind: 'demo', ...context, demoSessionId };
  }

  /** La caja, si está activa y la key es una key activa suya (las cajas ya están en PostgreSQL). */
  private async activeRegister(registerId: string, keyId: string): Promise<ActiveRegister | undefined> {
    return await this.apiKeys.activeRegister(registerId, keyId);
  }
}
