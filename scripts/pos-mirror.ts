import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { DEFAULT_POS_MIRROR_DIR, mirrorPos } from '../src/server/pos-mirror/mirror.ts';

/**
 * pnpm pos:mirror [versión del POS publicada]
 * Baja esa versión del POS publicado (por defecto la de contract.json) a vendor/pos/<versión>/, la
 * copia local que `pnpm dev` sirve en /pos/<versión>/. Reemplaza la copia anterior si la había.
 */
const root = resolve(import.meta.dirname, '..');

async function contractPosVersion(): Promise<string> {
  const raw: unknown = JSON.parse(await readFile(resolve(root, 'contract.json'), 'utf8'));
  if (typeof raw === 'object' && raw !== null && 'posVersion' in raw && typeof raw.posVersion === 'string') {
    return raw.posVersion;
  }
  throw new Error('contract.json no tiene posVersion');
}

const version = process.argv[2] ?? (await contractPosVersion());
const destDir = resolve(root, DEFAULT_POS_MIRROR_DIR);
const files = await mirrorPos({ version, destDir });
console.log(`POS ${version}: ${String(files.length)} archivos en ${DEFAULT_POS_MIRROR_DIR}/${version}/`);
