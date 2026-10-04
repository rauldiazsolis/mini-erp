import { resolve } from 'node:path';
import { DEFAULT_POS_MIRROR_DIR, mirrorPos } from '../src/server/pos-mirror/mirror.ts';
import { POS_CHANNEL } from '../src/shared/contract-version.ts';

/**
 * pnpm pos:mirror [canal]
 * Baja el canal del POS publicado (por defecto el del contrato implementado, hoy v4) a
 * vendor/pos/<canal>/, la copia local que `pnpm dev` sirve en /pos/<canal>/. Reemplaza la copia
 * anterior si la había.
 */
const root = resolve(import.meta.dirname, '..');

const channel = process.argv[2] ?? POS_CHANNEL;
const destDir = resolve(root, DEFAULT_POS_MIRROR_DIR);
const { version, files } = await mirrorPos({ channel, destDir });
console.log(`POS ${version} (canal ${channel}): ${String(files.length)} archivos en ${DEFAULT_POS_MIRROR_DIR}/${channel}/`);
