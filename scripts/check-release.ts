import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkReleaseVersion } from './release-version.ts';

/**
 * node scripts/check-release.ts (en deploy.yml, #40)
 * Frena el deploy si el tag no coincide con package.json y deja la versión esperada en
 * `GITHUB_OUTPUT` (`version=X.Y.Z`) para el chequeo público.
 */
const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, '../package.json'), 'utf-8')) as { version?: unknown };
const result = checkReleaseVersion({
  refType: process.env['GITHUB_REF_TYPE'] ?? '',
  refName: process.env['GITHUB_REF_NAME'] ?? '',
  packageVersion: typeof pkg.version === 'string' ? pkg.version : '',
});

if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}

console.log(`Versión a desplegar: ${result.version}`);
const output = process.env['GITHUB_OUTPUT'];
if (output !== undefined && output !== '') {
  appendFileSync(output, `version=${result.version}\n`);
}
