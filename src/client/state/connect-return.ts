/** La conexión que el alta le devuelve al POS (contrato 4.4.0, "Vuelta del onboarding"). */
export type PosConnection = {
  baseUrl: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  wipeKey?: string | undefined;
};

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * `<return_url>#connect=<base64url de JSON>`: la conexión va siempre en el fragmento (el navegador
 * no se lo manda al servidor del POS), nunca en la query. `wipeKey` va solo si vino, sin modificar.
 * Devuelve `undefined` si `return_url` no es una URL `http:` o `https:`.
 */
export function buildConnectReturnUrl(returnUrl: string, connection: PosConnection): string | undefined {
  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  const { baseUrl, apiKey, branch, pointOfSale, wipeKey } = connection;
  const payload = {
    baseUrl,
    apiKey,
    branch,
    pointOfSale,
    ...(wipeKey === undefined || wipeKey === '' ? {} : { wipeKey }),
  };
  url.hash = `connect=${toBase64Url(JSON.stringify(payload))}`;
  return url.toString();
}
