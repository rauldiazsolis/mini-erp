/** Tipos de los pedidos de ayuda y de los accesos de soporte (#23), compartidos por servidor y cliente. */

export const HELP_MESSAGE_MAX = 500;

export type HelpRequestStatus = 'open' | 'expired' | 'closed';
export type HelpRequestTake = { staffName: string; at: string };

export type HelpRequestItem = {
  id: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  userId: string;
  userName: string;
  path: string;
  message: string;
  createdAt: string;
  expiresAt: string;
  status: HelpRequestStatus;
  takes: HelpRequestTake[];
};

export type HelpRequestCreated = { id: string; url: string; expiresAt: string };

export type SupportAccessItem = { at: string; staffName: string; byRequest: boolean };

export type SupportAccess = {
  supportWhatsapp: string;
  openRequest: { id: string; message: string; createdAt: string; expiresAt: string } | null;
  accesses: SupportAccessItem[];
  activeNow: boolean;
};
