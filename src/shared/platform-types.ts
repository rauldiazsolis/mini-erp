/** Tipos de la API del panel de plataforma (#23), compartidos por servidor y cliente. */

export type StaffInvitationItem = { id: string; email: string; createdAt: string; expiresAt: string; invitedByName: string };
export type StaffInvitationInfo = { email: string; invitedByName: string; accountExists: boolean; expiresAt: string };
export type StaffMemberItem = { id: string; name: string; email: string; globalRole: 'root' | 'support'; status: 'active' | 'disabled' };
