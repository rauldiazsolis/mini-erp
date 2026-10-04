import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildLinkUrl,
  whatsappShareUrl,
  linkShareText,
  submitInvite,
  inviteFormSignal,
  inviteErrorSignal,
  inviteModalOpenSignal,
  linkReadySignal,
  loadUsers,
  membersSignal,
  invitationsSignal,
  setMemberStatus,
  changeRole,
  createResetLink,
  revokeInvitation,
} from '../src/client/state/users-state.ts';
import { tokenSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { atTenant } from './helpers/client-route.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const EMPTY = { members: [], invitations: [] };

describe('vista Usuarios (#19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenSignal.value = 'tok';
    userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'Kiosco Ana', status: 'active', role: 'owner' }];
    atTenant('t1');
    linkReadySignal.value = null;
    inviteErrorSignal.value = null;
    inviteModalOpenSignal.value = false;
    membersSignal.value = [];
    invitationsSignal.value = [];
  });

  it('arma los links con el token en el fragmento', () => {
    expect(buildLinkUrl('invitation', 'abc', 'https://mini.contax.ar')).toBe('https://mini.contax.ar/invitacion#t=abc');
    expect(buildLinkUrl('reset', 'abc', 'https://mini.contax.ar')).toBe('https://mini.contax.ar/restablecer#t=abc');
  });

  it('el mensaje de WhatsApp lleva el link y el aviso de 48 h', () => {
    const text = linkShareText({ kind: 'invitation', url: 'https://x/invitacion#t=a', email: 'j@k.com', expiresAt: '' }, 'Kiosco Ana');
    expect(text).toContain('Kiosco Ana');
    expect(text).toContain('https://x/invitacion#t=a');
    expect(text).toContain('48 h');
    expect(whatsappShareUrl('hola mundo')).toBe('https://wa.me/?text=hola%20mundo');
  });

  it('invitar muestra el link listo, cierra el modal y recarga la lista', async () => {
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ id: 'inv1', token: 'tk', expiresAt: '2026-10-03T10:00:00Z' }, 201))
      .mockResolvedValueOnce(
        json({ members: [], invitations: [{ id: 'inv1', email: 'j@k.com', role: 'member', createdAt: '', expiresAt: '', invitedByName: 'Ana' }] }),
      )
      .mockResolvedValueOnce(json([])); // auditoría
    inviteModalOpenSignal.value = true;
    inviteFormSignal.value = { email: 'j@k.com', role: 'member' };
    await submitInvite();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tenants/t1/invitations');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ email: 'j@k.com', role: 'member' }));
    expect(linkReadySignal.value).toMatchObject({ kind: 'invitation', email: 'j@k.com' });
    expect(linkReadySignal.value?.url.endsWith('/invitacion#t=tk')).toBe(true);
    expect(inviteModalOpenSignal.value).toBe(false);
    expect(invitationsSignal.value).toHaveLength(1);
  });

  it('un correo inválido o un error del servidor quedan en el modal', async () => {
    inviteFormSignal.value = { email: 'sin-arroba', role: 'member' };
    await submitInvite();
    expect(inviteErrorSignal.value).toBe('Ingresá un correo válido');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Ese correo ya es parte del comercio' }, 409));
    inviteModalOpenSignal.value = true;
    inviteFormSignal.value = { email: 'ana@k.com', role: 'member' };
    await submitInvite();
    expect(inviteErrorSignal.value).toBe('Ese correo ya es parte del comercio');
    expect(inviteModalOpenSignal.value).toBe(true);
    expect(linkReadySignal.value).toBeNull();
  });

  it('desactivar y cambiar el rol mandan PATCH y recargan', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      if (init?.method === 'PATCH') return Promise.resolve(json({}));
      if (url.endsWith('/users')) {
        return Promise.resolve(
          json({ members: [{ userId: 'u2', name: 'J', email: 'j@k.com', role: 'member', status: 'disabled', joinedAt: '', canReset: true }], invitations: [] }),
        );
      }
      return Promise.resolve(json([])); // auditoría
    });
    await setMemberStatus('u2', 'disabled');
    await changeRole('u2', 'admin');
    const patches = fetchMock.mock.calls.filter((c) => c[1]?.method === 'PATCH');
    expect(patches.map((c) => c[0])).toEqual(['/api/tenants/t1/users/u2', '/api/tenants/t1/users/u2']);
    expect(patches.map((c) => c[1]?.body)).toEqual([JSON.stringify({ status: 'disabled' }), JSON.stringify({ role: 'admin' })]);
    expect(membersSignal.value[0]?.status).toBe('disabled');
  });

  it('el link de restablecimiento se muestra listo para compartir', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ token: 'rt', expiresAt: '2026-10-03T10:00:00Z' }, 201))
      .mockResolvedValueOnce(json([])); // auditoría
    await createResetLink({ userId: 'u2', name: 'J', email: 'j@k.com', role: 'member', status: 'active', joinedAt: '', canReset: true });
    expect(linkReadySignal.value).toMatchObject({ kind: 'reset', email: 'j@k.com' });
    expect(linkReadySignal.value?.url.endsWith('/restablecer#t=rt')).toBe(true);
  });

  it('revocar manda DELETE y recarga', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ success: true })).mockResolvedValueOnce(json(EMPTY)).mockResolvedValueOnce(json([]));
    await revokeInvitation('inv1');
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tenants/t1/invitations/inv1');
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('loadUsers llena miembros e invitaciones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      json({ members: [{ userId: 'u1', name: 'Ana', email: 'a@k.com', role: 'owner', status: 'active', joinedAt: '', canReset: false }], invitations: [] }),
    );
    await loadUsers();
    expect(membersSignal.value[0]?.name).toBe('Ana');
  });
});
