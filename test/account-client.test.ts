import { describe, it, expect, beforeEach, vi } from 'vitest';
import { accountFormSignal, accountErrorSignal, submitChangePassword } from '../src/client/state/account-state.ts';
import { tokenSignal } from '../src/client/state/auth-state.ts';

describe('Mi cuenta (#19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenSignal.value = 'tok';
    accountErrorSignal.value = null;
  });

  it('valida mínimo y confirmación antes de llamar al servidor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    accountFormSignal.value = { current: 'vieja', next: 'corta', confirm: 'corta' };
    await submitChangePassword();
    expect(accountErrorSignal.value).toBe('La contraseña debe tener al menos 8 caracteres');
    accountFormSignal.value = { current: 'vieja', next: 'clave-nueva-1', confirm: 'otra-cosa-1' };
    await submitChangePassword();
    expect(accountErrorSignal.value).toBe('Las contraseñas no coinciden');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda la actual y la nueva, y limpia el formulario', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    accountFormSignal.value = { current: 'vieja-1234', next: 'clave-nueva-1', confirm: 'clave-nueva-1' };
    await submitChangePassword();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/password');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ currentPassword: 'vieja-1234', newPassword: 'clave-nueva-1' }));
    expect(accountFormSignal.value).toEqual({ current: '', next: '', confirm: '' });
    expect(accountErrorSignal.value).toBeNull();
  });

  it('muestra el error del servidor y conserva lo escrito', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'La contraseña actual no es correcta' }), { status: 400, headers: { 'Content-Type': 'application/json' } }),
    );
    accountFormSignal.value = { current: 'mal', next: 'clave-nueva-1', confirm: 'clave-nueva-1' };
    await submitChangePassword();
    expect(accountErrorSignal.value).toBe('La contraseña actual no es correcta');
    expect(accountFormSignal.value.next).toBe('clave-nueva-1');
  });
});
