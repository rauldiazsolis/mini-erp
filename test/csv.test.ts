import { describe, it, expect } from 'vitest';
import { normalizeDocument, normalizeHeader, parseAmount, parseBool, parseCsv, parseDay } from '../src/server/io/csv.ts';

describe('parser CSV común (#22)', () => {
  it('detecta el punto y coma de Excel y saca el BOM', () => {
    const t = parseCsv('\uFEFFDescripción;P. Venta\r\nYerba 1kg;3.500,50\r\n');
    expect(t.separator).toBe(';');
    expect(t.headers).toEqual(['Descripción', 'P. Venta']);
    expect(t.rows).toEqual([{ line: 2, cells: ['Yerba 1kg', '3.500,50'] }]);
  });

  it('detecta la coma y la tabulación', () => {
    expect(parseCsv('a,b\n1,2\n').separator).toBe(',');
    expect(parseCsv('a\tb\n1\t2\n').separator).toBe('\t');
  });

  it('un separador entre comillas en el encabezado no cuenta', () => {
    expect(parseCsv('"nombre, completo";saldo\nAna;10\n').separator).toBe(';');
  });

  it('respeta comillas, comillas escapadas y saltos de línea dentro de una celda', () => {
    const t = parseCsv('nombre;nota\n"Pérez; Juan";"dice ""hola""\nen dos líneas"\nAna;x\n');
    expect(t.rows).toEqual([
      { line: 2, cells: ['Pérez; Juan', 'dice "hola"\nen dos líneas'] },
      { line: 4, cells: ['Ana', 'x'] },
    ]);
  });

  it('saltea filas vacías (también las de solo separadores) y conserva el número de línea', () => {
    const t = parseCsv('a;b\n\n1;2\n;\n3;4');
    expect(t.rows.map((r) => r.line)).toEqual([3, 5]);
  });

  it('archivo vacío o solo con encabezado', () => {
    expect(parseCsv('')).toEqual({ separator: ',', headers: [], rows: [] });
    expect(parseCsv('a;b\n').rows).toEqual([]);
  });

  it('montos: coma decimal, puntos de miles, signo pesos y negativos', () => {
    expect(parseAmount('$ 12.345,50')).toBe(12345.5);
    expect(parseAmount('1.234.567')).toBe(1234567);
    expect(parseAmount('12345.50')).toBe(12345.5);
    expect(parseAmount('-1.500,25')).toBe(-1500.25);
    expect(parseAmount('1.200')).toBe(1.2);
    expect(parseAmount('1.200', 'comma')).toBe(1200);
    expect(parseAmount('10,5', 'comma')).toBe(10.5);
    expect(parseAmount('abc')).toBeUndefined();
    expect(parseAmount('')).toBeUndefined();
  });

  it('fechas DD/MM/AAAA o ISO, y que existan', () => {
    expect(parseDay('5/10/2026')).toBe('2026-10-05');
    expect(parseDay('2026-10-05')).toBe('2026-10-05');
    expect(parseDay('31/02/2026')).toBeUndefined();
  });

  it('booleanos en castellano', () => {
    expect(['Sí', 'si', 'S', 'x', '1', 'true', 'VERDADERO'].map((v) => parseBool(v))).toEqual(Array<boolean>(7).fill(true));
    expect(['No', 'n', '0', 'false', 'Falso'].map((v) => parseBool(v))).toEqual(Array<boolean>(5).fill(false));
    expect(parseBool('quizás')).toBeUndefined();
  });

  it('encabezados y documentos normalizados', () => {
    expect(normalizeHeader('  Cód. Barras ')).toBe('cod barras');
    expect(normalizeHeader('Límite_de-Crédito')).toBe('limite de credito');
    expect(normalizeDocument('20.123.456')).toBe('20123456');
    expect(normalizeDocument('20-12345678-9')).toBe('20123456789');
  });
});
