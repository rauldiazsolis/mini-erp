import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { formatDate, formatDateTime, formatMoneyRounded, formatQty } from '../src/client/format.ts';

// Intl separa con espacios duros (U+00A0, U+202F): los tests comparan con espacios comunes.
const SPACES = /\s/g;

describe('format.ts: formatos según el navegador (#51)', () => {
  it('formatMoneyRounded redondea a pesos enteros, en ARS', () => {
    expect(formatMoneyRounded(45800.6, 'es-AR').replace(SPACES, ' ')).toBe('$ 45.801');
    expect(formatMoneyRounded(45800.6, 'en-US').replace(SPACES, ' ')).toBe('ARS 45,801');
  });

  it('formatDate muestra solo la fecha de un instante, en la zona del navegador', () => {
    expect(formatDate('2026-10-04T15:00:00.000Z', 'es-AR')).toBe('4/10/26');
    expect(formatDate('2026-10-04T15:00:00.000Z', 'en-US')).toBe('10/4/26');
  });

  it('formatDateTime sigue la preferencia de 12 o 24 horas del locale, sin fijarla', () => {
    expect(formatDateTime('2026-10-04T15:00:00.000Z', 'en-US').replace(SPACES, ' ')).toMatch(/^10\/4\/26, \d{1,2}:00 [AP]M$/);
    expect(formatDateTime('2026-10-04T15:00:00.000Z', 'es-AR-u-hc-h23')).toMatch(/^4\/10\/26, \d{2}:00$/);
  });

  it('formatQty separa miles según el locale', () => {
    expect(formatQty(1250, 'es-AR')).toBe('1.250');
    expect(formatQty(1250, 'en-US')).toBe('1,250');
  });
});

function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return clientFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['Intl', /\bIntl\./],
  ['toLocale*String', /\.toLocale(?:Date|Time)?String\(/],
  ['hourCycle', /\bhourCycle\b/],
  ['hour12', /\bhour12\b/],
  ['locale fijo', /['"`][a-z]{2,3}-[A-Z]{2}['"`]/],
];

describe('Nada formatea por su cuenta en el cliente (#51)', () => {
  it('fuera de src/client/format.ts no hay Intl, toLocale*String, hourCycle ni locales fijos', () => {
    const offenders = clientFiles('src/client')
      .filter((file) => relative('src/client', file).split(sep).join('/') !== 'format.ts')
      .flatMap((file) => {
        const source = readFileSync(file, 'utf-8');
        return FORBIDDEN.filter(([, re]) => re.test(source)).map(([what]) => `${file}: ${what}`);
      });
    expect(offenders).toEqual([]);
  });
});
