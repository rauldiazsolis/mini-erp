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

export type ReleaseTagPlan = { ok: true; tag: string } | { ok: false; error: string };

/**
 * `pnpm release:tag` (#49): el tag sale de package.json y solo desde un `main` limpio, igual que
 * `origin/main`, con un tag que todavía no existe.
 */
export function planReleaseTag(state: {
  branch: string;
  dirty: boolean;
  head: string;
  originMain: string;
  packageVersion: string;
  localTagExists: boolean;
  remoteTagExists: boolean;
}): ReleaseTagPlan {
  if (state.branch !== 'main') {
    return { ok: false, error: `Estás en ${state.branch}: el tag se crea desde main (git checkout main && git pull).` };
  }
  if (state.dirty) {
    return { ok: false, error: 'Hay cambios sin commitear: el tag tiene que salir de main tal cual está en GitHub.' };
  }
  if (state.head !== state.originMain) {
    return { ok: false, error: 'main no está igual que origin/main: corré git pull (o revisá si hay commits sin subir).' };
  }
  if (!SEMVER.test(state.packageVersion)) {
    return { ok: false, error: `package.json tiene una versión inválida (${JSON.stringify(state.packageVersion)}): tiene que ser X.Y.Z.` };
  }
  const tag = `v${state.packageVersion}`;
  if (state.localTagExists || state.remoteTagExists) {
    return {
      ok: false,
      error:
        `El tag ${tag} ya existe${state.remoteTagExists ? ' en GitHub' : ' en tu copia local'}. Para publicar otra ` +
        `versión, subila en un PR (pnpm version minor|patch --no-git-tag-version) y, después del merge, volvé a correr esto.`,
    };
  }
  return { ok: true, tag };
}
