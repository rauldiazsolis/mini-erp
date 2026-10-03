import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { BillingService } from '../billing/billing-service.ts';
import { applyPreset } from '../seeds/index.ts';
import { DomainError } from '../errors.ts';
import { slugify } from './slug.ts';

export type AltaTemplate = 'kiosco' | 'almacen' | 'ferreteria' | 'empty';

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
 * no hay sesión), el comercio, el catálogo del rubro y la key de la primera caja; si algo falla,
 * deshace lo creado.
 */
export class AltaService {
  private auth: AuthService;
  private tenants: TenantManager;
  private apiKeys: ApiKeyService;
  private audit: AuditLog;
  private billing: BillingService;

  constructor(deps: { auth: AuthService; tenants: TenantManager; apiKeys: ApiKeyService; audit: AuditLog; billing: BillingService }) {
    this.auth = deps.auth;
    this.tenants = deps.tenants;
    this.apiKeys = deps.apiKeys;
    this.audit = deps.audit;
    this.billing = deps.billing;
  }

  create(params: {
    user?: UserSession | undefined;
    account?: { name: string; email: string; password: string } | undefined;
    businessName: string;
    template: AltaTemplate;
  }): AltaResult {
    let user = params.user;
    let token: string | undefined;
    let createdUserId: string | undefined;
    let createdTenantId: string | undefined;

    if (user === undefined) {
      if (params.account === undefined) throw new DomainError(400, 'Faltan los datos de la cuenta');
      if (this.auth.findUserByEmail(params.account.email) !== undefined) {
        throw new DomainError(409, 'Ya tenés una cuenta con ese correo: iniciá sesión');
      }
      const created = this.auth.createUser(params.account);
      user = created.user;
      token = created.token;
      createdUserId = created.user.id;
    }

    try {
      const name = params.businessName.trim();
      const slug = slugify(name);
      const tenant = this.tenants.createTenant({ id: slug, slug, name, ownerUserId: user.id, seedDemoData: false });
      createdTenantId = tenant.id;
      if (params.template !== 'empty') {
        applyPreset(this.tenants.getTenantDb(tenant.id), params.template);
      }
      const key = this.apiKeys.createApiKey({ tenantId: tenant.id, name: POINT_OF_SALE, branch: BRANCH, pointOfSale: POINT_OF_SALE });
      // El bono de alta (#21): créditos regalados del comercio, con vencimiento
      this.billing.grantSignupBonus(tenant.id, user.id);
      this.audit.record({ actorUserId: user.id, tenantId: tenant.id, action: 'tenant.created', details: { template: params.template } });
      return {
        ...(token === undefined ? {} : { token }),
        user,
        tenant: { id: tenant.id, name: tenant.name },
        posKey: { key: key.rawKey, branch: BRANCH, pointOfSale: POINT_OF_SALE },
      };
    } catch (err: unknown) {
      if (createdTenantId !== undefined) this.tenants.deleteTenant(createdTenantId);
      if (createdUserId !== undefined) this.auth.deleteUser(createdUserId);
      throw err;
    }
  }
}
