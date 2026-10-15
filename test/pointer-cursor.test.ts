import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/client/index.css', 'utf8');

describe('Cursor de mano en los controles (#86)', () => {
  // Tailwind v4 ya no pone `cursor: pointer` en los botones: lo pone una regla base, no cada control.
  it('index.css pone la mano en botones, desplegables, casillas y archivos', () => {
    const rule = /@layer base\s*{[^}]*{\s*cursor:\s*pointer;?\s*}/.exec(css)?.[0] ?? '';
    for (const selector of ['button:not(:disabled)', '[role="button"]', 'select', 'summary', 'label:has(input)', 'input[type="checkbox"]', 'input[type="radio"]', '::file-selector-button']) {
      expect(rule, selector).toContain(selector);
    }
  });

  it('los deshabilitados muestran que no se pueden usar', () => {
    expect(css).toMatch(/:disabled[^{]*{\s*cursor:\s*not-allowed/);
  });
});
