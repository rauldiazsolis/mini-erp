import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal, activeTenantSignal } from './auth-state.ts';
import { inSection } from './route-state.ts';
import { canDo } from './permissions-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import { showToast } from './toast-state.ts';
import type { TenantRole } from '../../shared/permissions.ts';

export type MemberItem = {
  userId: string;
  name: string;
  email: string;
  role: TenantRole;
  status: 'active' | 'disabled';
  joinedAt: string;
  canReset: boolean;
};
export type InvitationItem = { id: string; email: string; role: TenantRole; createdAt: string; expiresAt: string; invitedByName: string };
export type AuditItem = {
  id: string;
  at: string;
  action: string;
  actorName: string;
  impersonatorName: string | null;
  targetName: string | null;
  details: Record<string, unknown>;
};
/** Un link recién generado: se muestra una sola vez (#19). */
export type LinkReady = { kind: 'invitation' | 'reset' | 'staff-invitation'; url: string; email: string; expiresAt: string };

export const inviteModalOpenSignal = signal<boolean>(false);
export const inviteFormSignal = signal<{ email: string; role: TenantRole }>({ email: '', role: 'member' });
export const inviteErrorSignal = signal<string | null>(null);
export const inviteSubmittingSignal = signal<boolean>(false);
export const linkReadySignal = signal<LinkReady | null>(null);

export const AUDIT_LABEL: Record<string, string> = {
  'tenant.created': 'creó el comercio',
  'invitation.created': 'invitó a',
  'invitation.revoked': 'revocó la invitación de',
  'invitation.accepted': 'aceptó la invitación',
  'member.role_changed': 'cambió el rol de',
  'member.disabled': 'desactivó a',
  'member.enabled': 'reactivó a',
  'password.reset_link_created': 'generó un link de restablecimiento para',
  'password.reset': 'restableció su contraseña',
  'password.changed': 'cambió su contraseña',
  'register.created': 'creó una caja',
  'register.key_rotated': 'generó una key nueva para una caja',
  'register.transferred': 'pasó una caja a otro equipo',
  'register.unbound': 'desligó el equipo de una caja',
  'register.deactivated': 'desactivó una caja',
  'billing.payment_registered': 'registró un pago',
  'billing.credits_granted': 'otorgó un bono',
  'billing.credit_voided': 'anuló un bono',
  'billing.grace_extended': 'extendió la gracia',
  'billing.refund': 'registró una devolución',
  'billing.holder_changed': 'cambió el titular a',
  // Plataforma (#23)
  'tenant.suspended': 'suspendió el comercio',
  'tenant.reactivated': 'reactivó el comercio',
  'user.disabled': 'desactivó la cuenta de',
  'user.enabled': 'reactivó la cuenta de',
  'staff.invited': 'invitó a soporte a',
  'staff.invitation_revoked': 'revocó la invitación a soporte de',
  'staff.joined': 'se sumó a soporte',
  // Impersonación (#23)
  'impersonation.started': 'entró como',
  'impersonation.ended': 'salió de la cuenta de',
  // Demos (#24)
  'demo.reset': 'reinició la demo',
  // Embudo (#25)
  'funnel.contact-handled': 'atendió un contacto del embudo',
  // Portal (M10)
  'portal.opened': 'abrió mini',
};

/** Por qué terminó una impersonación (#23). */
export const IMPERSONATION_END_LABEL: Record<string, string> = {
  exit: 'salió',
  expired: 'venció por falta de uso',
  'parent-ended': 'se cerró la sesión de soporte',
};

/** El actor de una línea de auditoría (#23): "Ana (soporte) como Juan" si fue impersonando. */
export function auditActorText(e: { actorName: string; impersonatorName: string | null }): string {
  return e.impersonatorName === null ? e.actorName : `${e.impersonatorName} (soporte) como ${e.actorName}`;
}

/** El token va en el fragmento: no llega al servidor ni a los logs. */
export function buildLinkUrl(kind: LinkReady['kind'], token: string, origin: string): string {
  if (kind === 'staff-invitation') return `${origin}/invitacion#t=${token}&tipo=soporte`;
  return `${origin}/${kind === 'invitation' ? 'invitacion' : 'restablecer'}#t=${token}`;
}

