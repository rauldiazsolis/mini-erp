/** Versión de mini que se muestra en el pie del menú y del login (#18). */
export function resolveAppVersion(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  return value === '' ? 'dev' : value;
}

export const APP_VERSION: string = resolveAppVersion(import.meta.env.VITE_APP_VERSION);

export function versionLabel(version: string = APP_VERSION): string {
  return version === 'dev' ? 'mini contax (desarrollo)' : `mini contax v${version}`;
}
