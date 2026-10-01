/**
 * Las credenciales del seed de desarrollo (`src/server/db/dev-seed.ts`). Detrás de
 * `import.meta.env.DEV` para que el build de producción las elimine y no viajen al navegador.
 */
const DEV_ADMIN = import.meta.env.DEV ? { email: 'admin@local.test', password: 'admin123' } : null;

/** Lo que precarga el login: el admin del seed en desarrollo, nada en producción (#18). */
export function devLoginDefaults(isDev: boolean): { email: string; password: string } {
  return isDev && DEV_ADMIN !== null ? { ...DEV_ADMIN } : { email: '', password: '' };
}