export function linkShareText(link: LinkReady, tenantName: string): string {
  if (link.kind === 'staff-invitation') return `Te invito al equipo de soporte de mini contax: ${link.url} (sirve una vez y vence en 48 h)`;
  return link.kind === 'invitation'
    ? `Te invito a ${tenantName} en mini contax: ${link.url} (sirve una vez y vence en 48 h)`
    : `Para elegir tu nueva contraseña de mini contax: ${link.url} (sirve una vez y vence en 48 h)`;
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

export function currentTenantName(): string {
  return activeTenantSignal.value?.name ?? 'el comercio';
}

function base(): string {
  return `tenants/${effectiveTenantIdSignal.value ?? ''}`;
}

export function linkOrigin(): string {
  return typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
}

function fail(title: string, err: unknown): void {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
}

/** Usuarios e invitaciones vienen del mismo pedido (#59). */
const usersQuery = createTenantQuery<{ members: MemberItem[]; invitations: InvitationItem[] }>({
  domain: 'users',
  enabled: () => inSection('users') && canDo('users.manage'),
  onError: (err) => {
    fail('No se pudieron cargar los usuarios', err);
  },
  fn: ({ tenantId, token }) => apiFetch<{ members: MemberItem[]; invitations: InvitationItem[] }>(`tenants/${tenantId}/users`, { token }),
});

/** La actividad la ve solo el owner. */
const auditQuery = createTenantQuery<AuditItem[]>({
  domain: 'audit',
  enabled: () => inSection('users') && canDo('owners.manage'),
  onError: (err) => {
    fail('No se pudo cargar la actividad', err);
  },
  fn: ({ tenantId, token }) => apiFetch<AuditItem[]>(`tenants/${tenantId}/audit`, { token }),
});

export const membersSignal = computed<MemberItem[]>(() => usersQuery.data.value?.members ?? []);
export const invitationsSignal = computed<InvitationItem[]>(() => usersQuery.data.value?.invitations ?? []);
export const auditSignal = computed<AuditItem[]>(() => auditQuery.data.value ?? []);
export const usersLoadingSignal = usersQuery.isLoading;

async function reloadAll(): Promise<void> {
  await invalidateAfter('users-changed');
}

async function invite(email: string, role: TenantRole): Promise<void> {
  const res = await apiFetch<{ id: string; token: string; expiresAt: string }>(`${base()}/invitations`, {
    method: 'POST',
    token: tokenSignal.value,
    body: { email, role },
  });
  linkReadySignal.value = { kind: 'invitation', url: buildLinkUrl('invitation', res.token, linkOrigin()), email, expiresAt: res.expiresAt };
  await reloadAll();
}

export function setInviteEmail(email: string): void {
  inviteFormSignal.value = { ...inviteFormSignal.value, email };
}

export function setInviteRole(role: TenantRole): void {
  inviteFormSignal.value = { ...inviteFormSignal.value, role };
}

export function closeInviteModal(): void {
  inviteModalOpenSignal.value = false;
}

export function closeLinkReady(): void {
  linkReadySignal.value = null;
}

export function openInviteModal(): void {
  inviteFormSignal.value = { email: '', role: 'member' };
  inviteErrorSignal.value = null;
  inviteModalOpenSignal.value = true;
}

export async function submitInvite(): Promise<void> {
  inviteErrorSignal.value = null;
  const { email, role } = inviteFormSignal.value;
  if (!email.includes('@')) {
    inviteErrorSignal.value = 'Ingresá un correo válido';
    return;
  }
  inviteSubmittingSignal.value = true;
  try {
    await invite(email.trim(), role);
    inviteModalOpenSignal.value = false;
    inviteFormSignal.value = { email: '', role: 'member' };
  } catch (err: unknown) {
    inviteErrorSignal.value = err instanceof Error ? err.message : 'No se pudo invitar';
  } finally {
    inviteSubmittingSignal.value = false;
  }
}

/** Genera un link nuevo para una invitación pendiente: el servidor revoca la anterior. */
export async function reinvite(inv: InvitationItem): Promise<void> {
  try {
    await invite(inv.email, inv.role);
  } catch (err: unknown) {
    fail('No se pudo generar el link', err);
  }
}

export async function revokeInvitation(id: string): Promise<void> {
  try {
    await apiFetch(`${base()}/invitations/${id}`, { method: 'DELETE', token: tokenSignal.value });
    await reloadAll();
  } catch (err: unknown) {
    fail('No se pudo revocar', err);
  }
}

async function patchMember(userId: string, body: { role?: TenantRole; status?: 'active' | 'disabled' }): Promise<void> {
  try {
    await apiFetch(`${base()}/users/${userId}`, { method: 'PATCH', token: tokenSignal.value, body });
    await reloadAll();
  } catch (err: unknown) {
    fail('No se pudo guardar el cambio', err);
  }
}

export function changeRole(userId: string, role: TenantRole): Promise<void> {
  return patchMember(userId, { role });
}

export function setMemberStatus(userId: string, status: 'active' | 'disabled'): Promise<void> {
  return patchMember(userId, { status });
}

export async function createResetLink(member: MemberItem): Promise<void> {
  try {
    const res = await apiFetch<{ token: string; expiresAt: string }>(`${base()}/users/${member.userId}/password-reset`, {
      method: 'POST',
      token: tokenSignal.value,
    });
    linkReadySignal.value = { kind: 'reset', url: buildLinkUrl('reset', res.token, linkOrigin()), email: member.email, expiresAt: res.expiresAt };
    await reloadAll();
  } catch (err: unknown) {
    fail('No se pudo generar el link', err);
  }
}
