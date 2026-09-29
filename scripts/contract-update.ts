import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  contractBaseUrl,
  contractJson,
  openApiInfoVersion,
  parseVersionJson,
} from './contract-source.ts';

/**
 * pnpm contract:update <versión del POS publicada>
 * Baja el OpenAPI de esa carpeta publicada y deja su procedencia en contract.json. No escribe nada
 * si algo no coincide.
 */
const root = resolve(import.meta.dirname, '..');
const openApiPath = resolve(root, 'docs/connector-api.openapi.yaml');
const contractJsonPath = resolve(root, 'contract.json');

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (res.status !== 200) throw new Error(`${url} respondió ${String(res.status)}`);
  return res.text();
}

async function previousContract(): Promise<string> {
  try {
    const raw: unknown = JSON.parse(await readFile(contractJsonPath, 'utf8'));
    return typeof raw === 'object' &&
      raw !== null &&
      'contract' in raw &&
      typeof raw.contract === 'string'
      ? raw.contract
      : '(ninguno)';
  } catch {
    return '(ninguno)';
  }
}

const posVersion = process.argv[2] ?? '';
const base = contractBaseUrl(posVersion);
const published = parseVersionJson(JSON.parse(await fetchText(`${base}version.json`)), posVersion);
const yaml = await fetchText(`${base}docs/connector-api.openapi.yaml`);
const infoVersion = openApiInfoVersion(yaml);
if (infoVersion !== published.contract) {
  throw new Error(
    `El OpenAPI publicado dice ${String(infoVersion)} y version.json dice ${published.contract}`,
  );
}

const before = await previousContract();
await writeFile(openApiPath, yaml);
await writeFile(contractJsonPath, `${JSON.stringify(contractJson(published), null, 2)}\n`);
console.log(`Contrato: ${before} → ${published.contract} (POS ${published.version}, ${base})`);
