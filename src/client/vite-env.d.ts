/** Variables de Vite que lee el cliente al compilar. */
interface ImportMetaEnv {
  /** Origen del POS publicado (#11); lo pone el deploy desde la variable `POS_URL` de GitHub. */
  readonly VITE_POS_URL?: string;
  /** Versión de mini (la de package.json), la inyecta `vite.config.ts` al compilar (#18). */
  readonly VITE_APP_VERSION?: string;
}
