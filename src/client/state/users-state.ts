import { signal, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal, activeTenantSignal } from './auth-state.ts';
import { activeViewSignal } from './navigation-state.ts';
import { canDo } from './permissions-state.ts';
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
export type AuditItem = { id: string; at: string; action: string; actorName: string; targetName: string | null; details: Record<string, unknown> };
/** Un link recién generado: se muestra una sola vez (#19). */
export type LinkReady = { kind: 'invitation' | 'reset'; url: string; email: string; expiresAt: string };

export const membersSignal = signal<MemberItem[]>([]);
export const invitationsSignal = signal<InvitationItem[]>([]);
export const auditSignal = signal<AuditItem[]>([]);
export const usersLoadingSignal = signal<boolean>(false);
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
};

/** El token va en el fragmento: no llega al servidor ni a los logs. */
export function buildLinkUrl(kind: LinkReady['kind'], token: string, origin: string): string {
  return `${origin}/${kind === 'invitation' ? 'invitacion' : 'restablecer'}#t=${token}`;
}

export function linkShareText(link: LinkReady, tenantName: string): string {
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

function origin(): string {
  return typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
}

function fail(title: string, err: unknown): void {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
}

export async function loadUsers(): Promise<void> {
  usersLoadingSignal.value = true;
  try {
    const res = await apiFetch<{ members: MemberItem[]; invitations: InvitationItem[] }>(`${base()}/users`, { token: tokenSignal.value });
    membersSignal.value = res.members;
    invitationsSignal.value = res.invitations;
  } catch (err: unknown) {
    fail('No se pudieron cargar los usuarios', err);
  } finally {
    usersLoadingSignal.value = false;
  }
}

export async function loadAudit(): Promise<void> {
  try {
    auditSignal.value = await apiFetch<AuditItem[]>(`${base()}/audit`, { token: tokenSignal.value });
  } catch (err: unknown) {
    fail('No se pudo cargar la actividad', err);
  }
}

async function reloadAll(): Promise<void> {
  await loadUsers();
  if (canDo('owners.manage')) await loadAudit();
}

async function invite(email: string, role: TenantRole): Promise<void> {
  const res = await apiFetch<{ id: string; token: string; expiresAt: string }>(`${base()}/invitations`, {
    method: 'POST',
    token: tokenSignal.value,
    body: { email, role },
  });
  linkReadySignal.value = { kind: 'invitation', url: buildLinkUrl('invitation', res.token, origin()), email, expiresAt: res.expiresAt };
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
    linkReadySignal.value = { kind: 'reset', url: buildLinkUrl('reset', res.token, origin()), email: member.email, expiresAt: res.expiresAt };
    if (canDo('owners.manage')) await loadAudit();
  } catch (err: unknown) {
    fail('No se pudo generar el link', err);
  }
}

// Carga al entrar a Usuarios o al cambiar de comercio estando ahí
if (typeof window !== 'undefined') {
  effect(() => {
    if (activeViewSignal.value === 'users' && effectiveTenantIdSignal.value && tokenSignal.value && canDo('users.manage')) {
      void loadUsers();
      if (canDo('owners.manage')) void loadAudit();
    }
  });
}
