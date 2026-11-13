import { describe, it, expect } from 'vitest';
import { moneyAmount } from '../src/shared/money.ts';

const errorOf = (value: unknown): string | undefined => {
  const parsed = moneyAmount.safeParse(value);
  return parsed.success ? undefined : parsed.error.issues[0]?.message;
};

describe('importes de dinero de sistema (spec PostgreSQL, punto 2)', () => {
  it('admite hasta 2 decimales', () => {
    expect(moneyAmount.parse(10.15)).toBe(10.15);
    expect(moneyAmount.parse(0.1)).toBe(0.1);
    expect(moneyAmount.parse(5000)).toBe(5000);
    expect(moneyAmount.parse(999_999_999_999.99)).toBe(999_999_999_999.99);
  });

  it('con más de 2 decimales no redondea: "Importe inválido"', () => {
    expect(errorOf(10.155)).toBe('Importe inválido');
    expect(errorOf(0.001)).toBe('Importe inválido');
    expect(errorOf(1e-7)).toBe('Importe inválido');
  });

  it('cero o negativo: "El importe tiene que ser mayor que 0"', () => {
    expect(errorOf(0)).toBe('El importe tiene que ser mayor que 0');
    expect(errorOf(-5)).toBe('El importe tiene que ser mayor que 0');
  });

  it('lo que no es un número o no entra en numeric(14,2) es inválido', () => {
    expect(errorOf('10')).toBe('Importe inválido');
    expect(errorOf(Number.NaN)).toBe('Importe inválido');
    expect(errorOf(Number.POSITIVE_INFINITY)).toBe('Importe inválido');
    expect(errorOf(1_000_000_000_000)).toBe('Importe inválido');
  });
});
