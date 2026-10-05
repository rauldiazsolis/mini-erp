import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  beaconOnce,
  contactDialogSignal,
  contactSentSignal,
  openContact,
  resetFunnelPublicForTests,
  submitContact,
} from '../src/client/state/funnel-public-state.ts';
import { demoAltaUrl } from '../src/client/components/shell/DemoBar.tsx';
import { readAltaParams } from '../src/client/state/merchant-onboarding-state.ts';

describe('cliente público del embudo (#25)', () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    resetFunnelPublicForTests();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
  });

  const bodies = (): unknown[] => fetchMock.mock.calls.map(([, init]) => JSON.parse(typeof init?.body === 'string' ? init.body : 'null') as unknown);

  it('beaconOnce manda cada beacon una sola vez por carga', () => {
    beaconOnce('landing');
    beaconOnce('landing');
    beaconOnce('alta-open', 'demo_a');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(['/api/funnel/beacon', '/api/funnel/beacon']);
    expect(bodies()).toEqual([{ kind: 'landing' }, { kind: 'alta-open', demoSessionId: 'demo_a' }]);
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', keepalive: true });
  });

  it('un beacon que falla no tira', () => {
    fetchMock.mockRejectedValue(new Error('sin red'));
    expect(() => {
      beaconOnce('landing');
    }).not.toThrow();
  });

  it('el contacto valida en el cliente con los textos del servidor', async () => {
    openContact('demo', 'demo_a');
    expect(await submitContact({ name: 'A', whatsapp: '1155550000' })).toBe('Escribí tu nombre (2 a 80 letras)');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('el contacto válido se manda con su origen y su demo, y queda recordado', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'c1' }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    openContact('demo', 'demo_a');
    expect(await submitContact({ name: 'Ana', whatsapp: '11 5555-0000' })).toBeNull();
    expect(bodies()).toEqual([{ name: 'Ana', whatsapp: '11 5555-0000', source: 'demo', demoSessionId: 'demo_a' }]);
    expect(contactSentSignal.value).toBe(true);
    expect(contactDialogSignal.value).toBeNull();
  });

  it('un error del servidor vuelve como mensaje y el modal sigue abierto', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Demasiados pedidos; probá más tarde' }), { status: 429, headers: { 'Content-Type': 'application/json' } }),
    );
    openContact('landing');
    expect(await submitContact({ name: 'Ana', whatsapp: '1155550000' })).toBe('Demasiados pedidos; probá más tarde');
    expect(contactDialogSignal.value).toEqual({ source: 'landing' });
    expect(contactSentSignal.value).toBe(false);
  });

  it('el alta de la demo lleva el rubro y el id', () => {
    expect(demoAltaUrl('kiosco', 'demo_a')).toBe('/alta?template=kiosco&demo=demo_a');
    expect(demoAltaUrl('almacen')).toBe('/alta?template=almacen');
  });

  it('readAltaParams lee la demo', () => {
    expect(readAltaParams('http://localhost:4100/alta?template=kiosco&demo=demo_a&return_url=https%3A%2F%2Fpos%2F&wipe_key=w')).toEqual({
      returnUrl: 'https://pos/',
      wipeKey: 'w',
      template: 'kiosco',
      demo: 'demo_a',
    });
  });
});
