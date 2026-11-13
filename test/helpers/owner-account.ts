import type { AuditLog } from '../../src/server/audit/audit-log.ts';
import type { AuthService } from '../../src/server/auth/auth-service.ts';
import type { TenantManager } from '../../src/server/db/tenant-manager.ts';
import { slugify } from '../../src/server/alta/slug.ts';

export type OwnerAccount = { token: string; user: { id: string }; tenant: { id: string } };

/**
 * Una cuenta con su comercio, como la deja el alta (`tenant.created` en la auditoría), pero sin la
 * caja ni el bono: para los tests de usuarios, invitaciones y contraseñas, que no prueban el alta.
 */
export async function createOwnerAccount(
  deps: { authService: AuthService; tenantManager: TenantManager; auditLog: AuditLog },
  p: { name: string; email: string; password: string; businessName: string },
): Promise<OwnerAccount> {
  const { token, user } = await deps.authService.createUser({ name: p.name, email: p.email, password: p.password, whatsapp: '1155550000' });
  const slug = slugify(p.businessName);
  const tenant = await deps.tenantManager.createTenant({ id: slug, slug, name: p.businessName, ownerUserId: user.id, businessType: 'otro' });
  await deps.auditLog.record({ actorUserId: user.id, tenantId: tenant.id, action: 'tenant.created', details: { businessType: 'otro' } });
  return { token, user: { id: user.id }, tenant: { id: tenant.id } };
}
