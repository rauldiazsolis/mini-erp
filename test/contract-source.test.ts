import { describe, it, expect } from 'vitest';
import {
  channelBaseUrl,
  contractJson,
  openApiInfoVersion,
  parseVersionJson,
} from '../scripts/contract-source.ts';

describe('channelBaseUrl (#58)', () => {
  it('arma la carpeta del canal publicado', () => {
    expect(channelBaseUrl('v4')).toBe('https://pos.contax.ar/v4/');
  });

  it.each(['4', 'v0', 'v4.5', '0.1.0', '', '../v4', 'V4'])('rechaza %j', (bad) => {
    expect(() => channelBaseUrl(bad)).toThrow(/v<major>/);
  });
});

describe('parseVersionJson (#58)', () => {
  const ok = { version: '0.3.1', contract: '4.5.0', minBackendContract: '4.0.0' };

  it('acepta el version.json del canal, sin fijar la versión del POS', () => {
    expect(parseVersionJson(ok, 'v4')).toEqual(ok);
  });

  it('rechaza un contrato de otro major que el del canal', () => {
    expect(() => parseVersionJson({ ...ok, contract: '5.0.0' }, 'v4')).toThrow(/v4.*5\.0\.0/);
  });

  it('rechaza un version.json sin contrato', () => {
    expect(() => parseVersionJson({ version: '0.3.1' }, 'v4')).toThrow(/version\.json/);
  });

  it('rechaza versiones que no son x.y.z', () => {
    expect(() => parseVersionJson({ ...ok, contract: '4.5' }, 'v4')).toThrow(/version\.json/);
  });
});

describe('openApiInfoVersion', () => {
  it('lee la versión con comillas simples', () => {
    const yaml = "openapi: 3.1.0\ninfo:\n  title: X\n  version: '4.4.0'\n  description: |\n    y\n";
    expect(openApiInfoVersion(yaml)).toBe('4.4.0');
  });

  it('lee la versión sin comillas y con comillas dobles', () => {
    expect(openApiInfoVersion('info:\n  version: 4.3.0\n')).toBe('4.3.0');
    expect(openApiInfoVersion('info:\n  version: "4.2.0"\n')).toBe('4.2.0');
  });

  it('ignora un version: fuera del bloque info', () => {
    const yaml = "info:\n  title: X\nservers:\n  version: '9.9.9'\n";
    expect(openApiInfoVersion(yaml)).toBeUndefined();
  });

  it('devuelve undefined sin bloque info', () => {
    expect(openApiInfoVersion('openapi: 3.1.0\n')).toBeUndefined();
  });

  it('tolera fines de línea CRLF', () => {
    expect(openApiInfoVersion("info:\r\n  version: '4.4.0'\r\n")).toBe('4.4.0');
  });
});

describe('contractJson (#58)', () => {
  it('guarda la procedencia: el canal y qué POS había', () => {
    expect(
      contractJson('v4', { version: '0.3.1', contract: '4.5.0', minBackendContract: '4.0.0' }),
    ).toEqual({
      channel: 'v4',
      posVersion: '0.3.1',
      contract: '4.5.0',
      minBackendContract: '4.0.0',
      source: 'https://pos.contax.ar/v4/',
    });
  });
});
