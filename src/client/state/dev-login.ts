/**
 * Las credenciales del seed de desarrollo (`src/server/seeds/dev-fixtures.ts`). Detrás de
 * `import.meta.env.DEV` para que el build de producción las elimine y no viajen al navegador.
 */
const DEV_ADMIN = import.meta.env.DEV ? { email: 'root@local.test', password: 'admin123' } : null;

/** Lo que precarga el login: el root del seed en desarrollo, nada en producción (#18). */
export function devLoginDefaults(isDev: boolean): { email: string; password: string } {
  return isDev && DEV_ADMIN !== null ? { ...DEV_ADMIN } : { email: '', password: '' };
}
