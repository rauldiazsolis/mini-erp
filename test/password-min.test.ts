import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe('mínimo de contraseña en un solo lugar (#19, #44)', () => {
  it('ningún texto sobre la contraseña escribe el mínimo a mano: sale de PASSWORD_MIN_LENGTH', () => {
    const offending = [...files('src'), ...files('scripts')].flatMap((file) =>
      readFileSync(file, 'utf-8')
        .split('\n')
        .map((line, i) => ({ file, line: i + 1, text: line }))
        .filter(({ text }) => /contraseña/i.test(text) && /\b\d+ caracteres/.test(text)),
    );
    expect(offending.map(({ file, line }) => `${file}:${String(line)}`)).toEqual([]);
  });
});
