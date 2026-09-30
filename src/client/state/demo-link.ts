import contract from '../../../contract.json' with { type: 'json' };

/** La versión publicada del POS contra la que se probó el mini-erp (la mueve `pnpm contract:update`). */
export const POS_VERSION: string = contract.posVersion;

/** Link de "Probar la demo": el POS publicado, en demo contra el Connector API de este mini-erp. */
export function buildDemoUrl(posVersion: string, origin: string): string {
  const url = new URL(`https://offline-pos.pages.dev/${posVersion}/`);
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', `${origin}/connector`);
  return url.toString();
}
