import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import { channelBaseUrl, parseVersionJson } from '../../../scripts/contract-source.ts';
import { bundleAssetRefs, htmlAssetRefs, manifestAssetRefs } from './pos-assets.ts';

/**
 * Copia local del POS publicado (#9, #58): el canal del major del contrato
 * (`https://pos.contax.ar/v4/`), byte por byte, para servirlo en desarrollo desde el mismo origen que
 * el mini-erp. Siempre del canal publicado, nunca de main de offline-pos.
 */
export type FetchLike = (url: string) => Promise<Response>;

export const DEFAULT_POS_MIRROR_DIR = 'vendor/pos';

/**
 * El service worker no se espeja (#58): sin él, el POS corre en desarrollo sin modo offline y una copia
 * renovada se ve con solo recargar. La parte PWA se prueba contra el POS publicado. Se compara el
 * nombre del archivo: un bundle que lo nombra lo resuelve relativo a su propia carpeta.
 */
const SERVICE_WORKER = 'sw.js';

export function isPosMirrored(destDir: string, channel: string): boolean {
  return existsSync(join(destDir, channel, 'index.html')) && existsSync(join(destDir, channel, 'version.json'));
}

/** Qué versión del POS tiene la copia local del canal; `undefined` si no hay copia o no se lee. */
export async function mirroredPosVersion(destDir: string, channel: string): Promise<string | undefined> {
  try {
    const raw: unknown = JSON.parse(await readFile(join(destDir, channel, 'version.json'), 'utf8'));
    return typeof raw === 'object' && raw !== null && 'version' in raw && typeof raw.version === 'string'
      ? raw.version
      : undefined;
  } catch {
    return undefined;
  }
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
    if (ref === undefined || posix.basename(ref) === SERVICE_WORKER || files.has(ref)) continue;
    const body = await download(fetch, `${base}${ref}`);
    files.set(ref, body);
    if (/\.(?:m?js|css)$/.test(ref)) {
      pending.push(...bundleAssetRefs(body.toString('utf-8'), ref));
    } else if (ref.endsWith('.webmanifest')) {
      pending.push(...manifestAssetRefs(body.toString('utf-8'), ref));
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
