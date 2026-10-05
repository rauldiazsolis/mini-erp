import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readLinkToken,
  linkTokenSignal,
  invitationInfoSignal,
  resetInfoSignal,
  linkFormSignal,
  linkErrorSignal,
  loadInvitation,
  loadReset,
  linkKindSignal,
  readLinkKind,
  staffInfoSignal,
  submitInvitation,
  submitReset,
} from '../src/client/state/link-pages-state.ts';
import { tokenSignal, lastTenantIdSignal, logout } from '../src/client/state/auth-state.ts';
import { locationSignal } from '../src/client/state/route-state.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ME = {
  user: { id: 'u', email: 'j@k.com', name: 'Juan', globalRole: 'user' },
  tenants: [{ tenantId: 't1', slug: 't1', name: 'K', status: 'active', role: 'member' }],
};

describe('páginas de links (#19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    logout();
    linkErrorSignal.value = null;
    invitationInfoSignal.value = null;
    resetInfoSignal.value = null;
    linkTokenSignal.value = null;
    linkFormSignal.value = { name: '', password: '', confirm: '' };
  });

  it('una invitación de soporte consulta y acepta en /api/staff-invitations y entra a /plataforma (#23)', async () => {
    expect(readLinkKind('#t=tk&tipo=soporte')).toBe('staff');
    expect(readLinkKind('#t=tk')).toBe('tenant');
    linkKindSignal.value = 'staff';
    linkTokenSignal.value = 'tk';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ email: 'ana@x.com', invitedByName: 'Root', accountExists: false, expiresAt: '' }))
      .mockResolvedValueOnce(json({ token: 'sesion', user: { id: 's' } }))
      .mockResolvedValueOnce(json({ user: { id: 's', email: 'ana@x.com', name: 'Ana', globalRole: 'support' }, tenants: [] }));
    await loadInvitation();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/staff-invitations/lookup');
    expect(staffInfoSignal.value?.email).toBe('ana@x.com');
    linkFormSignal.value = { name: 'Ana', password: 'clave-ana-12', confirm: 'clave-ana-12' };
    await submitInvitation();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/staff-invitations/accept');
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBe(JSON.stringify({ token: 'tk', password: 'clave-ana-12', name: 'Ana' }));
    expect(tokenSignal.value).toBe('sesion');
    expect(locationSignal.value.pathname).toBe('/plataforma');
    linkKindSignal.value = 'tenant';
    staffInfoSignal.value = null;
  });

  it('lee el token del fragmento', () => {
    expect(readLinkToken('#t=abc')).toBe('abc');
    expect(readLinkToken('#t=a-b_c')).toBe('a-b_c');
    expect(readLinkToken('')).toBeNull();
  });

  it('consulta la invitación con el token', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json({ tenantName: 'K', role: 'member', email: 'j@k.com', invitedByName: 'Ana', accountExists: false, expiresAt: '' }),
    );
    linkTokenSignal.value = 'tk';
    await loadInvitation();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/invitations/lookup');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'tk' }));
    expect(invitationInfoSignal.value?.tenantName).toBe('K');
  });

  it('un link que ya no sirve muestra el mensaje del servidor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Este link ya no sirve: pedile uno nuevo a quien te lo mandó' }, 410));
    linkTokenSignal.value = 'viejo';
    await loadReset();
    expect(linkErrorSignal.value).toBe('Este link ya no sirve: pedile uno nuevo a quien te lo mandó');
    expect(resetInfoSignal.value).toBeNull();
  });

  it('aceptar con cuenta nueva pide nombre, mínimo y confirmación, y adopta la sesión con el comercio activo', async () => {
    invitationInfoSignal.value = { tenantName: 'K', role: 'member', email: 'j@k.com', invitedByName: 'Ana', accountExists: false, expiresAt: '' };
    linkTokenSignal.value = 'tk';
    linkFormSignal.value = { name: '', password: 'clave-juan-1', confirm: 'clave-juan-1' };
    await submitInvitation();
    expect(linkErrorSignal.value).toBe('Escribí tu nombre');
    linkFormSignal.value = { name: 'Juan', password: 'corta', confirm: 'corta' };
    await submitInvitation();
    expect(linkErrorSignal.value).toBe('La contraseña debe tener al menos 8 caracteres');
    linkFormSignal.value = { name: 'Juan', password: 'clave-juan-1', confirm: 'otra-clave-1' };
    await submitInvitation();
    expect(linkErrorSignal.value).toBe('Las contraseñas no coinciden');

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ token: 'sesion', user: { id: 'u' }, tenantId: 't1' }))
      .mockResolvedValueOnce(json(ME));
    linkFormSignal.value = { name: 'Juan', password: 'clave-juan-1', confirm: 'clave-juan-1' };
    await submitInvitation();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/invitations/accept');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'tk', password: 'clave-juan-1', name: 'Juan' }));
    expect(linkErrorSignal.value).toBeNull();
    expect(tokenSignal.value).toBe('sesion');
    expect(lastTenantIdSignal.value).toBe('t1');
  });

  it('con cuenta existente manda solo la contraseña, y una contraseña mala no cierra nada', async () => {
    invitationInfoSignal.value = { tenantName: 'K', role: 'admin', email: 'j@k.com', invitedByName: 'Ana', accountExists: true, expiresAt: '' };
    linkTokenSignal.value = 'tk';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Contraseña incorrecta' }, 401));
    linkFormSignal.value = { name: '', password: 'cualquiera', confirm: '' };
    await submitInvitation();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'tk', password: 'cualquiera' }));
    expect(linkErrorSignal.value).toBe('Contraseña incorrecta');
    expect(invitationInfoSignal.value).not.toBeNull();
  });

  it('restablecer valida, manda token y contraseña, y adopta la sesión', async () => {
    linkTokenSignal.value = 'tk';
    linkFormSignal.value = { name: '', password: 'nueva-clave-1', confirm: 'distinta-1' };
    await submitReset();
    expect(linkErrorSignal.value).toBe('Las contraseñas no coinciden');

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ token: 'sesion2', user: { id: 'u' } }))
      .mockResolvedValueOnce(json(ME));
    linkFormSignal.value = { name: '', password: 'nueva-clave-1', confirm: 'nueva-clave-1' };
    await submitReset();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/password-resets/complete');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'tk', password: 'nueva-clave-1' }));
    expect(tokenSignal.value).toBe('sesion2');
  });
});
