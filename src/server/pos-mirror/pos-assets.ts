import { posix } from 'node:path';
import { z } from 'zod';

/**
 * Qué archivos forman una versión publicada del POS (#9), leyendo su `index.html` y sus bundles.
 * Las rutas quedan relativas a la carpeta de la versión (`assets/index-x.js`) y nunca se salen de
 * ella.
 */

const ASSET_EXT = 'js|mjs|css|svg|png|jpg|jpeg|webp|ico|woff2?|ttf|wasm|json';

function normalize(ref: string, fromDir: string): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref) || ref.startsWith('/') || ref.startsWith('#')) {
    return undefined;
  }
  const clean = posix.normalize(posix.join(fromDir, ref.split(/[?#]/)[0] ?? ''));
  if (clean === '.' || clean.startsWith('..') || posix.isAbsolute(clean)) {
    return undefined;
  }
  return clean;
}

function unique(refs: (string | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const ref of refs) {
    if (ref !== undefined) seen.add(ref);
  }
  return [...seen];
}

/** Los `src` y `href` relativos del `index.html` (los externos quedan afuera). */
export function htmlAssetRefs(html: string): string[] {
  const refs = [...html.matchAll(/\s(?:src|href)=["']([^"']+)["']/g)].map((m) => m[1]);
  return unique(refs.map((ref) => (ref === undefined ? undefined : normalize(ref, '.'))));
}

/**
 * Los assets que nombra un JS o CSS: los `assets/...` (lista de precarga de Vite) y los relativos a
 * su carpeta (`import("./chunk.js")`, `url(./fuente.woff2)`).
 */
export function bundleAssetRefs(text: string, filePath: string): string[] {
  const fromDir = posix.dirname(filePath);
  const rooted = [...text.matchAll(new RegExp(`assets/[A-Za-z0-9._-]+\\.(?:${ASSET_EXT})\\b`, 'g'))].map((m) =>
    normalize(m[0], '.'),
  );
  const relative = [
    ...text.matchAll(new RegExp(`["'(]\\./([A-Za-z0-9._-]+\\.(?:${ASSET_EXT}))["')]`, 'g')),
  ].map((m) => (m[1] === undefined ? undefined : normalize(m[1], fromDir)));
  return unique([...rooted, ...relative]);
}

const manifestSchema = z
  .object({ icons: z.array(z.object({ src: z.string() }).passthrough()).optional() })
  .passthrough();

/** Los íconos que nombra el manifest de la PWA (`icons[].src`), relativos a su carpeta (#58). */
export function manifestAssetRefs(text: string, filePath: string): string[] {
  const raw: unknown = JSON.parse(text);
  const parsed = manifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${filePath} no es un manifest válido`);
  }
  const fromDir = posix.dirname(filePath);
  return unique((parsed.data.icons ?? []).map((icon) => normalize(icon.src, fromDir)));
}
