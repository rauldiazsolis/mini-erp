import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE } from '../../shared/password.ts';

export const accountFormSignal = signal<{ current: string; next: string; confirm: string }>({ current: '', next: '', confirm: '' });
export const accountErrorSignal = signal<string | null>(null);
export const accountSavingSignal = signal<boolean>(false);

/** Cambiar la propia contraseña (#19): el servidor cierra las sesiones de los otros equipos. */
export async function submitChangePassword(): Promise<void> {
  accountErrorSignal.value = null;
  const { current, next, confirm } = accountFormSignal.value;
  if (next.length < PASSWORD_MIN_LENGTH) {
    accountErrorSignal.value = PASSWORD_MIN_MESSAGE;
    return;
  }
  if (next !== confirm) {
    accountErrorSignal.value = 'Las contraseñas no coinciden';
    return;
  }
  accountSavingSignal.value = true;
  try {
    await apiFetch('auth/password', { method: 'POST', token: tokenSignal.value, body: { currentPassword: current, newPassword: next } });
    accountFormSignal.value = { current: '', next: '', confirm: '' };
    showToast({ type: 'success', title: 'Contraseña cambiada', message: 'Se cerró la sesión en tus otros equipos' });
  } catch (err: unknown) {
    accountErrorSignal.value = err instanceof Error ? err.message : 'No se pudo cambiar la contraseña';
  } finally {
    accountSavingSignal.value = false;
  }
}
