import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { appVersionDefine } from '../vite.config.ts';
import { resolveAppVersion, versionLabel } from '../src/client/state/app-version.ts';
import { devLoginDefaults } from '../src/client/state/dev-login.ts';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

describe('Marca mini contax (#18)', () => {
  it('Vite inyecta la versión de package.json', () => {
    expect(appVersionDefine['import.meta.env.VITE_APP_VERSION']).toBe(JSON.stringify(pkg.version));
  });

  it('la versión cae en "dev" si no se inyectó', () => {
    expect(resolveAppVersion('0.1.0')).toBe('0.1.0');
    expect(resolveAppVersion(undefined)).toBe('dev');
    expect(resolveAppVersion('  ')).toBe('dev');
  });

  it('la etiqueta dice mini contax y la versión', () => {
    expect(versionLabel('0.1.0')).toBe('mini contax v0.1.0');
    expect(versionLabel('dev')).toBe('mini contax (desarrollo)');
  });

  it('index.html tiene el título y el favicon', () => {
    const html = readFileSync('src/client/index.html', 'utf-8');
    expect(html).toContain('<title>mini contax</title>');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(readFileSync('src/client/public/favicon.svg', 'utf-8')).toContain('<svg');
  });
});

describe('Login sin datos de desarrollo en producción (#18)', () => {
  it('precarga el admin del seed solo en desarrollo', () => {
    expect(devLoginDefaults(true)).toEqual({ email: 'admin@local.test', password: 'admin123' });
    expect(devLoginDefaults(false)).toEqual({ email: '', password: '' });
  });
});

function clientUiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return clientUiFiles(path);
    return path.endsWith('.tsx') || path.endsWith('.html') ? [path] : [];
  });
}

const FORBIDDEN: RegExp[] = [/mini-erp/i, /\bExpress\b/, /Multitenant/i, /Connector v\d/, /Puerto: \d/, /\bTPV\b/];

describe('Sin la marca vieja en la UI (#18)', () => {
  it.each(clientUiFiles('src/client'))('%s', (file) => {
    const source = readFileSync(file, 'utf-8');
    for (const pattern of FORBIDDEN) {
      expect(source, `${file} contiene ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});
