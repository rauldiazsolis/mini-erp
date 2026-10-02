import { describe, it, expect } from 'vitest';
import { checkReleaseVersion, planReleaseTag } from '../scripts/release-version.ts';

describe('Guardia de versión del deploy (#40)', () => {
  it('un tag que coincide con package.json despliega esa versión', () => {
    expect(checkReleaseVersion({ refType: 'tag', refName: 'v0.2.1', packageVersion: '0.2.1' })).toEqual({
      ok: true,
      version: '0.2.1',
    });
  });

  it('un tag distinto de package.json frena el deploy y dice qué hacer', () => {
    const result = checkReleaseVersion({ refType: 'tag', refName: 'v0.3.0', packageVersion: '0.2.1' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(/v0\.3\.0.*0\.2\.1/);
    expect(result.ok ? '' : result.error).toContain('pnpm version');
  });

  it.each(['0.2.1', 'v0.2', 'v0.2.1-rc.1', 'release-1'])('rechaza el tag %j por su forma', (refName) => {
    expect(checkReleaseVersion({ refType: 'tag', refName, packageVersion: '0.2.1' }).ok).toBe(false);
  });

  it('el deploy manual (desde una rama) despliega la versión de package.json', () => {
    expect(checkReleaseVersion({ refType: 'branch', refName: 'main', packageVersion: '0.2.1' })).toEqual({
      ok: true,
      version: '0.2.1',
    });
  });

  it('rechaza un package.json sin versión X.Y.Z', () => {
    expect(checkReleaseVersion({ refType: 'branch', refName: 'main', packageVersion: '' }).ok).toBe(false);
    expect(checkReleaseVersion({ refType: 'tag', refName: 'v1.0.0', packageVersion: '1.0' }).ok).toBe(false);
  });
});

describe('pnpm release:tag (#49)', () => {
  const listo = {
    branch: 'main',
    dirty: false,
    head: 'abc123',
    originMain: 'abc123',
    packageVersion: '0.4.0',
    localTagExists: false,
    remoteTagExists: false,
  };

  it('con main limpio y al día, crea el tag de package.json', () => {
    expect(planReleaseTag(listo)).toEqual({ ok: true, tag: 'v0.4.0' });
  });

  it('frena fuera de main', () => {
    const result = planReleaseTag({ ...listo, branch: 'claude/algo' });
    expect(result.ok ? '' : result.error).toMatch(/claude\/algo.*main/);
  });

  it('frena con cambios sin commitear', () => {
    const result = planReleaseTag({ ...listo, dirty: true });
    expect(result.ok ? '' : result.error).toContain('cambios sin commitear');
  });

  it('frena si main no está igual que origin/main', () => {
    const result = planReleaseTag({ ...listo, originMain: 'def456' });
    expect(result.ok ? '' : result.error).toContain('git pull');
  });

  it('frena con una versión inválida en package.json', () => {
    const result = planReleaseTag({ ...listo, packageVersion: '0.4' });
    expect(result.ok ? '' : result.error).toContain('X.Y.Z');
  });

  it('frena si el tag ya existe, local o en origin, y dice qué hacer', () => {
    for (const existe of [{ localTagExists: true }, { remoteTagExists: true }]) {
      const result = planReleaseTag({ ...listo, ...existe });
      expect(result.ok ? '' : result.error).toMatch(/v0\.4\.0 ya existe.*pnpm version/s);
    }
  });
});
