/** Tipos de la API del panel de plataforma (#23), compartidos por servidor y cliente. */
import type { BillingState, BillingSummary, GiftItem } from './credits-types.ts';
import type { TenantRole } from './permissions.ts';

export type TenantStatus = 'active' | 'maintenance' | 'suspended';
export type AccountStatus = 'active' | 'disabled';

export type PlatformTenantItem = {
  id: string;
  slug: string;
  name: string;
  status: TenantStatus;
  businessType: string | null;
  holder: { id: string; name: string } | null;
  billingState: BillingState;
  /** Membresías activas. */
  members: number;
  createdAt: string;
};

export type PlatformMemberItem = { userId: string; name: string; email: string; role: TenantRole; status: AccountStatus };

export type PlatformTenantDetail = {
  tenant: PlatformTenantItem;
  suspension: { since: string; reason: string; byName: string } | null;
  credits: BillingSummary;
  gifts: GiftItem[];
  members: PlatformMemberItem[];
};

export type PlatformUserItem = {
  id: string;
  name: string;
  email: string;
  whatsapp: string | null;
  globalRole: 'root' | 'support' | 'user';
  status: AccountStatus;
  createdAt: string;
  tenants: Array<{ id: string; slug: string; name: string; role: TenantRole; status: AccountStatus }>;
};

export type PlatformAuditItem = {
  id: string;
  at: string;
  action: string;
  actorName: string;
  targetName: string | null;
  tenantId: string | null;
  tenantName: string | null;
  details: Record<string, unknown>;
};

export type StaffInvitationItem = { id: string; email: string; createdAt: string; expiresAt: string; invitedByName: string };
export type StaffInvitationInfo = { email: string; invitedByName: string; accountExists: boolean; expiresAt: string };
export type StaffMemberItem = { id: string; name: string; email: string; globalRole: 'root' | 'support'; status: AccountStatus };
