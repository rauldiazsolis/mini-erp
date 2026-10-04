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
  membersSignal,
  invitationsSignal,
  setMemberStatus,
  changeRole,
  createResetLink,
  revokeInvitation,
  type InvitationItem,
  type MemberItem,
} from '../src/client/state/users-state.ts';
import { userTenantsSignal } from '../src/client/state/auth-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { setHistoryForTests } from '../src/client/state/route-state.ts';
import type { TenantRole } from '../src/shared/permissions.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

type Call = { url: string; method: string; body: unknown };

describe('vista Usuarios (#19)', () => {
  let calls: Call[];
  /** Lo que devuelve `GET /users`; las escrituras responden lo que diga `write`. */
  let users: { members: MemberItem[]; invitations: InvitationItem[] };
  let write: () => Response;

  const endpoints = (): string[] => calls.filter((c) => c.method === 'GET').map((c) => c.url);
  const settled = (): Promise<void> => vi.waitFor(() => { expect(queryClient.isFetching()).toBe(0); });

  const login = (role: TenantRole, path = 'dashboard'): void => {
    freshSession('tok');
    userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'Kiosco Ana', status: 'active', role }];
    atTenant('t1', path);
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    setHistoryForTests(null);
    calls = [];
    users = { members: [], invitations: [] };
    write = () => json({});
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined });
      if (method !== 'GET') return Promise.resolve(write());
      if (url.endsWith('/users')) return Promise.resolve(json(users));
      if (url.endsWith('/billing-status')) return Promise.resolve(json({ state: 'ok', debt: 0, deadline: null }));
      return Promise.resolve(json([]));
    });
    login('owner');
    linkReadySignal.value = null;
    inviteErrorSignal.value = null;
    inviteModalOpenSignal.value = false;
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

  it('al entrar a Usuarios pide usuarios y, al owner, la actividad (#59)', async () => {
    users = { members: [{ userId: 'u1', name: 'Ana', email: 'a@k.com', role: 'owner', status: 'active', joinedAt: '', canReset: false }], invitations: [] };
    atTenant('t1', 'usuarios');
    await vi.waitFor(() => { expect(membersSignal.value[0]?.name).toBe('Ana'); });
    expect(endpoints()).toEqual(expect.arrayContaining(['/api/tenants/t1/users', '/api/tenants/t1/audit']));
  });

  it('al admin no le pide la actividad (#59)', async () => {
    login('admin', 'usuarios');
    await vi.waitFor(() => { expect(endpoints()).toContain('/api/tenants/t1/users'); });
    await settled();
    expect(endpoints()).not.toContain('/api/tenants/t1/audit');
  });

  it('invitar muestra el link listo, cierra el modal y recarga la lista', async () => {
    atTenant('t1', 'usuarios');
    await settled();
    write = () => json({ id: 'inv1', token: 'tk', expiresAt: '2026-10-03T10:00:00Z' }, 201);
    users = { members: [], invitations: [{ id: 'inv1', email: 'j@k.com', role: 'member', createdAt: '', expiresAt: '', invitedByName: 'Ana' }] };
    inviteModalOpenSignal.value = true;
    inviteFormSignal.value = { email: 'j@k.com', role: 'member' };
    await submitInvite();
    expect(calls.find((c) => c.method === 'POST')).toEqual({ url: '/api/tenants/t1/invitations', method: 'POST', body: { email: 'j@k.com', role: 'member' } });
    expect(linkReadySignal.value).toMatchObject({ kind: 'invitation', email: 'j@k.com' });
    expect(linkReadySignal.value?.url.endsWith('/invitacion#t=tk')).toBe(true);
    expect(inviteModalOpenSignal.value).toBe(false);
    expect(invitationsSignal.value).toHaveLength(1);
  });

  it('invitar deja viejos usuarios y actividad (#59)', async () => {
    queryClient.setQueryData(tenantKey('t1', 'audit'), []);
    write = () => json({ id: 'inv1', token: 'tk', expiresAt: '2026-10-03T10:00:00Z' }, 201);
    inviteFormSignal.value = { email: 'j@k.com', role: 'member' };
    await submitInvite();
    expect(queryClient.getQueryState(tenantKey('t1', 'audit'))?.isInvalidated).toBe(true);
  });

  it('un correo inválido o un error del servidor quedan en el modal', async () => {
    inviteFormSignal.value = { email: 'sin-arroba', role: 'member' };
    await submitInvite();
    expect(inviteErrorSignal.value).toBe('Ingresá un correo válido');

    write = () => json({ error: 'Ese correo ya es parte del comercio' }, 409);
    inviteModalOpenSignal.value = true;
    inviteFormSignal.value = { email: 'ana@k.com', role: 'member' };
    await submitInvite();
    expect(inviteErrorSignal.value).toBe('Ese correo ya es parte del comercio');
    expect(inviteModalOpenSignal.value).toBe(true);
    expect(linkReadySignal.value).toBeNull();
  });

  it('desactivar y cambiar el rol mandan PATCH y recargan', async () => {
    atTenant('t1', 'usuarios');
    await settled();
    users = { members: [{ userId: 'u2', name: 'J', email: 'j@k.com', role: 'member', status: 'disabled', joinedAt: '', canReset: true }], invitations: [] };
    await setMemberStatus('u2', 'disabled');
    await changeRole('u2', 'admin');
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches.map((c) => c.url)).toEqual(['/api/tenants/t1/users/u2', '/api/tenants/t1/users/u2']);
    expect(patches.map((c) => c.body)).toEqual([{ status: 'disabled' }, { role: 'admin' }]);
    expect(membersSignal.value[0]?.status).toBe('disabled');
  });

  it('el link de restablecimiento se muestra listo para compartir y deja vieja la actividad', async () => {
    queryClient.setQueryData(tenantKey('t1', 'audit'), []);
    write = () => json({ token: 'rt', expiresAt: '2026-10-03T10:00:00Z' }, 201);
    await createResetLink({ userId: 'u2', name: 'J', email: 'j@k.com', role: 'member', status: 'active', joinedAt: '', canReset: true });
    expect(linkReadySignal.value).toMatchObject({ kind: 'reset', email: 'j@k.com' });
    expect(linkReadySignal.value?.url.endsWith('/restablecer#t=rt')).toBe(true);
    expect(queryClient.getQueryState(tenantKey('t1', 'audit'))?.isInvalidated).toBe(true);
  });

  it('revocar manda DELETE y deja viejos los usuarios', async () => {
    queryClient.setQueryData(tenantKey('t1', 'users'), { members: [], invitations: [] });
    await revokeInvitation('inv1');
    expect(calls.find((c) => c.method === 'DELETE')?.url).toBe('/api/tenants/t1/invitations/inv1');
    expect(queryClient.getQueryState(tenantKey('t1', 'users'))?.isInvalidated).toBe(true);
  });
});
