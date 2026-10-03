import { describe, it, expect } from 'vitest';
import { parsePaymentSheet } from '../src/server/billing/payment-sheet.ts';

describe('planilla de cobranzas (#21)', () => {
  it('con punto y coma, coma decimal, fecha DD/MM/AAAA y comillas', () => {
    const csv = 'Fecha;Comercio;Importe;Info\r\n05/10/2026;kiosco;12.345,50;"Transf; op 1"\r\n';
    const [row] = parsePaymentSheet(csv);
    expect(row).toMatchObject({ line: 2, day: '2026-10-05', slug: 'kiosco', amount: 12345.5, info: 'Transf; op 1' });
    expect(row?.ref).toMatch(/^[0-9a-f]{64}$/);
  });

  it('con coma, fecha ISO y un BOM al principio', () => {
    const [row] = parsePaymentSheet('\uFEFFfecha,comercio,importe,info\n2026-10-05,kiosco,5000,op 2\n');
    expect(row).toMatchObject({ day: '2026-10-05', amount: 5000, info: 'op 2' });
  });

  it('con importes con signo pesos y miles con punto', () => {
    const rows = parsePaymentSheet('fecha;comercio;importe\n05/10/2026;kiosco;$ 1.234.567\n05/10/2026;kiosco;1500.75\n');
    expect(rows.map((r) => r.amount)).toEqual([1234567, 1500.75]);
  });

  it('la misma fila normalizada da la misma referencia', () => {
    const a = parsePaymentSheet('fecha;comercio;importe;info\n05/10/2026;Kiosco ;5.000,00; op 3\n')[0];
    const b = parsePaymentSheet('fecha,comercio,importe,info\n2026-10-05,kiosco,5000,op 3\n')[0];
    expect(a?.ref).toBe(b?.ref);
  });

  it('errores por fila: fecha, importe y comercio', () => {
    const rows = parsePaymentSheet('fecha;comercio;importe\n31/02/2026;kiosco;100\n05/10/2026;kiosco;0\n05/10/2026;;100\n05/10/2026;kiosco;abc\n');
    expect(rows.map((r) => r.error)).toEqual(['Fecha inválida', 'El importe tiene que ser mayor que 0', 'Falta el comercio', 'El importe tiene que ser mayor que 0']);
  });

  it('sin las columnas obligatorias, un error en la línea 1', () => {
    expect(parsePaymentSheet('fecha;importe\n05/10/2026;100\n')).toEqual([{ line: 1, info: '', error: 'Faltan columnas: comercio' }]);
  });

  it('ignora las líneas vacías', () => {
    expect(parsePaymentSheet('fecha;comercio;importe\n\n05/10/2026;kiosco;100\n\n')).toHaveLength(1);
  });
});
