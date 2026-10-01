import { describe, it, expect } from 'vitest';
import { checkReleaseVersion } from '../scripts/release-version.ts';

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
