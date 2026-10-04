import { existsSync } from 'node:fs';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { channelBaseUrl, parseVersionJson } from '../../../scripts/contract-source.ts';
import { bundleAssetRefs, htmlAssetRefs } from './pos-assets.ts';

/**
 * Copia local del POS publicado (#9, #58): el canal del major del contrato
 * (`https://pos.contax.ar/v4/`), byte por byte, para servirlo en desarrollo desde el mismo origen que
 * el mini-erp. Siempre del canal publicado, nunca de main de offline-pos.
 */
export type FetchLike = (url: string) => Promise<Response>;

export const DEFAULT_POS_MIRROR_DIR = 'vendor/pos';

export function isPosMirrored(destDir: string, channel: string): boolean {
  return existsSync(join(destDir, channel, 'index.html')) && existsSync(join(destDir, channel, 'version.json'));
}

async function download(fetch: FetchLike, url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (res.status !== 200) {
    throw new Error(`${url} respondió ${String(res.status)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * Baja el canal entero a `<destDir>/<canal>/` y devuelve qué versión del POS tenía y sus archivos.
 * Arma todo en una carpeta temporal y la mueve al final: si algo falla, no queda una copia a medias.
 */
export async function mirrorPos(params: {
  channel: string;
  destDir: string;
  fetch?: FetchLike | undefined;
}): Promise<{ version: string; files: string[] }> {
  const fetch = params.fetch ?? ((url: string) => globalThis.fetch(url));
  const base = channelBaseUrl(params.channel);
  const files = new Map<string, Buffer>();

  const versionJson = await download(fetch, `${base}version.json`);
  const published = parseVersionJson(JSON.parse(versionJson.toString('utf-8')), params.channel);
  files.set('version.json', versionJson);

  const index = await download(fetch, `${base}index.html`);
  files.set('index.html', index);

  const pending = htmlAssetRefs(index.toString('utf-8'));
  while (pending.length > 0) {
    const ref = pending.shift();
    if (ref === undefined || files.has(ref)) continue;
    const body = await download(fetch, `${base}${ref}`);
    files.set(ref, body);
    if (/\.(?:m?js|css)$/.test(ref)) {
      pending.push(...bundleAssetRefs(body.toString('utf-8'), ref));
    }
  }

  const finalDir = join(params.destDir, params.channel);
  const tempDir = `${finalDir}.tmp-${String(process.pid)}-${String(Date.now())}`;
  try {
    for (const [ref, body] of files) {
      const path = join(tempDir, ref);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, body);
    }
    await rm(finalDir, { recursive: true, force: true });
    await rename(tempDir, finalDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
  return { version: published.version, files: [...files.keys()] };
}
