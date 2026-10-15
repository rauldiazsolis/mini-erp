import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src/client';
const files = readdirSync(ROOT, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.tsx'))
  .map((f) => f.replaceAll('\\', '/'));
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8');

describe('Formularios y tarjetas en el teléfono (#91)', () => {
  it('los campos usan 16 px en el teléfono, así Safari no agranda la página al enfocarlos', () => {
    const css = read('index.css');
    // Fuera de @layer: si no, las utilidades (text-xs, text-sm) le ganan
    const unlayered = css.replace(/@layer[^{]*{(?:[^{}]|{[^{}]*})*}/g, '');
    expect(unlayered).toMatch(/@media \(max-width: 639px\)\s*{[^}]*input[^}]*select[^}]*textarea[^}]*{\s*font-size: 16px;?\s*}/);
  });

  it('cada campo numérico pide el teclado numérico (inputMode)', () => {
    const offenders = files.filter((f) => {
      const src = read(f);
      const numbers = src.match(/type="number"/g)?.length ?? 0;
      const modes = src.match(/inputMode="(decimal|numeric)"/g)?.length ?? 0;
      return numbers > modes;
    });
    expect(offenders).toEqual([]);
  });

  it('las tarjetas de números van de a dos por renglón en el teléfono', () => {
    for (const f of ['components/dashboard/KpiCards.tsx', 'components/credits/CreditsStats.tsx', 'components/customers/CustomerStatsBar.tsx']) {
      expect(read(f), f).toContain('grid grid-cols-2 ');
    }
  });
});
