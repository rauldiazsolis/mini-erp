import { resolve } from 'node:path';
import { DEFAULT_POS_MIRROR_DIR, contractPosVersion, mirrorPos } from '../src/server/pos-mirror/mirror.ts';

/**
 * pnpm pos:mirror [versión del POS publicada]
 * Baja esa versión del POS publicado (por defecto la de contract.json) a vendor/pos/<versión>/, la
 * copia local que `pnpm dev` sirve en /pos/<versión>/. Reemplaza la copia anterior si la había.
 */
const root = resolve(import.meta.dirname, '..');

const version = process.argv[2] ?? (await contractPosVersion(resolve(root, 'contract.json')));
const destDir = resolve(root, DEFAULT_POS_MIRROR_DIR);
const files = await mirrorPos({ version, destDir });
console.log(`POS ${version}: ${String(files.length)} archivos en ${DEFAULT_POS_MIRROR_DIR}/${version}/`);
