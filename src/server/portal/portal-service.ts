import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { hashLinkToken } from '../auth/crypto.ts';
import { DomainError } from '../errors.ts';
import type { DemoSessionService } from '../demo/demo-session-service.ts';
import { REGISTER_ACTOR, type AuditLog } from '../audit/audit-log.ts';
import type { PortalRedeemResponse } from '../../shared/portal-types.ts';

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

type ActiveRegister = { name: string; branch: string; point_of_sale: string };

/**
 * El portal (#24, M10): el POS pide con su key la URL para abrir mini, un link de un uso que vence en
 * 60 s. Se canjea por una sesión anónima atada a esa key: la de una demo es admin del comercio demo y
 * vive mientras su demo; la de una caja real consulta su caja y muere al rotar la key, al desactivar la
 * caja o a las 2 h sin uso.
 */
export class PortalService {
  private db: DatabaseSync;
  private now: () => Date;
  private demos: DemoSessionService;
  private audit: AuditLog;

  constructor(deps: { systemDb: DatabaseSync; now: () => Date; demos: DemoSessionService; audit: AuditLog }) {
    this.db = deps.systemDb;
    this.now = deps.now;
    this.demos = deps.demos;
    this.audit = deps.audit;
  }

  createLink(p: { tenantId: string; registerId: string; keyId: string; origin: string }): { url: string; expiresAt: string } {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO portal_links (token_hash, tenant_id, register_id, api_key_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(hashLinkToken(token), p.tenantId, p.registerId, p.keyId, now.toISOString(), expiresAt);
    return { url: `${p.origin}/portal#t=${token}`, expiresAt };
  }

  redeem(token: string): PortalRedeemResponse {
    const now = this.now().toISOString();
    const link = this.db
      .prepare('SELECT token_hash, tenant_id, register_id, api_key_id FROM portal_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(hashLinkToken(token), now) as { token_hash: string; tenant_id: string; register_id: string; api_key_id: string | null } | undefined;
    if (link === undefined || link.api_key_id === null) throw new DomainError(410, PORTAL_EXPIRED);
    const register = this.activeRegister(link.register_id, link.api_key_id);
    const tenant = this.db.prepare('SELECT id, slug, name FROM tenants WHERE id = ?').get(link.tenant_id) as
      | { id: string; slug: string; name: string }
      | undefined;
    const demo = this.demos.activeSessionOfRegister(link.register_id);
    // Una caja de un comercio demo sin su demo activa ya terminó
    if (register === undefined || tenant === undefined || (demo === undefined && this.demos.isDemoTenant(link.tenant_id))) {
      throw new DomainError(410, PORTAL_EXPIRED);
    }
    const session = randomBytes(32).toString('base64url');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE portal_links SET used_at = ? WHERE token_hash = ?').run(now, link.token_hash);
      this.db
        .prepare(
          'INSERT INTO anonymous_sessions (token_hash, kind, tenant_id, register_id, api_key_id, demo_session_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .run(hashLinkToken(session), demo === undefined ? 'register' : 'demo', link.tenant_id, link.register_id, link.api_key_id, demo?.id ?? null, now, now);
      if (demo === undefined) {
        this.audit.record({
          actorUserId: REGISTER_ACTOR,
          actorRegisterId: link.register_id,
          tenantId: link.tenant_id,
          action: 'portal.opened',
          details: { registerName: register.name },
        });
      }
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    const base = {
      token: session,
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      branch: register.branch,
      pointOfSale: register.point_of_sale,
    };
    return demo === undefined ? { access: 'register', ...base, registerName: register.name } : { access: 'demo', ...base, template: demo.template };
  }

  /** La sesión anónima del token, si sigue valiendo; si no, la borra. Usarla corre su último uso. */
  resolveAnonymous(token: string): AnonymousContext | undefined {
    const hash = hashLinkToken(token);
    const row = this.db
      .prepare('SELECT kind, tenant_id, register_id, api_key_id, demo_session_id, last_used_at FROM anonymous_sessions WHERE token_hash = ?')
      .get(hash) as
      | { kind: string; tenant_id: string; register_id: string; api_key_id: string; demo_session_id: string | null; last_used_at: string }
      | undefined;
    if (row === undefined) return undefined;
    const now = this.now();
    const register = this.activeRegister(row.register_id, row.api_key_id);
    const idle = now.getTime() - Date.parse(row.last_used_at);
    const demoSessionId = row.kind === 'demo' ? row.demo_session_id : null;
    const alive =
      demoSessionId !== null ? this.demos.activeSessionOfRegister(row.register_id) !== undefined : row.kind === 'register' && idle < REGISTER_IDLE_MS;
    if (register === undefined || !alive) {
      this.db.prepare('DELETE FROM anonymous_sessions WHERE token_hash = ?').run(hash);
      return undefined;
    }
    if (demoSessionId !== null) this.demos.touchRegister(row.register_id);
    else if (idle >= TOUCH_EVERY_MS) this.db.prepare('UPDATE anonymous_sessions SET last_used_at = ? WHERE token_hash = ?').run(now.toISOString(), hash);
    const context = {
      tenantId: row.tenant_id,
      registerId: row.register_id,
      branch: register.branch,
      pointOfSale: register.point_of_sale,
      registerName: register.name,
    };
    return demoSessionId === null ? { kind: 'register', ...context } : { kind: 'demo', ...context, demoSessionId };
  }

  /** La caja, si está activa y la key es una key activa suya. */
  private activeRegister(registerId: string, keyId: string): ActiveRegister | undefined {
    return this.db
      .prepare(
        `SELECT r.name, r.branch, r.point_of_sale FROM registers r JOIN tenant_api_keys k ON k.register_id = r.id
         WHERE r.id = ? AND k.id = ? AND r.active = 1 AND k.active = 1`,
      )
      .get(registerId, keyId) as ActiveRegister | undefined;
  }
}
