import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { BillingService } from '../billing/billing-service.ts';
import type { BusinessType } from '../../shared/business-type.ts';
import type { FunnelService } from '../funnel/funnel-service.ts';
import { DomainError } from '../errors.ts';
import { slugify } from './slug.ts';

export type AltaResult = {
  token?: string;
  user: UserSession;
  tenant: { id: string; name: string };
  posKey: { key: string; branch: string; pointOfSale: string };
};

const BRANCH = 'CENTRAL';
const POINT_OF_SALE = 'Caja 1';

/**
 * Alta (#19): la única forma de que nazca una cuenta, además de una invitación. Crea la cuenta (si
 * no hay sesión, con su WhatsApp), el comercio vacío con su rubro (#22: los datos se cargan después,
 * en "Cargá tus datos") y la key de la primera caja; si algo falla, no queda nada a medias.
 */
export class AltaService {
  private db: Kysely<SystemDatabase>;
  private auth: AuthService;
  private tenants: TenantManager;
  private apiKeys: ApiKeyService;
  private audit: AuditLog;
  private billing: BillingService;
  private funnel: FunnelService;

  constructor(deps: {
    db: Kysely<SystemDatabase>;
    auth: AuthService;
    tenants: TenantManager;
    apiKeys: ApiKeyService;
    audit: AuditLog;
    billing: BillingService;
    funnel: FunnelService;
  }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.tenants = deps.tenants;
    this.apiKeys = deps.apiKeys;
    this.audit = deps.audit;
    this.billing = deps.billing;
    this.funnel = deps.funnel;
  }

  /**
   * Lo de sistema (cuenta, comercio y membresía, la liga a la demo, la caja con su key, el bono y la
   * auditoría) va en una transacción de PostgreSQL. El esquema del comercio se crea después del
   * commit (`createTenantSchema` no puede correr dentro de la transacción de otro); si falla, se
   * compensa borrando el comercio y la cuenta recién creada.
   */
  async create(params: {
    user?: UserSession | undefined;
    account?: { name: string; email: string; password: string; whatsapp: string } | undefined;
    businessName: string;
    businessType: BusinessType;
    demoSessionId?: string | undefined;
  }): Promise<AltaResult> {
    const existingUser = params.user;
    const account = params.account;
    if (existingUser === undefined) {
      if (account === undefined) throw new DomainError(400, 'Faltan los datos de la cuenta');
      if ((await this.auth.findUserByEmail(account.email)) !== undefined) {
        throw new DomainError(409, 'Ya tenés una cuenta con ese correo: iniciá sesión');
      }
    }

    const name = params.businessName.trim();
    const slug = slugify(name);
    const created = await this.db.transaction().execute(async (trx) => {
      let user = existingUser;
      let token: string | undefined;
      if (user === undefined) {
        if (account === undefined) throw new DomainError(400, 'Faltan los datos de la cuenta');
        const signup = await this.auth.createUser(account, trx);
        user = signup.user;
        token = signup.token;
      }
      const tenant = await this.tenants.createTenantRecord(
        { id: slug, slug, name, ownerUserId: user.id, seedDemoData: false, businessType: params.businessType },
        trx,
      );
      // El comercio queda ligado a la demo de la que salió (#25); una demo desconocida se ignora
      if (params.demoSessionId !== undefined) await this.funnel.linkTenant(tenant.id, params.demoSessionId, trx);
      const key = await this.apiKeys.createApiKey({ tenantId: tenant.id, name: POINT_OF_SALE, branch: BRANCH, pointOfSale: POINT_OF_SALE }, trx);
      // El bono de alta (#21): créditos regalados del comercio, con vencimiento
      await this.billing.grantSignupBonus(tenant.id, user.id, trx);
      await this.audit.record({ actorUserId: user.id, tenantId: tenant.id, action: 'tenant.created', details: { businessType: params.businessType } }, trx);
      return { user, token, tenant, key, createdUser: existingUser === undefined };
    });

    try {
      await this.tenants.initTenantStorage(created.tenant.id, { now: created.tenant.created_at });
    } catch (err: unknown) {
      // Cajas, keys, membresías y el bono se van con el comercio (`ON DELETE CASCADE`)
      await this.tenants.deleteTenant(created.tenant.id);
      if (created.createdUser) await this.auth.deleteUser(created.user.id);
      throw err;
    }

    const { user, token, tenant, key } = created;
    return {
      ...(token === undefined ? {} : { token }),
      user,
      tenant: { id: tenant.id, name: tenant.name },
      posKey: { key: key.rawKey, branch: BRANCH, pointOfSale: POINT_OF_SALE },
    };
  }
}
