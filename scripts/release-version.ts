/** Guardia de versión del deploy (#40): la versión publicada es siempre la de package.json. */
export type ReleaseCheck = { ok: true; version: string } | { ok: false; error: string };

const SEMVER = /^\d+\.\d+\.\d+$/;

/**
 * Qué versión despliega una corrida de `deploy.yml`. Por tag, el tag tiene que ser `v` + la versión de
 * package.json; a mano (desde una rama), la de package.json.
 */
export function checkReleaseVersion(input: { refType: string; refName: string; packageVersion: string }): ReleaseCheck {
  const { refType, refName, packageVersion } = input;
  if (!SEMVER.test(packageVersion)) {
    return { ok: false, error: `package.json tiene una versión inválida (${JSON.stringify(packageVersion)}): tiene que ser X.Y.Z.` };
  }
  if (refType !== 'tag') {
    return { ok: true, version: packageVersion };
  }
  const match = /^v(\d+\.\d+\.\d+)$/.exec(refName);
  if (match === null) {
    return { ok: false, error: `El tag ${refName} no tiene la forma vX.Y.Z.` };
  }
  if (match[1] !== packageVersion) {
    return {
      ok: false,
      error:
        `El tag ${refName} no coincide con package.json (${packageVersion}). Subí la versión en un PR ` +
        `(pnpm version minor|patch --no-git-tag-version) y, después del merge, creá el tag desde package.json.`,
    };
  }
  return { ok: true, version: packageVersion };
}
