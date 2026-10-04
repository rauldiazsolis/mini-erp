import { createHash } from 'node:crypto';
import { normalizeHeader, parseAmount, parseCsv, parseDay } from '../io/csv.ts';

/** Una fila de la planilla: válida (con su referencia idempotente) o con su error. */
export type SheetRow = { line: number; day?: string; slug?: string; amount?: number; info: string; ref?: string; error?: string };

const REQUIRED = ['fecha', 'comercio', 'importe'] as const;
const AMOUNT_ERROR = 'El importe tiene que ser mayor que 0';

/**
 * La planilla de cobranzas (#21): fecha, comercio (su identificador), importe e info. Detecta `;` o
 * `,` (parser común, #22). Cada fila válida lleva una referencia (sha256 de la fila normalizada) que
 * hace idempotente la carga.
 */
export function parsePaymentSheet(csv: string): SheetRow[] {
  const table = parseCsv(csv);
  const cols = table.headers.map(normalizeHeader);
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length > 0) return [{ line: 1, info: '', error: `Faltan columnas: ${missing.join(', ')}` }];
  const cell = (cells: string[], name: string): string => cells[cols.indexOf(name)] ?? '';

  return table.rows.map(({ line, cells }): SheetRow => {
    const info = cols.includes('info') ? cell(cells, 'info') : '';
    const day = parseDay(cell(cells, 'fecha'));
    if (day === undefined) return { line, info, error: 'Fecha inválida' };
    const slug = cell(cells, 'comercio').toLowerCase();
    if (slug === '') return { line, info, error: 'Falta el comercio' };
    const amount = parseAmount(cell(cells, 'importe'));
    if (amount === undefined || amount <= 0) return { line, info, error: AMOUNT_ERROR };
    const ref = createHash('sha256').update(`${day}|${slug}|${amount.toFixed(2)}|${info}`).digest('hex');
    return { line, day, slug, amount, info, ref };
  });
}
