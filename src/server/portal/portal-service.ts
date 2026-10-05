import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { hashLinkToken } from '../auth/crypto.ts';
import { DomainError } from '../errors.ts';
import type { DemoSessionService } from '../demo/demo-session-service.ts';
import { DEMO_BRANCH_CODE } from '../seeds/index.ts';
import type { PortalRedeemResponse } from '../../shared/portal-types.ts';

const LINK_TTL_MS = 60 * 1000;
export const PORTAL_EXPIRED = 'Este link venció: volvé a abrir mini desde el POS';

/** El acceso anónimo de una demo (#24): su comercio, su caja y la sesión de demo que lo originó. */
export type AnonymousContext = { tenantId: string; registerId: string; demoSessionId: string; pointOfSale: string };

/**
 * El portal (#24, adelantado de M10): el POS pide con su key la URL para abrir mini. Con una caja de
 * demo, un link de un uso que vence en 60 s y se canjea por una sesión anónima como admin del comercio
 * demo, que vive mientras su caja esté activa. Con una caja real, el login de mini.
 */
export class PortalService {
  private db: DatabaseSync;
  private now: () => Date;
  private demos: DemoSessionService;

  constructor(deps: { systemDb: DatabaseSync; now: () => Date; demos: DemoSessionService }) {
    this.db = deps.systemDb;
    this.now = deps.now;
    this.demos = deps.demos;
  }

  createLink(p: { tenantId: string; registerId: string; origin: string }): { url: string; expiresAt?: string } {
    const demo = this.demos.activeSessionOfRegister(p.registerId);
    if (demo === undefined) {
      const row = this.db.prepare('SELECT slug FROM tenants WHERE id = ?').get(p.tenantId) as { slug: string } | undefined;
      return { url: `${p.origin}/admin/${encodeURIComponent(row?.slug ?? p.tenantId)}` };
    }
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO portal_links (token_hash, tenant_id, register_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(hashLinkToken(token), p.tenantId, p.registerId, now.toISOString(), expiresAt);
    return { url: `${p.origin}/portal#t=${token}`, expiresAt };
  }

  redeem(token: string): PortalRedeemResponse {
    const now = this.now().toISOString();
    const link = this.db
      .prepare('SELECT token_hash, tenant_id, register_id FROM portal_links WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .get(hashLinkToken(token), now) as { token_hash: string; tenant_id: string; register_id: string } | undefined;
    const demo = link === undefined ? undefined : this.demos.activeSessionOfRegister(link.register_id);
    const tenant =
      link === undefined
        ? undefined
        : (this.db.prepare('SELECT id, slug, name FROM tenants WHERE id = ?').get(link.tenant_id) as
            | { id: string; slug: string; name: string }
            | undefined);
    if (link === undefined || demo === undefined || tenant === undefined) throw new DomainError(410, PORTAL_EXPIRED);
    const session = randomBytes(32).toString('base64url');
    this.db.exec('BEGIN');
    try {
      this.db.prepare('UPDATE portal_links SET used_at = ? WHERE token_hash = ?').run(now, link.token_hash);
      this.db
        .prepare(
          'INSERT INTO anonymous_sessions (token_hash, tenant_id, register_id, demo_session_id, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(hashLinkToken(session), link.tenant_id, link.register_id, demo.id, now, now);
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return { token: session, tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, branch: DEMO_BRANCH_CODE, pointOfSale: demo.pointOfSale, template: demo.template };
  }

  /** La sesión anónima del token, si su caja sigue activa; si no, la borra. Corre el uso de la demo. */
  resolveAnonymous(token: string): AnonymousContext | undefined {
    const hash = hashLinkToken(token);
    const row = this.db.prepare('SELECT tenant_id, register_id, demo_session_id FROM anonymous_sessions WHERE token_hash = ?').get(hash) as
      | { tenant_id: string; register_id: string; demo_session_id: string }
      | undefined;
    if (row === undefined) return undefined;
    const demo = this.demos.activeSessionOfRegister(row.register_id);
    if (demo === undefined) {
      this.db.prepare('DELETE FROM anonymous_sessions WHERE token_hash = ?').run(hash);
      return undefined;
    }
    this.demos.touchRegister(row.register_id);
    return { tenantId: row.tenant_id, registerId: row.register_id, demoSessionId: row.demo_session_id, pointOfSale: demo.pointOfSale };
  }
}
