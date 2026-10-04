import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bundleAssetRefs, htmlAssetRefs, manifestAssetRefs } from '../src/server/pos-mirror/pos-assets.ts';
import { isPosMirrored, mirrorPos, type FetchLike } from '../src/server/pos-mirror/mirror.ts';

const BASE = 'https://pos.contax.ar/v4/';

const INDEX = `<!doctype html>
<html><head>
<link rel="icon" type="image/svg+xml" href="./favicon.svg" />
<script type="module" crossorigin src="./assets/index-AAA.js"></script>
<link rel="stylesheet" crossorigin href="./assets/index-BBB.css">
<link rel="preconnect" href="https://fonts.example.com">
</head><body></body></html>`;

describe('Referencias del build publicado del POS (#9)', () => {
  it('saca del index.html los archivos relativos, sin los externos', () => {
    expect(htmlAssetRefs(INDEX)).toEqual(['favicon.svg', 'assets/index-AAA.js', 'assets/index-BBB.css']);
  });

  it('saca de un JS o CSS los assets que nombra, también los relativos a su carpeta', () => {
    const js =
      'import("./chunk-CCC.js");const u=new URL("assets/logo-DDD.svg",import.meta.url);"assets/chunk-CCC.js";import("./sin-extension")';
    expect(bundleAssetRefs(js, 'assets/index-AAA.js').sort()).toEqual(['assets/chunk-CCC.js', 'assets/logo-DDD.svg']);
  });

  it('ignora rutas que se salen de la carpeta', () => {
    expect(htmlAssetRefs('<script src="./../otra/x.js"></script><script src="/abs.js"></script>')).toEqual([]);
  });
});

describe('Manifest de la PWA (#58)', () => {
  it('saca los íconos relativos del manifest, sin los externos', () => {
    const manifest = JSON.stringify({
      name: 'POS',
      icons: [{ src: 'icon-192.png' }, { src: './icon-512.png' }, { src: 'https://cdn.example.com/x.png' }],
    });
    expect(manifestAssetRefs(manifest, 'manifest.webmanifest')).toEqual(['icon-192.png', 'icon-512.png']);
  });

  it('un manifest sin íconos no nombra nada', () => {
    expect(manifestAssetRefs('{"name":"POS"}', 'manifest.webmanifest')).toEqual([]);
  });
});

function fakeFetch(files: Record<string, string>): { fetch: FetchLike; requested: string[] } {
  const requested: string[] = [];
  const fetch: FetchLike = (url) => {
    requested.push(url);
    const body = files[url];
    return Promise.resolve(
      body === undefined ? new Response('no', { status: 404 }) : new Response(body, { status: 200 }),
    );
  };
  return { fetch, requested };
}

const PUBLISHED = {
  [`${BASE}version.json`]: JSON.stringify({ version: '0.3.1', contract: '4.5.0', minBackendContract: '4.0.0' }),
  [`${BASE}index.html`]: INDEX,
  [`${BASE}favicon.svg`]: '<svg/>',
  [`${BASE}assets/index-AAA.js`]: 'import("./x");"assets/chunk-CCC.js"',
  [`${BASE}assets/chunk-CCC.js`]: 'export const c = 1;',
  [`${BASE}assets/index-BBB.css`]: 'body{}',
};

describe('mirrorPos (#9)', () => {
  let dir = '';
  afterEach(() => {
    if (dir !== '') rmSync(dir, { recursive: true, force: true });
    dir = '';
  });

  it('baja la versión publicada entera, siguiendo los chunks', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const { fetch } = fakeFetch(PUBLISHED);
    const result = await mirrorPos({ channel: 'v4', destDir: dir, fetch });

    expect(result.version).toBe('0.3.1');
    expect(result.files.sort()).toEqual(
      ['assets/chunk-CCC.js', 'assets/index-AAA.js', 'assets/index-BBB.css', 'favicon.svg', 'index.html', 'version.json'],
    );
    expect(readFileSync(join(dir, 'v4', 'assets', 'chunk-CCC.js'), 'utf-8')).toBe('export const c = 1;');
    expect(isPosMirrored(dir, 'v4')).toBe(true);
    expect(isPosMirrored(dir, 'v5')).toBe(false);
  });

  it('si falta un archivo no deja una copia a medias', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const incompleto = Object.fromEntries(
      Object.entries(PUBLISHED).filter(([url]) => url !== `${BASE}assets/chunk-CCC.js`),
    );
    const { fetch } = fakeFetch(incompleto);

    await expect(mirrorPos({ channel: 'v4', destDir: dir, fetch })).rejects.toThrow(/chunk-CCC\.js.*404/);
    expect(existsSync(join(dir, 'v4'))).toBe(false);
    expect(isPosMirrored(dir, 'v4')).toBe(false);
  });

  it('rechaza un version.json de otro major', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const { fetch } = fakeFetch({
      ...PUBLISHED,
      [`${BASE}version.json`]: JSON.stringify({ version: '1.0.0', contract: '5.0.0', minBackendContract: '5.0.0' }),
    });
    await expect(mirrorPos({ channel: 'v4', destDir: dir, fetch })).rejects.toThrow(/5\.0\.0/);
  });

  it('baja el manifest y sus íconos, pero nunca el service worker (#58)', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const { fetch, requested } = fakeFetch({
      ...PUBLISHED,
      [`${BASE}index.html`]: INDEX.replace('</head>', '<link rel="manifest" href="./manifest.webmanifest" /></head>'),
      [`${BASE}manifest.webmanifest`]: JSON.stringify({ icons: [{ src: 'icon-192.png' }] }),
      [`${BASE}icon-192.png`]: 'png',
      [`${BASE}assets/index-AAA.js`]: 'register("./sw.js");"assets/chunk-CCC.js"',
      [`${BASE}sw.js`]: 'self.addEventListener("install", () => {});',
    });
    const { files } = await mirrorPos({ channel: 'v4', destDir: dir, fetch });

    expect(files).toContain('manifest.webmanifest');
    expect(files).toContain('icon-192.png');
    expect(files).not.toContain('sw.js');
    expect(requested.filter((url) => url.endsWith('sw.js'))).toEqual([]);
    expect(existsSync(join(dir, 'v4', 'sw.js'))).toBe(false);
  });

  it('una segunda bajada reemplaza la anterior', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    await mirrorPos({ channel: 'v4', destDir: dir, fetch: fakeFetch(PUBLISHED).fetch });
    const cambiado = { ...PUBLISHED, [`${BASE}favicon.svg`]: '<svg id="nuevo"/>' };
    await mirrorPos({ channel: 'v4', destDir: dir, fetch: fakeFetch(cambiado).fetch });
    expect(readFileSync(join(dir, 'v4', 'favicon.svg'), 'utf-8')).toBe('<svg id="nuevo"/>');
  });
});
