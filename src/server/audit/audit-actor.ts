import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

/** El actor de la auditoría (#23): el usuario del pedido y, si impersona alguien, quién. */
export function auditActor(req: AuthenticatedAdminRequest): { actorUserId: string; impersonatorUserId?: string | undefined } {
  const actorUserId = req.user?.id ?? '';
  return req.impersonator === undefined ? { actorUserId } : { actorUserId, impersonatorUserId: req.impersonator.id };
}
