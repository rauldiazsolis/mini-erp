/** Carpeta de las bases de SQLite de los comercios (`tenants/`): `DATA_DIR` o `data`. El e2e usa una propia. */
export function dataDir(): string {
  const dir = process.env['DATA_DIR']?.trim() ?? '';
  return dir === '' ? 'data' : dir;
}
