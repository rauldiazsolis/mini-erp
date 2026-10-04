import { POS_CHANNEL } from '../../shared/contract-version.ts';

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
 * Dónde está el POS (#58): el canal del contrato implementado (`/v4/`), sin fijar una versión. En
 * desarrollo, la copia local que sirve el mini-erp en `/pos/<canal>/` (mismo origen, sin permiso de
 * red local); en producción, el POS publicado en `posOrigin`.
 */
export function posBaseUrl(origin: string, useLocalCopy: boolean, posOrigin: string, channel = POS_CHANNEL): string {
  return useLocalCopy ? `${origin}/pos/${channel}/` : `${posOrigin}/${channel}/`;
}

/** Link de "Probar la demo": el POS en demo contra el Connector API de este mini-erp. */
export function buildDemoUrl(posBase: string, origin: string): string {
  const url = new URL(posBase);
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', `${origin}/connector`);
  return url.toString();
}
