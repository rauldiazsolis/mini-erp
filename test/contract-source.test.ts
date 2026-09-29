import { describe, it, expect } from 'vitest';
import {
  contractBaseUrl,
  contractJson,
  openApiInfoVersion,
  parseVersionJson,
} from '../scripts/contract-source.ts';

describe('contractBaseUrl', () => {
  it('arma la carpeta publicada de una versión del POS', () => {
    expect(contractBaseUrl('0.1.0')).toBe('https://offline-pos.pages.dev/0.1.0/');
  });

  it.each(['v0.1.0', '0.1', '0.1.0-rc.1', '', '../0.1.0'])('rechaza %j', (bad) => {
    expect(() => contractBaseUrl(bad)).toThrow(/x\.y\.z/);
  });
});

describe('parseVersionJson', () => {
  const ok = { version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' };

  it('acepta el version.json publicado', () => {
    expect(parseVersionJson(ok, '0.1.0')).toEqual(ok);
  });

  it('rechaza un version.json de otra versión', () => {
    expect(() => parseVersionJson(ok, '0.2.0')).toThrow(/0\.1\.0.*0\.2\.0/);
  });

  it('rechaza un version.json sin contrato', () => {
    expect(() => parseVersionJson({ version: '0.1.0' }, '0.1.0')).toThrow(/version\.json/);
  });

  it('rechaza versiones que no son x.y.z', () => {
    expect(() => parseVersionJson({ ...ok, contract: '4.4' }, '0.1.0')).toThrow(/version\.json/);
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

describe('contractJson', () => {
  it('guarda la procedencia de la copia', () => {
    expect(
      contractJson({ version: '0.1.0', contract: '4.4.0', minBackendContract: '4.0.0' }),
    ).toEqual({
      posVersion: '0.1.0',
      contract: '4.4.0',
      minBackendContract: '4.0.0',
      source: 'https://offline-pos.pages.dev/0.1.0/',
    });
  });
});
