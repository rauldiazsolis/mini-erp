import { createHash } from 'node:crypto';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';

/** Una fila de la planilla: válida (con su referencia idempotente) o con su error. */
export type SheetRow = { line: number; day?: string; slug?: string; amount?: number; info: string; ref?: string; error?: string };

const REQUIRED = ['fecha', 'comercio', 'importe'] as const;
const AMOUNT_ERROR = 'El importe tiene que ser mayor que 0';

/** Una línea CSV con comillas dobles (`""` escapa una comilla). */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quoted) {
      if (ch === '"' && line.charAt(i + 1) === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

const normalizeHeader = (h: string): string =>
  h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

/** `DD/MM/AAAA` o `AAAA-MM-DD`, y que la fecha exista. */
function parseDay(raw: string): string | undefined {
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = dmy === null ? raw : `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`;
  if (!DAY_PATTERN.test(iso)) return undefined;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** `12.345,50` (coma decimal), `1.234.567` (puntos de miles) o `12345.50`; con o sin `$`. */
function parseAmount(raw: string): number | undefined {
  const clean = raw.replace(/[$\s]/g, '');
  let normalized = clean;
  if (clean.includes(',')) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if ((clean.match(/\./g) ?? []).length > 1) {
    normalized = clean.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  return Math.round(Number(normalized) * 100) / 100;
}

/**
 * La planilla de cobranzas (#21): fecha, comercio (su identificador), importe e info. Detecta `;` o
 * `,`. Cada fila válida lleva una referencia (sha256 de la fila normalizada) que hace idempotente la carga.
 */
export function parsePaymentSheet(csv: string): SheetRow[] {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = lines[0] ?? '';
  const sep = header.includes(';') ? ';' : ',';
  const cols = splitLine(header, sep).map(normalizeHeader);
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length > 0) return [{ line: 1, info: '', error: `Faltan columnas: ${missing.join(', ')}` }];
  const cell = (cells: string[], name: string): string => cells[cols.indexOf(name)] ?? '';

  const rows: SheetRow[] = [];
  lines.slice(1).forEach((text, index) => {
    if (text.trim() === '') return;
    const line = index + 2;
    const cells = splitLine(text, sep);
    const info = cols.includes('info') ? cell(cells, 'info') : '';
    const day = parseDay(cell(cells, 'fecha'));
    if (day === undefined) {
      rows.push({ line, info, error: 'Fecha inválida' });
      return;
    }
    const slug = cell(cells, 'comercio').toLowerCase();
    if (slug === '') {
      rows.push({ line, info, error: 'Falta el comercio' });
      return;
    }
    const amount = parseAmount(cell(cells, 'importe'));
    if (amount === undefined || amount <= 0) {
      rows.push({ line, info, error: AMOUNT_ERROR });
      return;
    }
    const ref = createHash('sha256').update(`${day}|${slug}|${amount.toFixed(2)}|${info}`).digest('hex');
    rows.push({ line, day, slug, amount, info, ref });
  });
  return rows;
}
