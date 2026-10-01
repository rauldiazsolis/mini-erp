import contract from '../../../contract.json' with { type: 'json' };

/** La versión publicada del POS contra la que se probó el mini-erp (la mueve `pnpm contract:update`). */
export const POS_VERSION: string = contract.posVersion;

export const DEFAULT_POS_ORIGIN = 'https://offline-pos.pages.dev';

/**
 * Origen del POS publicado (#11): `VITE_POS_URL` al compilar, que el deploy toma de la variable
 * `POS_URL` del environment `production` de GitHub. Vacía o inválida, el POS publicado de siempre.
 */
export function publishedPosOrigin(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  return /^https?:\/\/[^/\s]+/.test(value) && URL.canParse(value) ? value.replace(/\/+$/, '') : DEFAULT_POS_ORIGIN;
}

/**
 * Dónde está el POS: en desarrollo, la copia local que sirve el mini-erp en `/pos/<versión>/` (mismo
 * origen, sin permiso de red local); en producción, el POS publicado en `posOrigin`.
 */
export function posBaseUrl(posVersion: string, origin: string, useLocalCopy: boolean, posOrigin: string): string {
  return useLocalCopy ? `${origin}/pos/${posVersion}/` : `${posOrigin}/${posVersion}/`;
}

/** Link de "Probar la demo": el POS en demo contra el Connector API de este mini-erp. */
export function buildDemoUrl(posBase: string, origin: string): string {
  const url = new URL(posBase);
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', `${origin}/connector`);
  return url.toString();
}
