import { DAY_PATTERN } from '../../shared/argentina-day.ts';

export type CsvSeparator = ';' | ',' | '\t';
export type CsvTable = { separator: CsvSeparator; headers: string[]; rows: { line: number; cells: string[] }[] };
export type DecimalMode = 'auto' | 'comma';

const SEPARATORS: readonly CsvSeparator[] = [';', ',', '\t'];

/** El separador que más aparece fuera de comillas en la primera línea; a igual cantidad, `;` > `,` > tab. */
function detectSeparator(text: string): CsvSeparator {
  const counts: Record<CsvSeparator, number> = { ';': 0, ',': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && (ch === ';' || ch === ',' || ch === '\t')) counts[ch]++;
  }
  let best: CsvSeparator = ',';
  let max = 0;
  for (const sep of SEPARATORS) {
    if (counts[sep] > max) {
      best = sep;
      max = counts[sep];
    }
  }
  return best;
}

/**
 * CSV de cualquier origen (#22): BOM, separador detectado, comillas dobles (`""` escapa), celdas con
 * saltos de línea, `\r\n`. Saltea filas vacías; `line` es la línea del archivo donde empieza la fila.
 */
export function parseCsv(input: string): CsvTable {
  const text = input.replace(/^\uFEFF/, '');
  const separator = detectSeparator(text);
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cur = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRecord = (): void => {
    cells.push(cur.trim());
    records.push({ line: start, cells });
    cells = [];
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === '"' && text.charAt(i + 1) === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        if (ch === '\n') line++;
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === separator) {
      cells.push(cur.trim());
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++;
      endRecord();
      line++;
      start = line;
    } else {
      cur += ch;
    }
  }
  if (cur !== '' || cells.length > 0) endRecord();
  const [header, ...rows] = records.filter((r) => r.cells.some((c) => c !== ''));
  return { separator, headers: header?.cells ?? [], rows };
}

/** Minúsculas, sin tildes ni puntuación, espacios simples: para comparar encabezados y nombres. */
export function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Un documento sin puntos, guiones ni espacios: `20.123.456` y `20123456` son el mismo. */
export function normalizeDocument(raw: string): string {
  return raw.replace(/[\s.-]/g, '');
}

/** `DD/MM/AAAA` o `AAAA-MM-DD`, y que la fecha exista. */
export function parseDay(raw: string): string | undefined {
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = dmy === null ? raw : `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`;
  if (!DAY_PATTERN.test(iso)) return undefined;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/**
 * `12.345,50` (coma decimal), `1.234.567` (puntos de miles) o `12345.50`; con o sin `$`; redondea a
 * centavos. Con `'comma'` (un archivo con `;`, el Excel argentino) el punto es siempre de miles:
 * `1.200` es 1200. Con `'auto'`, un solo punto es decimal.
 */
export function parseAmount(raw: string, decimal: DecimalMode = 'auto'): number | undefined {
  const clean = raw.replace(/[$\s]/g, '');
  let normalized = clean;
  if (clean.includes(',') || decimal === 'comma') {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  } else if ((clean.match(/\./g) ?? []).length > 1) {
    normalized = clean.replace(/\./g, '');
  }
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return undefined;
  return Math.round(Number(normalized) * 100) / 100;
}

const TRUE_WORDS = new Set(['si', 's', 'x', '1', 'true', 'verdadero', 'yes']);
const FALSE_WORDS = new Set(['no', 'n', '0', 'false', 'falso']);

/** Sí/no en castellano (o `1`/`0`, `true`/`false`); `undefined` si no es ninguno. */
export function parseBool(raw: string): boolean | undefined {
  const v = normalizeHeader(raw);
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined;
}
