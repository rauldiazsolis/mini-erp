import { describe, it, expect } from 'vitest';
import { buildConnectReturnUrl } from '../src/client/state/connect-return.ts';

const connection = {
  baseUrl: 'http://localhost:4100/connector',
  apiKey: 'mpos_abc',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
};

function decode(url: string): unknown {
  const hash = new URL(url).hash;
  expect(hash.startsWith('#connect=')).toBe(true);
  return JSON.parse(Buffer.from(hash.slice('#connect='.length), 'base64url').toString('utf-8'));
}

describe('buildConnectReturnUrl (#9)', () => {
  it('pone la conexión en el fragmento, con el wipeKey recibido', () => {
    const url = buildConnectReturnUrl('https://offline-pos.pages.dev/0.1.0/', { ...connection, wipeKey: 'wk-1' });
    expect(url?.startsWith('https://offline-pos.pages.dev/0.1.0/#connect=')).toBe(true);
    expect(decode(url ?? '')).toEqual({ ...connection, wipeKey: 'wk-1' });
  });

  it('sin wipeKey no lo manda', () => {
    const url = buildConnectReturnUrl('https://offline-pos.pages.dev/0.1.0/', { ...connection, wipeKey: undefined });
    expect(decode(url ?? '')).toEqual(connection);
  });

  it('nunca pone la conexión en la query y conserva la que había', () => {
    const url = buildConnectReturnUrl('https://pos.example.com/app/?x=1#viejo', connection) ?? '';
    const parsed = new URL(url);
    expect(parsed.search).toBe('?x=1');
    expect(parsed.hash.startsWith('#connect=')).toBe(true);
    expect(url).not.toContain('mpos_abc');
  });

  it('base64url sin relleno ni caracteres de base64 común', () => {
    const url = buildConnectReturnUrl('https://pos.example.com/', { ...connection, apiKey: '???>>>~~~ñ' }) ?? '';
    expect(new URL(url).hash.slice('#connect='.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(url)).toMatchObject({ apiKey: '???>>>~~~ñ' });
  });

  it.each(['javascript:alert(1)', 'data:text/html,hola', 'no es una url', ''])('rechaza %j', (bad) => {
    expect(buildConnectReturnUrl(bad, connection)).toBeUndefined();
  });
});
