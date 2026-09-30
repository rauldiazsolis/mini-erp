import contract from '../../../contract.json' with { type: 'json' };

/** La versión publicada del POS contra la que se probó el mini-erp (la mueve `pnpm contract:update`). */
export const POS_VERSION: string = contract.posVersion;

export const PUBLISHED_POS_ORIGIN = 'https://offline-pos.pages.dev';

/**
 * Dónde está el POS: en desarrollo, la copia local que sirve el mini-erp en `/pos/<versión>/` (mismo
 * origen, sin permiso de red local); en producción, el POS publicado.
 */
export function posBaseUrl(posVersion: string, origin: string, useLocalCopy: boolean): string {
  return useLocalCopy ? `${origin}/pos/${posVersion}/` : `${PUBLISHED_POS_ORIGIN}/${posVersion}/`;
}

/** Link de "Probar la demo": el POS en demo contra el Connector API de este mini-erp. */
export function buildDemoUrl(posBase: string, origin: string): string {
  const url = new URL(posBase);
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', `${origin}/connector`);
  return url.toString();
}
