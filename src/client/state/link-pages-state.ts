import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { adoptSession, setActiveTenant } from './auth-state.ts';
import { navigate, routeFromPath } from './route-state.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE } from '../../shared/password.ts';
import type { TenantRole } from '../../shared/permissions.ts';

export type InvitationInfo = {
  tenantName: string;
  role: TenantRole;
  email: string;
  invitedByName: string;
  accountExists: boolean;
  expiresAt: string;
};
export type ResetInfo = { email: string; name: string; expiresAt: string };

const LINK_GONE = 'Este link ya no sirve: pedile uno nuevo a quien te lo mandó';

export const linkTokenSignal = signal<string | null>(null);
export const invitationInfoSignal = signal<InvitationInfo | null>(null);
export const resetInfoSignal = signal<ResetInfo | null>(null);
export const linkErrorSignal = signal<string | null>(null);
export const linkFormSignal = signal<{ name: string; password: string; confirm: string }>({ name: '', password: '', confirm: '' });
export const linkSubmittingSignal = signal<boolean>(false);

/** El token viaja en el fragmento (#19): no llega al servidor ni a los logs. */
export function readLinkToken(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('t');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

export function setLinkField(field: 'name' | 'password' | 'confirm', value: string): void {
  linkFormSignal.value = { ...linkFormSignal.value, [field]: value };
}

export async function loadInvitation(): Promise<void> {
  try {
    invitationInfoSignal.value = await apiFetch<InvitationInfo>('invitations/lookup', {
      method: 'POST',
      body: { token: linkTokenSignal.value ?? '' },
    });
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  }
}

export async function loadReset(): Promise<void> {
  try {
    resetInfoSignal.value = await apiFetch<ResetInfo>('password-resets/lookup', {
      method: 'POST',
      body: { token: linkTokenSignal.value ?? '' },
    });
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  }
}

/** En /invitacion o /restablecer: guarda el token en memoria, lo saca de la URL y consulta el link. */
export function initLinkPageFromUrl(): void {
  if (typeof window === 'undefined') return;
  const route = routeFromPath(window.location.pathname);
  if (route !== 'invitacion' && route !== 'restablecer') return;
  linkTokenSignal.value = readLinkToken(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname);
  if (linkTokenSignal.value === null) {
    linkErrorSignal.value = LINK_GONE;
    return;
  }
  void (route === 'invitacion' ? loadInvitation() : loadReset());
}

function checkNewPassword(): boolean {
  const { password, confirm } = linkFormSignal.value;
  if (password.length < PASSWORD_MIN_LENGTH) {
    linkErrorSignal.value = PASSWORD_MIN_MESSAGE;
    return false;
  }
  if (password !== confirm) {
    linkErrorSignal.value = 'Las contraseñas no coinciden';
    return false;
  }
  return true;
}

export async function submitInvitation(): Promise<void> {
  linkErrorSignal.value = null;
  const info = invitationInfoSignal.value;
  if (info === null) return;
  const { name, password } = linkFormSignal.value;
  if (!info.accountExists) {
    if (name.trim().length < 2) {
      linkErrorSignal.value = 'Escribí tu nombre';
      return;
    }
    if (!checkNewPassword()) return;
  }
  linkSubmittingSignal.value = true;
  try {
    // Sin sesión: un 401 ("Contraseña incorrecta") no dispara el logout global
    const res = await apiFetch<{ token: string; tenantId: string }>('invitations/accept', {
      method: 'POST',
      body: { token: linkTokenSignal.value ?? '', password, ...(info.accountExists ? {} : { name: name.trim() }) },
    });
    await adoptSession(res.token);
    setActiveTenant(res.tenantId);
    navigate('/admin');
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  } finally {
    linkSubmittingSignal.value = false;
  }
}

export async function submitReset(): Promise<void> {
  linkErrorSignal.value = null;
  if (!checkNewPassword()) return;
  linkSubmittingSignal.value = true;
  try {
    const res = await apiFetch<{ token: string }>('password-resets/complete', {
      method: 'POST',
      body: { token: linkTokenSignal.value ?? '', password: linkFormSignal.value.password },
    });
    await adoptSession(res.token);
    navigate('/admin');
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  } finally {
    linkSubmittingSignal.value = false;
  }
}
