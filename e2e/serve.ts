import { rmSync } from 'node:fs';
import { dataDir } from '../src/server/db/data-dir.ts';

/**
 * Servidor del e2e: arranca siempre de una base vacía (la de `DATA_DIR`, nunca la de desarrollo) y
 * levanta el mini-erp en modo desarrollo, que sirve la copia local del POS.
 */
const dir = dataDir();
if (dir === 'data') {
  throw new Error('El e2e necesita su propia DATA_DIR: no borro la base de desarrollo');
}
rmSync(dir, { recursive: true, force: true });
await import('../src/server/server.ts');
