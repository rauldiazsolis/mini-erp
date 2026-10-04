# M6 · Importación con mapeo y carga inicial en el alta — plan de implementación

> **Para quien ejecuta:** en este repo el plan se ejecuta con `superpowers:executing-plans`, **tarea por
> tarea en la misma conversación**, frenando al terminar cada una para que el usuario la revise (nunca
> un subagente por tarea; AGENTS.md, "Cómo trabajamos"). Los pasos usan casillas (`- [ ]`).

**Objetivo:** importar CSV de cualquier origen con mapeo de columnas, sugerencias y vista previa
(clientes con saldo inicial por el libro; productos y stock por sucursal), y sumar al alta el WhatsApp,
el rubro y el paso "Cargá tus datos".

**Arquitectura:** el servidor parsea, sugiere el mapeo y valida, sin estado: cada vista previa y la
confirmación reenvían el CSV. La importación corre dentro de un `SAVEPOINT` (deshecho en la vista
previa, liberado al confirmar). Los saldos pasan por `applyToBalance` con el tipo nuevo `opening`; el
stock, por una función extraída de `StockService.adjustStock`. El alta guarda WhatsApp y rubro
(migración de sistema v6) y crea el comercio vacío.

**Stack:** Node 24 (strip de tipos), Express, `node:sqlite`, Zod 3, Preact + `@preact/signals`,
Tailwind v4, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-03-m6-importacion-design.md`](../specs/2026-10-03-m6-importacion-design.md)

## Restricciones globales

- Todo en español: código visible, comentarios, mensajes y commits (`feat:`, `test:`, `refactor:`…).
- TDD: el test falla primero. Una tarea termina con `pnpm lint && pnpm typecheck && pnpm test` en verde
  (en PowerShell); más `pnpm build` si toca el cliente y `pnpm test:e2e` si toca el alta.
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores; `unknown` solo en fronteras y
  validado con Zod. Opcionales de entrada `x?: T | undefined`.
- Node sin compilar: imports relativos con `.ts`/`.tsx`, sin parameter properties ni `enum`.
- Cliente: solo signals, sin hooks (`preact/hooks` prohibido por el lint).
- Cambios de esquema solo con migración (`src/server/db/migrations/system/v6-…`).
- Cada ruta nueva de `/api/tenants/:tenantId` lleva `requirePermission` y va en la tabla de
  `test/permissions-api.test.ts`.
- Rama `claude/m6-importacion`. Un commit por tarea, al final de la tarea, con
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Responsabilidad |
| --- | --- |
| `src/server/io/csv.ts` (nuevo) | Parser CSV y helpers (`parseAmount`, `parseDay`, `parseBool`, `normalizeHeader`, `normalizeDocument`) |
| `src/server/billing/payment-sheet.ts` | Pasa a usar `csv.ts` |
| `src/shared/import-fields.ts` (nuevo) | Campos por entidad, etiquetas, tipos de la API de importación |
| `src/server/io/suggest-mapping.ts` (nuevo) | Sinónimos y mapeo sugerido |
| `src/server/stock/write-stock.ts` (nuevo) | Fijar o sumar stock con su movimiento de kardex (extraído de `StockService`) |
| `src/server/io/import-customers.ts` (nuevo) | Filas de clientes: reconocimiento, campos, saldo inicial |
| `src/server/io/import-products.ts` (nuevo) | Filas de productos: reconocimiento, SKU, campos, stock |
| `src/server/io/import-service.ts` (nuevo) | Orquesta: parsea, mapea, valida el mapeo, corre en `SAVEPOINT` |
| `src/server/io/import-export-service.ts` | Se le borra la importación vieja; suma `countProducts` |
| `src/server/routes/io-routes.ts` | `POST /import/:entity` nuevo y `GET`/`POST /catalog/example` |
| `src/shared/business-type.ts` (nuevo) | Rubros, etiquetas y `hasExampleCatalog` |
| `src/shared/whatsapp.ts` (nuevo) | `normalizeWhatsapp` |
| `src/server/db/migrations/system/v6-alta-whatsapp-rubro.ts` (nuevo) | `users.whatsapp`, `tenants.business_type` |
| `src/server/alta/alta-service.ts`, `routes/alta-routes.ts` | `businessType` y `whatsapp`; comercio vacío |
| `src/client/state/import-state.ts` (nuevo) | Store del asistente |
| `src/client/components/import/*.tsx` (nuevo) | `ImportWizard` y sus pasos |
| `src/client/state/merchant-onboarding-state.ts`, `MerchantOnboardingView.tsx` | Pasos del alta y "Cargá tus datos" |
| `src/client/state/onboarding-state.ts`, `shell/OnboardingModal.tsx` | `businessType` en "Crear nuevo comercio" |

---

### Tarea 1: Parser CSV común

**Archivos:**
- Crear: `src/server/io/csv.ts`
- Modificar: `src/server/billing/payment-sheet.ts`
- Test: `test/csv.test.ts` (nuevo); `test/payment-sheet.test.ts` sin cambios

**Interfaces:**
- Produce:
  - `type CsvSeparator = ';' | ',' | '\t'`
  - `type CsvTable = { separator: CsvSeparator; headers: string[]; rows: { line: number; cells: string[] }[] }`
  - `parseCsv(input: string): CsvTable`
  - `type DecimalMode = 'auto' | 'comma'`
  - `parseAmount(raw: string, decimal?: DecimalMode): number | undefined` — con `'comma'` (archivos
    con `;`, el Excel argentino) el punto es siempre de miles: `1.200` = 1200. Con `'auto'` (el de
    siempre, el de la planilla de cobranzas) un solo punto es decimal.
  - `parseDay(raw: string): string | undefined`
  - `parseBool(raw: string): boolean | undefined`
  - `normalizeHeader(raw: string): string`
  - `normalizeDocument(raw: string): string`

- [ ] **Paso 1: tests del parser**

```ts
// test/csv.test.ts
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
    expect(['Sí', 'si', 'S', 'x', '1', 'true', 'VERDADERO'].map(parseBool)).toEqual(Array(7).fill(true));
    expect(['No', 'n', '0', 'false', 'Falso'].map(parseBool)).toEqual(Array(5).fill(false));
    expect(parseBool('quizás')).toBeUndefined();
  });

  it('encabezados y documentos normalizados', () => {
    expect(normalizeHeader('  Cód. Barras ')).toBe('cod barras');
    expect(normalizeHeader('Límite_de-Crédito')).toBe('limite de credito');
    expect(normalizeDocument('20.123.456')).toBe('20123456');
    expect(normalizeDocument('20-12345678-9')).toBe('20123456789');
  });
});
```

- [ ] **Paso 2: correr y ver que falla**

Run: `pnpm vitest run test/csv.test.ts` — Esperado: FAIL (no existe `csv.ts`).

- [ ] **Paso 3: implementar `src/server/io/csv.ts`**

```ts
import { DAY_PATTERN } from '../../shared/argentina-day.ts';

export type CsvSeparator = ';' | ',' | '\t';
export type CsvTable = { separator: CsvSeparator; headers: string[]; rows: { line: number; cells: string[] }[] };

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
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Un documento sin puntos, guiones ni espacios: `20.123.456` y `20123456` son el mismo. */
export function normalizeDocument(raw: string): string {
  return raw.replace(/[\s.\-]/g, '');
}

/** `DD/MM/AAAA` o `AAAA-MM-DD`, y que la fecha exista. */
export function parseDay(raw: string): string | undefined {
  const dmy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  const iso = dmy === null ? raw : `${dmy[3] ?? ''}-${(dmy[2] ?? '').padStart(2, '0')}-${(dmy[1] ?? '').padStart(2, '0')}`;
  if (!DAY_PATTERN.test(iso)) return undefined;
  const date = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

/** `12.345,50` (coma decimal), `1.234.567` (puntos de miles) o `12345.50`; con o sin `$`; redondea a centavos. */
export type DecimalMode = 'auto' | 'comma';

/** Con `'comma'` el punto es siempre de miles (`1.200` = 1200); con `'auto'`, un solo punto es decimal. */
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

export function parseBool(raw: string): boolean | undefined {
  const v = normalizeHeader(raw);
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  return undefined;
}
```

- [ ] **Paso 4: `payment-sheet.ts` usa el parser común**

Borrar de `payment-sheet.ts` `splitLine`, `normalizeHeader`, `parseDay` y `parseAmount` locales, y
reescribir `parsePaymentSheet` sobre `parseCsv` (mismo resultado, mismos mensajes):

```ts
import { createHash } from 'node:crypto';
import { normalizeHeader, parseAmount, parseCsv, parseDay } from '../io/csv.ts';

// SheetRow, REQUIRED y AMOUNT_ERROR quedan como están

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
```

Nota: el test "ignora las líneas vacías" sigue pasando (`parseCsv` las saltea). El separador ahora
se detecta por cantidad, no por "contiene `;`": un encabezado `fecha;comercio;importe` sigue dando `;`.

- [ ] **Paso 5: correr los tests**

Run: `pnpm vitest run test/csv.test.ts test/payment-sheet.test.ts test/platform-api.test.ts` — Esperado: PASS.

- [ ] **Paso 6: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add src/server/io/csv.ts src/server/billing/payment-sheet.ts test/csv.test.ts
git commit -m "refactor: parser CSV común con separador detectado, comillas y coma decimal (#22)"
```

---

### Tarea 2: Campos de importación y mapeo sugerido

**Archivos:**
- Crear: `src/shared/import-fields.ts`, `src/server/io/suggest-mapping.ts`
- Test: `test/import-mapping.test.ts` (nuevo)

**Interfaces:**
- Consume: `normalizeHeader` (tarea 1).
- Produce (en `src/shared/import-fields.ts`):

```ts
export type ImportEntity = 'customers' | 'products';
export type CustomerField = 'id' | 'name' | 'document' | 'phone' | 'creditLimit' | 'margin' | 'balance' | 'unrestricted' | 'blockedReason';
export type ProductField = 'sku' | 'barcodes' | 'name' | 'price' | 'taxRate' | 'category' | 'tracksStock';
/** Stock de una sucursal (`stock:<branchId>`) o de una sucursal todavía sin elegir (`stock:?`). */
export type StockField = `stock:${string}`;
export type ImportField = CustomerField | ProductField | StockField;
export const STOCK_UNASSIGNED: StockField = 'stock:?';
export type ImportMapping = Record<string, ImportField | null>; // índice de columna (string) → campo
export type ImportBranch = { id: string; name: string; code: string };
export type ImportRowAction = 'create' | 'update' | 'unchanged' | 'error';
export type ImportRowResult = { line: number; key: string; action: ImportRowAction; messages: string[] };
export type ImportPreview = {
  entity: ImportEntity;
  separator: ';' | ',' | '\t';
  columns: { index: number; header: string; samples: string[] }[];
  mapping: ImportMapping;
  branches: ImportBranch[];
  missing: ImportField[];
  needsBranch: number[];
  rows: ImportRowResult[];
  totals: Record<ImportRowAction, number>;
  dryRun: boolean;
};
export const CUSTOMER_FIELDS: readonly { field: CustomerField; label: string }[];
export const PRODUCT_FIELDS: readonly { field: ProductField; label: string }[];
export function stockField(branchId: string): StockField;
export function stockBranchOf(field: ImportField): string | undefined; // 'stock:?' → '?'
export function fieldLabel(field: ImportField, branches: readonly ImportBranch[]): string;
```

- Produce (en `src/server/io/suggest-mapping.ts`):
  `suggestMapping(entity: ImportEntity, headers: readonly string[], branches: readonly ImportBranch[]): ImportMapping`

- [ ] **Paso 1: tests**

```ts
// test/import-mapping.test.ts
import { describe, it, expect } from 'vitest';
import { suggestMapping } from '../src/server/io/suggest-mapping.ts';
import { fieldLabel, stockBranchOf, stockField, STOCK_UNASSIGNED } from '../src/shared/import-fields.ts';

const central = { id: 'branch-central', name: 'Central', code: 'CENTRAL' };
const norte = { id: 'branch-norte', name: 'Norte', code: 'NORTE' };

describe('mapeo sugerido (#22)', () => {
  it('productos de un Excel en castellano', () => {
    const headers = ['Descripción', 'P. Venta', 'Cód. Barras', 'Código', 'Rubro', 'Stock Central', 'Observaciones'];
    expect(suggestMapping('products', headers, [central, norte])).toEqual({
      '0': 'name', '1': 'price', '2': 'barcodes', '3': 'sku', '4': 'category', '5': 'stock:branch-central', '6': null,
    });
  });

  it('clientes de un Excel en castellano', () => {
    const headers = ['Razón Social', 'DNI', 'Celular', 'Deuda', 'Límite'];
    expect(suggestMapping('customers', headers, [central])).toEqual({
      '0': 'name', '1': 'document', '2': 'phone', '3': 'balance', '4': 'creditLimit',
    });
  });

  it('el export de mini (en inglés) se reconoce', () => {
    const headers = ['id', 'name', 'document', 'phone', 'creditLimit', 'margin', 'balance', 'unrestricted', 'blockedReason'];
    expect(Object.values(suggestMapping('customers', headers, [central]))).toEqual(headers);
  });

  it('nunca el mismo campo en dos columnas: gana la coincidencia exacta y, a igual calidad, la primera', () => {
    expect(suggestMapping('products', ['Nombre del producto', 'Nombre', 'Precio', 'Precio venta'], [central])).toEqual({
      '0': null, '1': 'name', '2': 'price', '3': null,
    });
  });

  it('stock genérico: a la única sucursal o sin elegir si hay varias', () => {
    expect(suggestMapping('products', ['Nombre', 'Stock'], [central])['1']).toBe('stock:branch-central');
    expect(suggestMapping('products', ['Nombre', 'Cantidad'], [central, norte])['1']).toBe(STOCK_UNASSIGNED);
  });

  it('una columna por sucursal, por nombre o por código', () => {
    expect(suggestMapping('products', ['Nombre', 'Stock Central', 'NORTE'], [central, norte])).toEqual({
      '0': 'name', '1': 'stock:branch-central', '2': 'stock:branch-norte',
    });
  });

  it('etiquetas', () => {
    expect(stockField('branch-norte')).toBe('stock:branch-norte');
    expect(stockBranchOf('stock:branch-norte')).toBe('branch-norte');
    expect(stockBranchOf('name')).toBeUndefined();
    expect(fieldLabel('stock:branch-norte', [central, norte])).toBe('Stock · Norte');
    expect(fieldLabel(STOCK_UNASSIGNED, [central, norte])).toBe('Stock · ¿qué sucursal?');
    expect(fieldLabel('creditLimit', [])).toBe('Límite de crédito');
  });
});
```

- [ ] **Paso 2: correr y ver que falla**

Run: `pnpm vitest run test/import-mapping.test.ts` — Esperado: FAIL (no existen los módulos).

- [ ] **Paso 3: `src/shared/import-fields.ts`**

Los tipos de la sección "Interfaces" y además:

```ts
export const STOCK_UNASSIGNED: StockField = 'stock:?';

export const CUSTOMER_FIELDS: readonly { field: CustomerField; label: string }[] = [
  { field: 'id', label: 'Id (de mini)' },
  { field: 'name', label: 'Nombre' },
  { field: 'document', label: 'Documento' },
  { field: 'phone', label: 'Teléfono' },
  { field: 'creditLimit', label: 'Límite de crédito' },
  { field: 'margin', label: 'Margen' },
  { field: 'balance', label: 'Saldo' },
  { field: 'unrestricted', label: 'Sin restricción' },
  { field: 'blockedReason', label: 'Motivo de bloqueo' },
];

export const PRODUCT_FIELDS: readonly { field: ProductField; label: string }[] = [
  { field: 'sku', label: 'SKU' },
  { field: 'barcodes', label: 'Código de barras' },
  { field: 'name', label: 'Nombre' },
  { field: 'price', label: 'Precio' },
  { field: 'taxRate', label: 'IVA' },
  { field: 'category', label: 'Categoría' },
  { field: 'tracksStock', label: 'Controla stock' },
];

export function stockField(branchId: string): StockField {
  return `stock:${branchId}`;
}

export function stockBranchOf(field: ImportField): string | undefined {
  return field.startsWith('stock:') ? field.slice('stock:'.length) : undefined;
}

export function fieldLabel(field: ImportField, branches: readonly ImportBranch[]): string {
  const branchId = stockBranchOf(field);
  if (branchId !== undefined) {
    if (field === STOCK_UNASSIGNED) return 'Stock · ¿qué sucursal?';
    return `Stock · ${branches.find((b) => b.id === branchId)?.name ?? branchId}`;
  }
  return [...CUSTOMER_FIELDS, ...PRODUCT_FIELDS].find((f) => f.field === field)?.label ?? field;
}
```

- [ ] **Paso 4: `src/server/io/suggest-mapping.ts`**

```ts
import { normalizeHeader } from './csv.ts';
import {
  CUSTOMER_FIELDS, PRODUCT_FIELDS, STOCK_UNASSIGNED, stockField,
  type CustomerField, type ImportBranch, type ImportEntity, type ImportField, type ImportMapping, type ProductField,
} from '../../shared/import-fields.ts';

/** Sinónimos ya normalizados (`normalizeHeader`), incluidos los nombres del export de mini. */
const CUSTOMER_SYNONYMS: Record<CustomerField, readonly string[]> = {
  id: ['id', 'id mini'],
  name: ['nombre', 'name', 'cliente', 'razon social', 'nombre y apellido', 'apellido y nombre'],
  document: ['document', 'documento', 'dni', 'cuit', 'cuil', 'nro doc', 'doc', 'nro documento'],
  phone: ['phone', 'telefono', 'tel', 'celular', 'cel', 'whatsapp', 'movil'],
  creditLimit: ['creditlimit', 'limite', 'limite de credito', 'limite credito', 'tope'],
  margin: ['margin', 'margen'],
  balance: ['balance', 'saldo', 'deuda', 'debe', 'saldo cc', 'cuenta corriente', 'saldo cuenta corriente'],
  unrestricted: ['unrestricted', 'sin restriccion', 'sin limite'],
  blockedReason: ['blockedreason', 'motivo de bloqueo', 'bloqueo', 'bloqueado'],
};

const PRODUCT_SYNONYMS: Record<ProductField, readonly string[]> = {
  sku: ['sku', 'codigo', 'cod', 'codigo interno', 'cod interno', 'art'],
  barcodes: ['barcodes', 'barcode', 'codigo de barras', 'cod barras', 'cod de barras', 'ean', 'barras'],
  name: ['nombre', 'name', 'descripcion', 'producto', 'articulo', 'detalle'],
  price: ['price', 'precio', 'precio venta', 'p venta', 'pvp', 'precio final', 'precio de venta'],
  taxRate: ['taxrate', 'iva', 'alicuota', 'alicuota iva'],
  category: ['category', 'categoria', 'rubro', 'familia', 'seccion'],
  tracksStock: ['tracksstock', 'controla stock', 'maneja stock'],
};

const STOCK_WORDS = ['stock', 'cantidad', 'cant', 'existencia', 'existencias', 'inventario'];

/** 2 = igual a un sinónimo; 1 = lo contiene como palabras enteras; 0 = nada. */
function score(header: string, synonyms: readonly string[]): number {
  if (synonyms.includes(header)) return 2;
  return synonyms.some((s) => ` ${header} `.includes(` ${s} `)) ? 1 : 0;
}

function stockCandidate(header: string, branches: readonly ImportBranch[]): { field: ImportField; score: number } | undefined {
  for (const b of branches) {
    const names = [normalizeHeader(b.name), normalizeHeader(b.code)].filter((n) => n.length >= 3);
    if (names.some((n) => header === n || score(header, [n]) > 0)) return { field: stockField(b.id), score: 2 };
  }
  if (score(header, STOCK_WORDS) === 0) return undefined;
  const only = branches.length === 1 ? branches[0] : undefined;
  return { field: only === undefined ? STOCK_UNASSIGNED : stockField(only.id), score: 2 };
}

/**
 * El mapeo sugerido (#22): cada columna a su mejor campo, sin repetir campos (salvo el stock sin
 * sucursal). Gana la coincidencia más exacta y, a igual calidad, la primera columna.
 */
/** Pares campo → sinónimos, tipados, recorriendo las listas de campos (sin `Object.entries`, que pierde el tipo). */
function synonymsFor(entity: ImportEntity): { field: ImportField; list: readonly string[] }[] {
  return entity === 'customers'
    ? CUSTOMER_FIELDS.map(({ field }) => ({ field, list: CUSTOMER_SYNONYMS[field] }))
    : PRODUCT_FIELDS.map(({ field }) => ({ field, list: PRODUCT_SYNONYMS[field] }));
}

export function suggestMapping(entity: ImportEntity, headers: readonly string[], branches: readonly ImportBranch[]): ImportMapping {
  const candidates: { column: number; field: ImportField; score: number }[] = [];
  headers.forEach((raw, column) => {
    const header = normalizeHeader(raw);
    if (header === '') return;
    for (const { field, list } of synonymsFor(entity)) {
      const s = score(header, list);
      if (s > 0) candidates.push({ column, field, score: s });
    }
    if (entity === 'products') {
      const stock = stockCandidate(header, branches);
      if (stock !== undefined) candidates.push({ column, ...stock });
    }
  });
  candidates.sort((a, b) => b.score - a.score || a.column - b.column);

  const mapping: ImportMapping = Object.fromEntries(headers.map((_h, i) => [String(i), null]));
  const taken = new Set<ImportField>();
  for (const c of candidates) {
    if (mapping[String(c.column)] !== null) continue;
    if (taken.has(c.field) && c.field !== STOCK_UNASSIGNED) continue;
    mapping[String(c.column)] = c.field;
    taken.add(c.field);
  }
  return mapping;
}
```

Revisar con el test "Stock Central": `stockCandidate` da `stock:branch-central` (score 2) y `name` no
compite. "Cód. Barras" → `cod barras`: `barcodes` 2 y `sku` 1 (por "cod"); gana `barcodes`. "Código" →
`codigo`: `sku` 2. "Rubro" → `category` 2.

- [ ] **Paso 5: correr los tests y ajustar los sinónimos hasta que pasen**

Run: `pnpm vitest run test/import-mapping.test.ts` — Esperado: PASS.

- [ ] **Paso 6: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add src/shared/import-fields.ts src/server/io/suggest-mapping.ts test/import-mapping.test.ts
git commit -m "feat: campos de importación y mapeo sugerido por encabezado (#22)"
```

---

### Tarea 3: Importación de clientes (servicio) con saldo inicial

**Archivos:**
- Crear: `src/server/io/import-service.ts`, `src/server/io/import-customers.ts`
- Modificar: `src/server/customer/account-ledger.ts` (tipo `opening`), `src/client/state/movement-style.ts`
- Test: `test/import-customers.test.ts` (nuevo), `test/customer-client.test.ts` o el test de `movementLabel` existente

**Interfaces:**
- Consume: `parseCsv`, `parseAmount`, `parseBool`, `normalizeHeader`, `normalizeDocument` (tarea 1);
  tipos y `suggestMapping` (tarea 2); `applyToBalance` y `applyPendingFor`.
- Produce:
  - `LedgerMovement['type']` suma `'opening'`.
  - `type RowContext = { line: number; decimal: DecimalMode; get: (field: ImportField) => string | undefined }`
    (en `import-service.ts`): `get` devuelve `undefined` si el campo no está mapeado y `''` si la celda
    está vacía; `decimal` es `'comma'` si el archivo usa `;` y `'auto'` si no. Los importadores llaman
    `parseAmount(v, row.decimal)`.
  - `importCustomers(db: DatabaseSync, rows: RowContext[], now: string): ImportRowResult[]`
  - `class ImportService { constructor(db: DatabaseSync); run(entity: ImportEntity, req: ImportRequest, now?: string): ImportPreview }`
  - `type ImportRequest = { csv: string; mapping?: ImportMapping | undefined; dryRun: boolean }`
  - `OPENING_IMPORTED = 'Saldo inicial (importado)'`, `OPENING_CORRECTION = 'Saldo inicial (corrección)'`

- [ ] **Paso 1: tests del servicio (clientes)**

```ts
// test/import-customers.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ImportService } from '../src/server/io/import-service.ts';
import { applyToBalance } from '../src/server/customer/account-ledger.ts';
import { recordDiscrepancy } from '../src/server/discrepancy/discrepancies.ts';

const EXCEL = 'Razón Social;DNI;Celular;Deuda\r\nPérez Juan;20.123.456;11 5555-1234;12.345,50\r\nAna Gómez;;;0\r\n';

function movements(db: DatabaseSync, customerId: string) {
  return db.prepare('SELECT type, amount, balance_after, description FROM account_movements WHERE customer_id = ? ORDER BY rowid').all(customerId);
}

describe('importación de clientes (#22)', () => {
  let db: DatabaseSync;
  let service: ImportService;
  const now = '2026-10-03T12:00:00.000Z';

  beforeEach(() => {
    const tm = new TenantManager(openSystemDb(':memory:'), { inMemory: true });
    tm.createTenant({ id: 't1', slug: 't1', name: 'T1', seedDemoData: false });
    db = tm.getTenantDb('t1');
    service = new ImportService(db);
  });

  it('la vista previa no escribe nada y cuenta lo que haría', () => {
    const p = service.run('customers', { csv: EXCEL, dryRun: true }, now);
    expect(p.totals).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });
    expect(p.rows.map((r) => [r.line, r.key, r.action])).toEqual([[2, '20.123.456', 'create'], [3, 'Ana Gómez', 'create']]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 0 });
  });

  it('confirma: el saldo entra como "Saldo inicial (importado)" en el extracto', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = db.prepare("SELECT id, name, document, phone, balance FROM customers WHERE name = 'Pérez Juan'").get() as { id: string; balance: number };
    expect(juan).toMatchObject({ document: '20.123.456', phone: '11 5555-1234', balance: 12345.5 });
    expect(movements(db, juan.id)).toEqual([{ type: 'opening', amount: 12345.5, balance_after: 12345.5, description: 'Saldo inicial (importado)' }]);
  });

  it('reimportar el mismo archivo no duplica clientes ni movimientos', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const again = service.run('customers', { csv: EXCEL, dryRun: false }, now);
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_movements').get()).toEqual({ n: 1 });
  });

  it('reconoce por documento sin puntos y, sin documento, por nombre normalizado', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('customers', { csv: 'Nombre;DNI;Teléfono\nJuan Pérez;20123456;111\n  ana  gomez ;;222\n', dryRun: false }, now);
    expect(p.rows.map((r) => r.action)).toEqual(['update', 'update']);
    // "ana gomez" reconoce a "Ana Gómez" y conserva el nombre del archivo nuevo tal cual viene
    expect(db.prepare('SELECT name, phone FROM customers ORDER BY phone').all()).toEqual([
      { name: 'Juan Pérez', phone: '111' }, { name: 'ana  gomez', phone: '222' },
    ]);
  });

  it('corrige el saldo si solo tiene movimientos de importación', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    service.run('customers', { csv: 'DNI;Saldo\n20123456;10000\n', dryRun: false }, now);
    const juan = db.prepare("SELECT id, balance FROM customers WHERE document = '20.123.456'").get() as { id: string; balance: number };
    expect(juan.balance).toBe(10000);
    expect(movements(db, juan.id)).toEqual([
      { type: 'opening', amount: 12345.5, balance_after: 12345.5, description: 'Saldo inicial (importado)' },
      { type: 'opening', amount: -2345.5, balance_after: 10000, description: 'Saldo inicial (corrección)' },
    ]);
  });

  it('con movimientos posteriores no toca el saldo y avisa en la fila', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = db.prepare("SELECT id FROM customers WHERE document = '20.123.456'").get() as { id: string };
    applyToBalance(db, juan.id, { type: 'sale', delta: 500, description: 'Venta' }, now);
    const p = service.run('customers', { csv: 'DNI;Saldo;Celular\n20123456;0;999\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update', messages: ['Tiene movimientos posteriores: el saldo no se cambia'] });
    expect(db.prepare('SELECT balance, phone FROM customers WHERE id = ?').get(juan.id)).toEqual({ balance: 12845.5, phone: '999' });
  });

  it('errores por fila: sin nombre para crear, número inválido, repetida y nombre ambiguo', () => {
    // Dos clientes con el mismo nombre (cargados a mano en el admin, por ejemplo)
    const insert = db.prepare("INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, 'Repetido', ?, ?)");
    insert.run('c-1', now, now);
    insert.run('c-2', now, now);
    const csv = 'Nombre;DNI;Deuda\n;30111222;10\nZoe;;abc\nZoe;;5\nRepetido;;1\n';
    const p = service.run('customers', { csv, dryRun: true }, now);
    expect(p.rows.map((r) => [r.action, r.messages[0]])).toEqual([
      ['error', 'Falta el nombre para crearlo'],
      ['error', 'Saldo: no es un número'],
      ['create', undefined],
      ['error', 'Hay 2 clientes con ese nombre'],
    ]);
    const dup = service.run('customers', { csv: 'Nombre\nLuz\nluz\n', dryRun: true }, now);
    expect(dup.rows[1]).toMatchObject({ action: 'error', messages: ['Repetida: ver la línea 2'] });
  });

  it('con la columna id aplica los movimientos pendientes del POS (discrepancias)', () => {
    recordDiscrepancy(db, {
      kind: 'unknown-customer', deviceId: 'dev-1', originBranch: 'CENTRAL', originPos: 'Caja 1',
      customerId: 'cust-pos-1', refType: 'sale', refId: 's1', amount: 700,
      pending: { type: 'sale', delta: 700, description: 'Venta a cuenta' },
    }, now);
    service.run('customers', { csv: 'id;name;balance\ncust-pos-1;Carla;100\n', dryRun: false }, now);
    expect(db.prepare("SELECT balance FROM customers WHERE id = 'cust-pos-1'").get()).toEqual({ balance: 800 });
  });

  it('sin columna que identifique las filas: missing y la confirmación da 400', () => {
    const p = service.run('customers', { csv: 'Celular;Deuda\n111;10\n', dryRun: true }, now);
    expect(p.missing).toEqual(['name']);
    expect(() => service.run('customers', { csv: 'Celular;Deuda\n111;10\n', dryRun: false }, now)).toThrow(/Asigná/);
  });
});
```

> En el test de errores, la fila 3 ("Zoe" con saldo inválido) no ocupa la clave: la fila 4 ("Zoe"
> válida) se crea. Revisar en `discrepancies.ts` la forma exacta de `recordDiscrepancy` y los valores
> de `refType` (`messages.ts`) antes de correr.

- [ ] **Paso 2: correr y ver que falla**

Run: `pnpm vitest run test/import-customers.test.ts` — Esperado: FAIL.

- [ ] **Paso 3: tipo `opening` en el libro y en el cliente**

En `account-ledger.ts`: `type: 'sale' | 'payment' | 'payment-void' | 'adjustment' | 'interest' | 'opening';`.
En `src/client/state/movement-style.ts`, `movementLabel`: `case 'opening': return 'Saldo inicial';`,
con su test en el archivo de tests que ya cubre `movementLabel` (buscarlo con
`grep -rn movementLabel test`).

- [ ] **Paso 4: `src/server/io/import-service.ts`**

```ts
import type { DatabaseSync } from 'node:sqlite';
import { parseCsv, type DecimalMode } from './csv.ts';
import { suggestMapping } from './suggest-mapping.ts';
import { importCustomers } from './import-customers.ts';
import { importProducts } from './import-products.ts';
import { DomainError } from '../errors.ts';
import {
  CUSTOMER_FIELDS, PRODUCT_FIELDS, STOCK_UNASSIGNED, stockBranchOf,
  type ImportBranch, type ImportEntity, type ImportField, type ImportMapping, type ImportPreview, type ImportRowAction, type ImportRowResult,
} from '../../shared/import-fields.ts';

export type ImportRequest = { csv: string; mapping?: ImportMapping | undefined; dryRun: boolean };
/** Una fila con sus celdas por campo: `undefined` si el campo no está mapeado, `''` si la celda está vacía. */
export type RowContext = { line: number; decimal: DecimalMode; get: (field: ImportField) => string | undefined };

const IDENTIFIERS: Record<ImportEntity, readonly ImportField[]> = {
  customers: ['id', 'document', 'name'],
  products: ['sku', 'barcodes', 'name'],
};

/** Importación con mapeo (#22): sin estado; la vista previa corre igual y se deshace. */
export class ImportService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  run(entity: ImportEntity, req: ImportRequest, now: string = new Date().toISOString()): ImportPreview {
    const table = parseCsv(req.csv);
    const branches = this.db.prepare('SELECT id, name, code FROM branches ORDER BY created_at, code').all() as ImportBranch[];
    const mapping = req.mapping ?? suggestMapping(entity, table.headers, branches);
    this.checkMapping(entity, mapping, table.headers.length, branches);

    const mapped = Object.entries(mapping).filter((e): e is [string, ImportField] => e[1] !== null);
    const missing: ImportField[] = mapped.some(([, f]) => IDENTIFIERS[entity].includes(f)) ? [] : ['name'];
    const needsBranch = mapped.filter(([, f]) => f === STOCK_UNASSIGNED).map(([i]) => Number(i));
    if (!req.dryRun && (missing.length > 0 || needsBranch.length > 0)) {
      throw new DomainError(400, 'Asigná las columnas que faltan antes de importar');
    }

    // El Excel argentino usa `;` y coma decimal: ahí `1.200` son mil doscientos
    const decimal: DecimalMode = table.separator === ';' ? 'comma' : 'auto';
    const contexts: RowContext[] = table.rows.map(({ line, cells }) => ({
      line,
      decimal,
      get: (field) => {
        const entry = mapped.find(([, f]) => f === field);
        return entry === undefined ? undefined : (cells[Number(entry[0])] ?? '');
      },
    }));

    let rows: ImportRowResult[];
    this.db.exec('SAVEPOINT import_csv');
    try {
      rows = entity === 'customers' ? importCustomers(this.db, contexts, now) : importProducts(this.db, contexts, branches, now);
      if (req.dryRun) this.db.exec('ROLLBACK TO import_csv');
      this.db.exec('RELEASE import_csv');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK TO import_csv');
      this.db.exec('RELEASE import_csv');
      throw err;
    }

    const totals: Record<ImportRowAction, number> = { create: 0, update: 0, unchanged: 0, error: 0 };
    for (const r of rows) totals[r.action]++;
    return {
      entity,
      separator: table.separator,
      columns: table.headers.map((header, index) => ({
        index, header, samples: table.rows.slice(0, 3).map((r) => r.cells[index] ?? ''),
      })),
      mapping,
      branches,
      missing,
      needsBranch,
      rows,
      totals,
      dryRun: req.dryRun,
    };
  }

  /** Un mapeo de afuera: columnas que existen, campos de la entidad, sucursales del comercio, sin repetir. */
  private checkMapping(entity: ImportEntity, mapping: ImportMapping, columns: number, branches: readonly ImportBranch[]): void {
    const allowed = new Set<string>((entity === 'customers' ? CUSTOMER_FIELDS : PRODUCT_FIELDS).map((f) => f.field));
    const seen = new Set<string>();
    for (const [index, field] of Object.entries(mapping)) {
      if (!/^\d+$/.test(index) || Number(index) >= columns) throw new DomainError(400, `La columna ${index} no existe`);
      if (field === null) continue;
      const branchId = stockBranchOf(field);
      const valid = branchId === undefined
        ? allowed.has(field)
        : entity === 'products' && (field === STOCK_UNASSIGNED || branches.some((b) => b.id === branchId));
      if (!valid) throw new DomainError(400, `Campo desconocido: ${field}`);
      if (field !== STOCK_UNASSIGNED && seen.has(field)) throw new DomainError(400, 'Un campo está asignado a dos columnas');
      seen.add(field);
    }
  }
}
```

Para que compile en esta tarea, crear `import-products.ts` con
`export function importProducts(_db: DatabaseSync, _rows: RowContext[], _branches: readonly ImportBranch[], _now: string): ImportRowResult[] { return []; }`
— lo completa la tarea 4 (`noUnusedParameters` acepta el prefijo `_`; si no, verificar la config del
lint y usar los parámetros).

- [ ] **Paso 5: `src/server/io/import-customers.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeDocument, normalizeHeader, parseAmount, parseBool } from './csv.ts';
import { applyToBalance } from '../customer/account-ledger.ts';
import { applyPendingFor } from '../discrepancy/discrepancies.ts';
import type { RowContext } from './import-service.ts';
import type { ImportRowResult } from '../../shared/import-fields.ts';

export const OPENING_IMPORTED = 'Saldo inicial (importado)';
export const OPENING_CORRECTION = 'Saldo inicial (corrección)';
const BALANCE_KEPT = 'Tiene movimientos posteriores: el saldo no se cambia';

type CustomerRow = { id: string; name: string; document: string | null; phone: string | null; credit_limit: number | null; margin: number | null; balance: number | null; unrestricted: number; blocked_reason: string | null };

/** Lo que trae la fila, ya convertido; `undefined` = no se toca. */
type Parsed = { name?: string; document?: string; phone?: string; creditLimit?: number; margin?: number; balance?: number; unrestricted?: boolean; blockedReason?: string };

function parseRow(row: RowContext): { data: Parsed; errors: string[] } {
  const data: Parsed = {};
  const errors: string[] = [];
  const text = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);
  const amount = (label: string, v: string | undefined, min?: number): number | undefined => {
    if (v === undefined || v === '') return undefined;
    const n = parseAmount(v, row.decimal);
    if (n === undefined) errors.push(`${label}: no es un número`);
    else if (min !== undefined && n < min) errors.push(`${label}: no puede ser negativo`);
    return n;
  };
  const name = text(row.get('name'));
  const document = text(row.get('document'));
  const phone = text(row.get('phone'));
  const blockedReason = text(row.get('blockedReason'));
  const creditLimit = amount('Límite de crédito', row.get('creditLimit'), 0);
  const margin = amount('Margen', row.get('margin'), 0);
  const balance = amount('Saldo', row.get('balance'));
  const rawUnrestricted = text(row.get('unrestricted'));
  const unrestricted = rawUnrestricted === undefined ? undefined : parseBool(rawUnrestricted);
  if (rawUnrestricted !== undefined && unrestricted === undefined) errors.push('Sin restricción: tiene que ser sí o no');
  return {
    data: {
      ...(name === undefined ? {} : { name }),
      ...(document === undefined ? {} : { document }),
      ...(phone === undefined ? {} : { phone }),
      ...(creditLimit === undefined ? {} : { creditLimit }),
      ...(margin === undefined ? {} : { margin }),
      ...(balance === undefined ? {} : { balance }),
      ...(unrestricted === undefined ? {} : { unrestricted }),
      ...(blockedReason === undefined ? {} : { blockedReason }),
    },
    errors,
  };
}

/**
 * Clientes (#22): se reconocen por id, documento (sin puntos ni guiones) o nombre normalizado. El
 * saldo de un cliente nuevo entra como "Saldo inicial (importado)"; al reimportar se corrige solo si
 * todos sus movimientos son de importación.
 */
export function importCustomers(db: DatabaseSync, rows: RowContext[], now: string): ImportRowResult[] {
  const byName = new Map<string, string[]>();
  for (const c of db.prepare('SELECT id, name FROM customers').all() as { id: string; name: string }[]) {
    const key = normalizeHeader(c.name);
    byName.set(key, [...(byName.get(key) ?? []), c.id]);
  }
  const findByDocument = db.prepare(
    "SELECT id FROM customers WHERE REPLACE(REPLACE(REPLACE(document, '.', ''), '-', ''), ' ', '') = ?",
  );
  const getCustomer = db.prepare('SELECT * FROM customers WHERE id = ?');
  const foreignMovements = db.prepare("SELECT COUNT(*) AS n FROM account_movements WHERE customer_id = ? AND type != 'opening'");
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];

  for (const row of rows) {
    const rawId = row.get('id')?.trim();
    const id = rawId === undefined || rawId === '' ? undefined : rawId;
    const { data, errors } = parseRow(row);
    const key = data.document ?? data.name ?? id ?? '';
    const identity = id !== undefined ? `id:${id}` : data.document !== undefined ? `doc:${normalizeDocument(data.document)}` : data.name !== undefined ? `name:${normalizeHeader(data.name)}` : undefined;
    if (identity === undefined) {
      results.push({ line: row.line, key, action: 'error', messages: ['La fila no tiene nombre, documento ni id'] });
      continue;
    }
    const previous = seen.get(identity);
    if (previous !== undefined) {
      results.push({ line: row.line, key, action: 'error', messages: [`Repetida: ver la línea ${String(previous)}`] });
      continue;
    }
    if (errors.length > 0) {
      results.push({ line: row.line, key, action: 'error', messages: errors });
      continue;
    }
    // Solo una fila válida "ocupa" la clave: corregida más abajo en el mismo archivo, entra
    seen.set(identity, row.line);

    let existingId: string | undefined;
    if (id !== undefined && getCustomer.get(id) !== undefined) existingId = id;
    else if (data.document !== undefined) existingId = (findByDocument.get(normalizeDocument(data.document)) as { id: string } | undefined)?.id;
    else if (id === undefined && data.name !== undefined) {
      const matches = byName.get(normalizeHeader(data.name)) ?? [];
      if (matches.length > 1) {
        results.push({ line: row.line, key, action: 'error', messages: [`Hay ${String(matches.length)} clientes con ese nombre`] });
        continue;
      }
      existingId = matches[0];
    }

    if (existingId === undefined) {
      if (data.name === undefined) {
        results.push({ line: row.line, key, action: 'error', messages: ['Falta el nombre para crearlo'] });
        continue;
      }
      const newId = id ?? `cust_${randomUUID()}`;
      db.prepare(
        `INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
      ).run(newId, data.name, data.document ?? null, data.phone ?? null, data.creditLimit ?? 0, data.margin ?? 0,
        data.unrestricted === true ? 1 : 0, data.blockedReason ?? null, now, now);
      if (data.balance !== undefined && data.balance !== 0) {
        applyToBalance(db, newId, { type: 'opening', delta: data.balance, description: OPENING_IMPORTED }, now);
      }
      // Lo que una caja le vendió o cobró antes de que existiera queda aplicado (#2)
      applyPendingFor(db, newId, now);
      const nameKey = normalizeHeader(data.name);
      byName.set(nameKey, [...(byName.get(nameKey) ?? []), newId]);
      results.push({ line: row.line, key, action: 'create', messages: [] });
      continue;
    }

    const current = getCustomer.get(existingId) as CustomerRow;
    const messages: string[] = [];
    const changes: [string, string | number | null][] = [];
    if (data.name !== undefined && data.name !== current.name) changes.push(['name', data.name]);
    if (data.document !== undefined && data.document !== current.document) changes.push(['document', data.document]);
    if (data.phone !== undefined && data.phone !== current.phone) changes.push(['phone', data.phone]);
    if (data.creditLimit !== undefined && data.creditLimit !== (current.credit_limit ?? 0)) changes.push(['credit_limit', data.creditLimit]);
    if (data.margin !== undefined && data.margin !== (current.margin ?? 0)) changes.push(['margin', data.margin]);
    if (data.unrestricted !== undefined && (data.unrestricted ? 1 : 0) !== current.unrestricted) changes.push(['unrestricted', data.unrestricted ? 1 : 0]);
    if (data.blockedReason !== undefined && data.blockedReason !== current.blocked_reason) changes.push(['blocked_reason', data.blockedReason]);
    if (changes.length > 0) {
      const sets = changes.map(([col]) => `${col} = ?`).join(', ');
      db.prepare(`UPDATE customers SET ${sets}, updated_at = ? WHERE id = ?`).run(...changes.map(([, v]) => v), now, existingId);
    }
    let balanceChanged = false;
    if (data.balance !== undefined) {
      const diff = Math.round((data.balance - (current.balance ?? 0)) * 100) / 100;
      if (diff !== 0) {
        const { n } = foreignMovements.get(existingId) as { n: number };
        if (n === 0) {
          applyToBalance(db, existingId, { type: 'opening', delta: diff, description: OPENING_CORRECTION }, now);
          balanceChanged = true;
        } else {
          messages.push(BALANCE_KEPT);
        }
      }
    }
    const changed = changes.length > 0 || balanceChanged;
    results.push({ line: row.line, key, action: changed ? 'update' : 'unchanged', messages });
  }
  return results;
}
```

> Los nombres de columna del `UPDATE` salen de una lista fija del código, nunca del archivo: no hay
> inyección. El `getCustomer.get(existingId) as CustomerRow` sigue el idioma de los servicios del repo
> (filas de SQLite tipadas con `as`).

- [ ] **Paso 6: correr los tests**

Run: `pnpm vitest run test/import-customers.test.ts` — Esperado: PASS. Ajustar mensajes y orden hasta
que el test refleje la spec (no al revés).

- [ ] **Paso 7: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add src/server/io/import-service.ts src/server/io/import-customers.ts src/server/io/import-products.ts src/server/customer/account-ledger.ts src/client/state/movement-style.ts test/import-customers.test.ts <test de movementLabel>
git commit -m "feat: importación de clientes con mapeo y saldo inicial en el libro (#22)"
```

---

### Tarea 4: Importación de productos y stock (servicio)

**Archivos:**
- Crear: `src/server/stock/write-stock.ts`
- Modificar: `src/server/stock/stock-service.ts` (usa `writeStock`), `src/server/io/import-products.ts`
- Test: `test/import-products.test.ts` (nuevo); `test/stock-and-kardex.test.ts` sin cambios

**Interfaces:**
- Consume: `RowContext`, `ImportService` (tarea 3); helpers de la tarea 1.
- Produce:
  - `writeStock(db: DatabaseSync, p: { productId: string; branchId: string; type: 'set' | 'delta'; quantity: number; reason: string; notes?: string | undefined; now: string }): { previousQuantity: number; delta: number; newQuantity: number; movementId: string }`
  - `importProducts(db: DatabaseSync, rows: RowContext[], branches: readonly ImportBranch[], now: string): ImportRowResult[]`

- [ ] **Paso 1: tests**

```ts
// test/import-products.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ImportService } from '../src/server/io/import-service.ts';

const now = '2026-10-03T12:00:00.000Z';
const EXCEL = 'Código;Cód. Barras;Descripción;P. Venta;IVA;Stock Central\r\nYER1;7790001;Yerba 1kg;3.500,50;21%;12\r\n;7790002|7790003;Azúcar 1kg;1.200;10,5;4\r\n;;Fideos 500g;900;;\r\n';

describe('importación de productos y stock (#22)', () => {
  let db: DatabaseSync;
  let service: ImportService;

  beforeEach(() => {
    const tm = new TenantManager(openSystemDb(':memory:'), { inMemory: true });
    tm.createTenant({ id: 't1', slug: 't1', name: 'T1', seedDemoData: false });
    db = tm.getTenantDb('t1');
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('branch-norte', 'Norte', 'NORTE', ?)").run(now);
    service = new ImportService(db);
  });

  it('crea con SKU propio, del código de barras o correlativo, IVA normalizado y stock en la sucursal mapeada', () => {
    const p = service.run('products', { csv: EXCEL, dryRun: false }, now);
    expect(p.totals).toMatchObject({ create: 3, error: 0 });
    expect(db.prepare('SELECT sku, barcodes, name, price, tax_rate FROM products ORDER BY name').all()).toEqual([
      { sku: '7790002', barcodes: '["7790002","7790003"]', name: 'Azúcar 1kg', price: 1200, tax_rate: 0.105 },
      { sku: 'IMP-000001', barcodes: '[]', name: 'Fideos 500g', price: 900, tax_rate: 0.21 },
      { sku: 'YER1', barcodes: '["7790001"]', name: 'Yerba 1kg', price: 3500.5, tax_rate: 0.21 },
    ]);
    const stock = db.prepare(
      "SELECT p.sku, s.branch_id, s.quantity FROM stock s JOIN products p ON p.id = s.product_id WHERE s.quantity != 0 ORDER BY p.sku",
    ).all();
    expect(stock).toEqual([
      { sku: '7790002', branch_id: 'branch-central', quantity: 4 },
      { sku: 'YER1', branch_id: 'branch-central', quantity: 12 },
    ]);
    expect(db.prepare("SELECT reason, notes, delta FROM stock_movements ORDER BY delta").all()).toEqual([
      { reason: 'inventory_count', notes: 'Importación', delta: 4 },
      { reason: 'inventory_count', notes: 'Importación', delta: 12 },
    ]);
  });

  it('reimportar el mismo archivo da "sin cambios" y no genera movimientos', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const again = service.run('products', { csv: EXCEL, dryRun: false }, now);
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 3, error: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual({ n: 2 });
  });

  it('un archivo de código + stock solo actualiza, y no toca lo que no está mapeado', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('products', { csv: 'EAN;Stock Norte\n7790003;7\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(db.prepare("SELECT name, price FROM products WHERE sku = '7790002'").get()).toEqual({ name: 'Azúcar 1kg', price: 1200 });
    expect(db.prepare("SELECT quantity FROM stock WHERE branch_id = 'branch-norte' AND product_id = (SELECT id FROM products WHERE sku = '7790002')").get()).toEqual({ quantity: 7 });
  });

  it('una columna "Stock" genérica con dos sucursales pide elegir y no deja confirmar', () => {
    const csv = 'Nombre;Precio;Stock\nPan;100;3\n';
    expect(service.run('products', { csv, dryRun: true }, now).needsBranch).toEqual([2]);
    expect(() => service.run('products', { csv, dryRun: false }, now)).toThrow(/Asigná/);
    const ok = service.run('products', { csv, dryRun: false, mapping: { '0': 'name', '1': 'price', '2': 'stock:branch-norte' } }, now);
    expect(ok.totals.create).toBe(1);
  });

  it('errores: sin precio para crear, precio negativo, IVA fuera de rango, SKU y código de productos distintos', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const csv = 'SKU;Código de barras;Nombre;Precio;IVA\n;;Nuevo;;\n;;Otro;-5;\n;;Otro2;10;150\nYER1;7790002;Choque;10;\n';
    expect(service.run('products', { csv, dryRun: true }, now).rows.map((r) => r.messages[0])).toEqual([
      'Falta el precio para crearlo',
      'Precio: no puede ser negativo',
      'IVA: tiene que estar entre 0 y 100 %',
      'El SKU y el código de barras son de productos distintos',
    ]);
  });

  it('sin códigos se reconoce por nombre normalizado', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('products', { csv: 'Nombre;Precio\nfideos 500G;950\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(db.prepare("SELECT price FROM products WHERE sku = 'IMP-000001'").get()).toEqual({ price: 950 });
  });
});
```

- [ ] **Paso 2: correr y ver que falla**

Run: `pnpm vitest run test/import-products.test.ts` — Esperado: FAIL.

- [ ] **Paso 3: `src/server/stock/write-stock.ts` y `StockService` lo usa**

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Fija o suma stock con su movimiento de kardex y toca el producto para el pull. Sin validar existencia. */
export function writeStock(
  db: DatabaseSync,
  p: { productId: string; branchId: string; type: 'set' | 'delta'; quantity: number; reason: string; notes?: string | undefined; now: string },
): { previousQuantity: number; delta: number; newQuantity: number; movementId: string } {
  const row = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND branch_id = ?').get(p.productId, p.branchId) as { quantity: number } | undefined;
  const previousQuantity = row?.quantity ?? 0;
  const newQuantity = p.type === 'set' ? p.quantity : previousQuantity + p.quantity;
  const delta = newQuantity - previousQuantity;
  const movementId = `mov_${randomUUID()}`;
  db.prepare(
    `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, notes, sale_id, device_id, branch, point_of_sale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?)`,
  ).run(movementId, p.productId, p.branchId, delta, p.reason, p.notes ?? null, p.now);
  db.prepare(
    `INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(product_id, branch_id) DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at`,
  ).run(p.productId, p.branchId, newQuantity, p.now);
  db.prepare('UPDATE products SET updated_at = ? WHERE id = ?').run(p.now, p.productId);
  return { previousQuantity, delta, newQuantity, movementId };
}
```

En `StockService.adjustStock`, después de las verificaciones 1 y 2, reemplazar los pasos 3 a 6 por:

```ts
    const now = new Date().toISOString();
    const written = writeStock(this.db, {
      productId: params.productId, branchId: params.branchId, type: params.type,
      quantity: params.quantity, reason: params.reason, notes: params.notes, now,
    });
    return { productId: params.productId, branchId: params.branchId, ...written, updatedAt: now };
```

Run: `pnpm vitest run test/stock-and-kardex.test.ts` — Esperado: PASS (sin cambios de comportamiento).

- [ ] **Paso 4: `src/server/io/import-products.ts`**

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { normalizeHeader, parseAmount, parseBool, type DecimalMode } from './csv.ts';
import { writeStock } from '../stock/write-stock.ts';
import type { RowContext } from './import-service.ts';
import { stockField, type ImportBranch, type ImportRowResult } from '../../shared/import-fields.ts';

type ProductRow = { id: string; sku: string; barcodes: string; name: string; price: number; tax_rate: number; category: string; tracks_stock: number };
type Parsed = { sku?: string; barcodes: string[]; name?: string; price?: number; taxRate?: number; category?: string; tracksStock?: boolean; stock: { branchId: string; quantity: number }[] };

/** `21`, `21%`, `10,5` o `0,21` → fracción; `undefined` si no es un número; fuera de 0–100 % es error. */
function parseTax(raw: string, decimal: DecimalMode): number | undefined {
  const n = parseAmount(raw.replace('%', ''), decimal);
  if (n === undefined) return undefined;
  return n > 1 ? Math.round(n * 10) / 1000 : n;
}

function parseRow(row: RowContext, branches: readonly ImportBranch[]): { data: Parsed; errors: string[] } {
  const errors: string[] = [];
  const text = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);
  const sku = text(row.get('sku'));
  const name = text(row.get('name'));
  const category = text(row.get('category'));
  const barcodes = (row.get('barcodes') ?? '').split(/[|;,]/).map((b) => b.trim()).filter((b) => b !== '');
  const rawPrice = text(row.get('price'));
  const price = rawPrice === undefined ? undefined : parseAmount(rawPrice, row.decimal);
  if (rawPrice !== undefined && price === undefined) errors.push('Precio: no es un número');
  if (price !== undefined && price < 0) errors.push('Precio: no puede ser negativo');
  const rawTax = text(row.get('taxRate'));
  const taxRate = rawTax === undefined ? undefined : parseTax(rawTax, row.decimal);
  if (rawTax !== undefined && taxRate === undefined) errors.push('IVA: no es un número');
  if (taxRate !== undefined && (taxRate < 0 || taxRate > 1)) errors.push('IVA: tiene que estar entre 0 y 100 %');
  const rawTracks = text(row.get('tracksStock'));
  const tracksStock = rawTracks === undefined ? undefined : parseBool(rawTracks);
  if (rawTracks !== undefined && tracksStock === undefined) errors.push('Controla stock: tiene que ser sí o no');
  const stock: Parsed['stock'] = [];
  for (const b of branches) {
    const raw = text(row.get(stockField(b.id)));
    if (raw === undefined) continue;
    const quantity = parseAmount(raw, row.decimal);
    if (quantity === undefined) errors.push(`Stock · ${b.name}: no es un número`);
    else stock.push({ branchId: b.id, quantity });
  }
  return {
    data: {
      barcodes, stock,
      ...(sku === undefined ? {} : { sku }),
      ...(name === undefined ? {} : { name }),
      ...(price === undefined ? {} : { price }),
      ...(taxRate === undefined ? {} : { taxRate }),
      ...(category === undefined ? {} : { category }),
      ...(tracksStock === undefined ? {} : { tracksStock }),
    },
    errors,
  };
}

/**
 * Productos y stock (#22): se reconocen por código de barras o SKU y, sin ninguno, por nombre
 * normalizado. Al actualizar solo se tocan los campos mapeados; el stock se fija por sucursal.
 */
export function importProducts(db: DatabaseSync, rows: RowContext[], branches: readonly ImportBranch[], now: string): ImportRowResult[] {
  const bySku = db.prepare('SELECT id FROM products WHERE sku = ?');
  const byBarcode = db.prepare('SELECT DISTINCT p.id FROM products p, json_each(p.barcodes) j WHERE j.value = ?');
  const getProduct = db.prepare('SELECT * FROM products WHERE id = ?');
  const currentStock = db.prepare('SELECT quantity FROM stock WHERE product_id = ? AND branch_id = ?');
  const byName = new Map<string, string[]>();
  for (const p of db.prepare('SELECT id, name FROM products').all() as { id: string; name: string }[]) {
    const k = normalizeHeader(p.name);
    byName.set(k, [...(byName.get(k) ?? []), p.id]);
  }
  const nextSku = (): string => {
    const rowsImp = db.prepare("SELECT sku FROM products WHERE sku LIKE 'IMP-%'").all() as { sku: string }[];
    const max = rowsImp.reduce((m, r) => Math.max(m, Number(r.sku.slice(4)) || 0), 0);
    return `IMP-${String(max + 1).padStart(6, '0')}`;
  };
  const seen = new Map<string, number>();
  const results: ImportRowResult[] = [];

  for (const row of rows) {
    const { data, errors } = parseRow(row, branches);
    const key = data.sku ?? data.barcodes[0] ?? data.name ?? '';
    const identities = [
      ...(data.sku === undefined ? [] : [`sku:${data.sku}`]),
      ...data.barcodes.map((b) => `bc:${b}`),
      ...(data.sku === undefined && data.barcodes.length === 0 && data.name !== undefined ? [`name:${normalizeHeader(data.name)}`] : []),
    ];
    if (identities.length === 0) {
      results.push({ line: row.line, key, action: 'error', messages: ['La fila no tiene SKU, código de barras ni nombre'] });
      continue;
    }
    const previous = identities.map((i) => seen.get(i)).find((l) => l !== undefined);
    if (previous !== undefined) {
      results.push({ line: row.line, key, action: 'error', messages: [`Repetida: ver la línea ${String(previous)}`] });
      continue;
    }
    if (errors.length > 0) {
      results.push({ line: row.line, key, action: 'error', messages: errors });
      continue;
    }
    for (const i of identities) seen.set(i, row.line);

    const skuId = data.sku === undefined ? undefined : (bySku.get(data.sku) as { id: string } | undefined)?.id;
    const barcodeIds = [...new Set(data.barcodes.flatMap((b) => (byBarcode.all(b) as { id: string }[]).map((r) => r.id)))];
    const nameIds = data.sku === undefined && data.barcodes.length === 0 && data.name !== undefined ? (byName.get(normalizeHeader(data.name)) ?? []) : [];
    const ids = new Set([...(skuId === undefined ? [] : [skuId]), ...barcodeIds]);
    if (ids.size > 1) {
      results.push({ line: row.line, key, action: 'error', messages: ['El SKU y el código de barras son de productos distintos'] });
      continue;
    }
    if (nameIds.length > 1) {
      results.push({ line: row.line, key, action: 'error', messages: [`Hay ${String(nameIds.length)} productos con ese nombre`] });
      continue;
    }
    const existingId = [...ids][0] ?? nameIds[0];

    let productId: string;
    let changed = false;
    let action: 'create' | 'update' | 'unchanged';
    if (existingId === undefined) {
      if (data.name === undefined) {
        results.push({ line: row.line, key, action: 'error', messages: ['Falta el nombre para crearlo'] });
        continue;
      }
      if (data.price === undefined) {
        results.push({ line: row.line, key, action: 'error', messages: ['Falta el precio para crearlo'] });
        continue;
      }
      const fromBarcode = data.barcodes[0];
      const sku = data.sku ?? (fromBarcode !== undefined && bySku.get(fromBarcode) === undefined ? fromBarcode : nextSku());
      productId = `prod_${randomUUID()}`;
      const tracks = data.tracksStock ?? true;
      db.prepare(
        `INSERT INTO products (id, sku, barcodes, name, price, tax_rate, category, tracks_stock, blocked_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      ).run(productId, sku, JSON.stringify(data.barcodes), data.name, data.price, data.taxRate ?? 0.21, data.category ?? 'General', tracks ? 1 : 0, now, now);
      if (tracks) {
        const insertStock = db.prepare('INSERT INTO stock (product_id, branch_id, quantity, updated_at) VALUES (?, ?, 0, ?) ON CONFLICT DO NOTHING');
        for (const b of branches) insertStock.run(productId, b.id, now);
      }
      const nameKey = normalizeHeader(data.name);
      byName.set(nameKey, [...(byName.get(nameKey) ?? []), productId]);
      action = 'create';
    } else {
      productId = existingId;
      const current = getProduct.get(existingId) as ProductRow;
      const currentBarcodes = JSON.parse(current.barcodes) as string[];
      const mergedBarcodes = [...currentBarcodes, ...data.barcodes.filter((b) => !currentBarcodes.includes(b))];
      const changes: [string, string | number][] = [];
      if (data.sku !== undefined && data.sku !== current.sku) changes.push(['sku', data.sku]);
      if (mergedBarcodes.length !== currentBarcodes.length) changes.push(['barcodes', JSON.stringify(mergedBarcodes)]);
      if (data.name !== undefined && data.name !== current.name) changes.push(['name', data.name]);
      if (data.price !== undefined && data.price !== current.price) changes.push(['price', data.price]);
      if (data.taxRate !== undefined && data.taxRate !== current.tax_rate) changes.push(['tax_rate', data.taxRate]);
      if (data.category !== undefined && data.category !== current.category) changes.push(['category', data.category]);
      if (data.tracksStock !== undefined && (data.tracksStock ? 1 : 0) !== current.tracks_stock) changes.push(['tracks_stock', data.tracksStock ? 1 : 0]);
      if (changes.length > 0) {
        const sets = changes.map(([col]) => `${col} = ?`).join(', ');
        db.prepare(`UPDATE products SET ${sets}, updated_at = ? WHERE id = ?`).run(...changes.map(([, v]) => v), now, existingId);
        changed = true;
      }
      action = 'unchanged';
    }

    for (const s of data.stock) {
      const cur = (currentStock.get(productId, s.branchId) as { quantity: number } | undefined)?.quantity ?? 0;
      if (cur === s.quantity) continue;
      writeStock(db, { productId, branchId: s.branchId, type: 'set', quantity: s.quantity, reason: 'inventory_count', notes: 'Importación', now });
      changed = true;
    }
    results.push({ line: row.line, key, action: action === 'create' ? 'create' : changed ? 'update' : 'unchanged', messages: [] });
  }
  return results;
}
```

> Un SKU nuevo que ya usa otro producto (`data.sku` distinto del actual y tomado) hace fallar el
> `UPDATE` por `UNIQUE`: ese error inesperado deshace todo. Para que sea un error de fila, antes del
> `UPDATE` verificar `bySku.get(data.sku)` y, si es de otro producto, `'Ese SKU ya es de otro producto'`.
> Sumarlo con su caso al test.

- [ ] **Paso 5: correr los tests**

Run: `pnpm vitest run test/import-products.test.ts test/import-customers.test.ts test/stock-and-kardex.test.ts` — Esperado: PASS.

- [ ] **Paso 6: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add src/server/stock/write-stock.ts src/server/stock/stock-service.ts src/server/io/import-products.ts test/import-products.test.ts
git commit -m "feat: importación de productos por código o SKU, con stock por sucursal en el kardex (#22)"
```

---

### Tarea 5: Endpoint nuevo de importación

**Archivos:**
- Modificar: `src/server/routes/io-routes.ts`, `src/server/di/container.ts` (`importServiceDef`),
  `src/server/io/import-export-service.ts` (borrar `importProducts`, `importCustomers`, `parseCsv`,
  `normalizeInputRows`, sus esquemas Zod y tipos de importación)
- Test: `test/import-api.test.ts` (nuevo); `test/import-export-and-seeds.test.ts` (borrar el bloque
  "Importación CSV y JSON", que describe la API vieja); `test/permissions-api.test.ts` (sin cambios de
  tabla: `POST /import/:entity` ya está con `bulk`)

**Interfaces:**
- Consume: `ImportService` (tareas 3 y 4).
- Produce: `POST /api/tenants/:tenantId/import/:entity` con cuerpo `{ csv: string; mapping?: ImportMapping; dryRun: boolean }`
  → `200 ImportPreview`; `400 { error }` con entidad inválida, mapeo inválido o mapeo incompleto al confirmar.
  `importServiceDef = fn.scoped((c) => new ImportService(c.use(tenantDbDef)))`.

- [ ] **Paso 1: tests de API, con el criterio de aceptación de #22**

```ts
// test/import-api.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { ImportPreview } from '../src/shared/import-fields.ts';

// Un CSV "de Excel": punto y coma, coma decimal, encabezados propios y una columna que no se importa
const EXCEL = 'Apellido y Nombre;Nro Doc;Tel;Saldo CC;Vendedor\r\nPérez Juan;20.123.456;1155551234;12.345,50;Ana\r\nGómez Ana;27.999.888;;-1.000,00;Ana\r\n';

describe('POST /import/:entity (#22)', () => {
  let app: Express;
  let tenants: TenantManager;
  let owner: string;
  let member: string;

  beforeEach(() => {
    const systemDb = openSystemDb(':memory:');
    tenants = new TenantManager(systemDb, { inMemory: true });
    const created = createApp({ systemDb, tenantManager: tenants });
    app = created.app;
    const o = created.authService.createUser({ email: 'o@x.com', password: 'clave-segura', name: 'Owner' });
    const m = created.authService.createUser({ email: 'm@x.com', password: 'clave-segura', name: 'Member' });
    owner = o.token;
    member = m.token;
    tenants.createTenant({ id: 't1', slug: 't1', name: 'T1', ownerUserId: o.user.id, seedDemoData: false });
    new MembershipService(systemDb).addMember({ userId: m.user.id, tenantId: 't1', role: 'member' });
  });

  const post = (token: string, entity: string, body: object) =>
    request(app).post(`/api/tenants/t1/import/${entity}`).set('Authorization', `Bearer ${token}`).send(body);

  it('criterio de aceptación: mapea, importa con saldo inicial en el extracto y reimporta sin duplicar', async () => {
    const preview = (await post(owner, 'customers', { csv: EXCEL, dryRun: true })).body as ImportPreview;
    expect(preview.separator).toBe(';');
    expect(preview.mapping).toEqual({ '0': 'name', '1': 'document', '2': 'phone', '3': 'balance', '4': null });
    expect(preview.totals).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });

    const done = await post(owner, 'customers', { csv: EXCEL, mapping: preview.mapping, dryRun: false });
    expect(done.status).toBe(200);
    const db = tenants.getTenantDb('t1');
    const juan = db.prepare("SELECT id, balance FROM customers WHERE document = '20.123.456'").get() as { id: string; balance: number };
    expect(juan.balance).toBe(12345.5);
    const statement = await request(app).get(`/api/tenants/t1/customers/${juan.id}/movements`).set('Authorization', `Bearer ${owner}`);
    expect(JSON.stringify(statement.body)).toContain('Saldo inicial (importado)');

    const again = (await post(owner, 'customers', { csv: EXCEL, dryRun: false })).body as ImportPreview;
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_movements').get()).toEqual({ n: 2 });
  });

  it('member no importa: 403', async () => {
    expect((await post(member, 'customers', { csv: EXCEL, dryRun: true })).status).toBe(403);
  });

  it('entidad desconocida, mapeo con un campo inválido y mapeo incompleto al confirmar: 400', async () => {
    expect((await post(owner, 'stock', { csv: EXCEL, dryRun: true })).status).toBe(400);
    expect((await post(owner, 'customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'precio' } })).status).toBe(400);
    expect((await post(owner, 'customers', { csv: 'Tel\n1\n', dryRun: false })).status).toBe(400);
  });

  it('el cuerpo viejo (items, sin dryRun) ya no se acepta', async () => {
    expect((await post(owner, 'products', { items: [{ sku: 'A', name: 'A', price: 1 }] })).status).toBe(400);
  });
});
```

> Antes de correr: confirmar en `customer-routes.ts` la ruta del extracto (`/customers/:id/movements`
> o la que sea) y el nombre de `MembershipService.addMember` (o el helper que usa
> `permissions-api.test.ts` para crear un member). Usar lo que exista.

- [ ] **Paso 2: correr y ver que falla**

Run: `pnpm vitest run test/import-api.test.ts` — Esperado: FAIL (el endpoint viejo responde otra forma).

- [ ] **Paso 3: la ruta**

En `container.ts`: `export const importServiceDef = fn.scoped((c) => new ImportService(c.use(tenantDbDef)));`
(junto a `importExportServiceDef`, con su import).

En `io-routes.ts`, reemplazar `importBodySchema` y el handler `POST /import/:entity`:

```ts
const importBodySchema = z.object({
  csv: z.string(),
  mapping: z.record(z.string().nullable()).optional(),
  dryRun: z.boolean(),
});

  // POST /import/:entity - CSV con mapeo de columnas (#22): vista previa (dryRun) o confirmación
  router.post('/import/:entity', requirePermission('bulk'), (req: AuthenticatedAdminRequest, res: Response) => {
    const entity = req.params['entity'];
    if (entity !== 'customers' && entity !== 'products') {
      res.status(400).json({ error: "Entidad de importación inválida. Debe ser 'products' o 'customers'" });
      return;
    }
    const parsed = importBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos de importación inválidos' });
      return;
    }
    try {
      const service = req.tenantScope?.use(importServiceDef);
      if (service === undefined) throw new Error('Tenant Scope no inicializado en la petición');
      const { mapping, ...rest } = parsed.data;
      res.status(200).json(service.run(entity, { ...rest, mapping: mapping === undefined ? undefined : toMapping(mapping) }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });
```

`toMapping` valida la forma de los valores sin `as`: los campos llegan como `string | null`; el
`ImportService.checkMapping` ya rechaza los desconocidos. Para tipar sin conversión, poner en
`src/shared/import-fields.ts` un guard `isImportFieldName(v: string): v is ImportField` (lista de
`CUSTOMER_FIELDS`, `PRODUCT_FIELDS` o prefijo `stock:`) y:

```ts
function toMapping(raw: Record<string, string | null>): ImportMapping {
  const out: ImportMapping = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== null && !isImportFieldName(v)) throw new DomainError(400, `Campo desconocido: ${v}`);
    out[k] = v;
  }
  return out;
}
```

Revisar que `sendError` traduzca `DomainError` a su estado (`src/server/errors.ts`).

- [ ] **Paso 4: borrar la importación vieja**

En `import-export-service.ts`: borrar `ImportIssue`, `importIssue`, `ImportResult`,
`importProductRowSchema`, `importCustomerRowSchema`, `importProducts`, `importCustomers`, `parseCsv`,
`normalizeInputRows` y los imports que queden sin uso (`randomUUID`, `z`, `applyPendingFor`). En
`test/import-export-and-seeds.test.ts`, borrar el `describe('Importación CSV y JSON …')` y las
interfaces que queden sin uso.

- [ ] **Paso 5: correr los tests**

Run: `pnpm vitest run test/import-api.test.ts test/import-export-and-seeds.test.ts test/permissions-api.test.ts` — Esperado: PASS.

- [ ] **Paso 6: verificación completa y commit**

```bash
pnpm lint && pnpm typecheck && pnpm test
git add src/server/routes/io-routes.ts src/server/di/container.ts src/server/io/import-export-service.ts src/shared/import-fields.ts test/import-api.test.ts test/import-export-and-seeds.test.ts
git commit -m "feat: POST /import/:entity con mapeo y vista previa; se borra la importación de columnas fijas (#22)"
```

> El cliente de hoy (`bulk-state.ts`) queda roto contra la API nueva hasta la tarea 6: sus tests
> mockean `fetch` y siguen pasando. La tarea 6 lo reemplaza; no se hace deploy en el medio.

---

### Tarea 6: Asistente de importación en Operaciones masivas

**Archivos:**
- Crear: `src/client/state/import-state.ts`, `src/client/components/import/ImportWizard.tsx`,
  `src/client/components/import/ImportFileStep.tsx`, `src/client/components/import/ImportMappingStep.tsx`,
  `src/client/components/import/ImportResultTable.tsx`
- Modificar: `src/client/components/bulk/ImportExportCard.tsx` (borrar la sección de importación; queda
  la de exportar), `src/client/components/bulk/BulkView.tsx` (la pestaña `io` muestra exportar y el
  asistente), `src/client/state/bulk-state.ts` (borrar `ioUpdateExistingSignal`, `ioCsvContentSignal`,
  `ioImportPreviewSignal`, `previewImport`, `applyImport`, `ImportResult`), `test/bulk-client.test.ts`
  (borrar el bloque "Importación CSV")
- Test: `test/import-client.test.ts` (nuevo)

**Interfaces:**
- Consume: `ImportPreview`, `ImportMapping`, `ImportEntity`, `ImportField`, `fieldLabel`,
  `CUSTOMER_FIELDS`, `PRODUCT_FIELDS`, `stockField`, `STOCK_UNASSIGNED` (tarea 2); `POST /import/:entity` (tarea 5).
- Produce (en `import-state.ts`):
  - signals `importEntitySignal: Signal<ImportEntity>`, `importFileNameSignal: Signal<string | null>`,
    `importCsvSignal: Signal<string>`, `importMappingSignal: Signal<ImportMapping>`,
    `importPreviewSignal: Signal<ImportPreview | null>`, `importStepSignal: Signal<'file' | 'mapping' | 'done'>`,
    `importLoadingSignal: Signal<boolean>`, `importErrorSignal: Signal<string | null>`,
    `importOnlyIssuesSignal: Signal<boolean>`
  - `decodeCsvBytes(bytes: Uint8Array): string`
  - `loadImportText(fileName: string, text: string): Promise<void>`
  - `loadImportFile(file: File): Promise<void>`
  - `setColumnField(index: number, field: ImportField | null): void`
  - `requestImportPreview(): Promise<void>`
  - `confirmImport(): Promise<void>`
  - `resetImport(): void`
  - `PREVIEW_DELAY_MS = 300`

- [ ] **Paso 1: tests del store**

```ts
// test/import-client.test.ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  decodeCsvBytes, loadImportText, setColumnField, confirmImport, resetImport, requestImportPreview,
  importEntitySignal, importMappingSignal, importPreviewSignal, importStepSignal, importErrorSignal, PREVIEW_DELAY_MS,
} from '../src/client/state/import-state.ts';
import { tokenSignal, activeTenantIdSignal } from '../src/client/state/auth-state.ts';
import type { ImportPreview } from '../src/shared/import-fields.ts';

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  entity: 'customers', separator: ';', columns: [{ index: 0, header: 'Nombre', samples: ['Ana'] }, { index: 1, header: 'Deuda', samples: ['10'] }],
  mapping: { '0': 'name', '1': 'balance' }, branches: [], missing: [], needsBranch: [],
  rows: [{ line: 2, key: 'Ana', action: 'create', messages: [] }], totals: { create: 1, update: 0, unchanged: 0, error: 0 }, dryRun: true, ...over,
});

function mockFetch(responses: ImportPreview[]) {
  const bodies: unknown[] = [];
  globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    return Promise.resolve(new Response(JSON.stringify(responses.shift() ?? preview()), { status: 200, headers: { 'content-type': 'application/json' } }));
  });
  return bodies;
}

describe('asistente de importación (#22)', () => {
  beforeEach(() => {
    resetImport();
    tokenSignal.value = 'tok';
    activeTenantIdSignal.value = 't1';
    importEntitySignal.value = 'customers';
  });
  afterEach(() => vi.useRealTimers());

  it('decodifica UTF-8 y, si no es válido, Windows-1252 (Excel en castellano)', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Muñoz;Pérez'))).toBe('Muñoz;Pérez');
    expect(decodeCsvBytes(new Uint8Array([0x4d, 0x75, 0xf1, 0x6f, 0x7a]))).toBe('Muñoz');
  });

  it('al cargar el archivo pide la vista previa sin mapeo y adopta el sugerido', async () => {
    const bodies = mockFetch([preview()]);
    await loadImportText('clientes.csv', 'Nombre;Deuda\nAna;10\n');
    expect(bodies[0]).toEqual({ csv: 'Nombre;Deuda\nAna;10\n', dryRun: true });
    expect(importMappingSignal.value).toEqual({ '0': 'name', '1': 'balance' });
    expect(importStepSignal.value).toBe('mapping');
  });

  it('cambiar una columna vuelve a pedir la vista previa con el mapeo, después de un retardo', async () => {
    vi.useFakeTimers();
    const bodies = mockFetch([preview(), preview({ mapping: { '0': 'name', '1': null } })]);
    await loadImportText('c.csv', 'Nombre;Deuda\nAna;10\n');
    setColumnField(1, null);
    expect(bodies).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    expect(bodies[1]).toEqual({ csv: 'Nombre;Deuda\nAna;10\n', mapping: { '0': 'name', '1': null }, dryRun: true });
  });

  it('confirmar manda dryRun false y pasa al resultado', async () => {
    const bodies = mockFetch([preview(), preview({ dryRun: false })]);
    await loadImportText('c.csv', 'Nombre;Deuda\nAna;10\n');
    await confirmImport();
    expect(bodies[1]).toMatchObject({ dryRun: false, mapping: { '0': 'name', '1': 'balance' } });
    expect(importStepSignal.value).toBe('done');
    expect(importPreviewSignal.value?.dryRun).toBe(false);
  });

  it('un error del servidor queda en importErrorSignal y no avanza', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Asigná las columnas que faltan antes de importar' }), { status: 400, headers: { 'content-type': 'application/json' } }));
    await requestImportPreview();
    importStepSignal.value = 'mapping';
    importMappingSignal.value = { '0': null };
    await confirmImport();
    expect(importErrorSignal.value).toBe('Asigná las columnas que faltan antes de importar');
    expect(importStepSignal.value).toBe('mapping');
  });
});
```

> Revisar en `auth-state.ts` qué signal alimenta `effectiveTenantIdSignal` (en `bulk-client.test.ts`
> se usa `activeTenantIdSignal` y `userTenantsSignal`): copiar ese armado.

- [ ] **Paso 2: correr y ver que falla**

Run: `pnpm vitest run test/import-client.test.ts` — Esperado: FAIL.

- [ ] **Paso 3: `src/client/state/import-state.ts`**

```ts
import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import type { ImportEntity, ImportField, ImportMapping, ImportPreview } from '../../shared/import-fields.ts';

export const PREVIEW_DELAY_MS = 300;

export const importEntitySignal = signal<ImportEntity>('products');
export const importFileNameSignal = signal<string | null>(null);
export const importCsvSignal = signal<string>('');
export const importMappingSignal = signal<ImportMapping>({});
export const importPreviewSignal = signal<ImportPreview | null>(null);
export const importStepSignal = signal<'file' | 'mapping' | 'done'>('file');
export const importLoadingSignal = signal<boolean>(false);
export const importErrorSignal = signal<string | null>(null);
export const importOnlyIssuesSignal = signal<boolean>(false);

let previewTimer: ReturnType<typeof setTimeout> | undefined;

/** Excel en Windows en castellano guarda el CSV en Windows-1252: si no es UTF-8 válido, se lee así. */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

async function send(mapping: ImportMapping | undefined, dryRun: boolean): Promise<ImportPreview | null> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return null;
  importLoadingSignal.value = true;
  importErrorSignal.value = null;
  try {
    return await apiFetch<ImportPreview>(`tenants/${tenantId}/import/${importEntitySignal.value}`, {
      method: 'POST',
      token,
      body: { csv: importCsvSignal.value, ...(mapping === undefined ? {} : { mapping }), dryRun },
    });
  } catch (err: unknown) {
    importErrorSignal.value = err instanceof Error ? err.message : 'No se pudo leer el archivo';
    return null;
  } finally {
    importLoadingSignal.value = false;
  }
}

export async function loadImportText(fileName: string, text: string): Promise<void> {
  importFileNameSignal.value = fileName;
  importCsvSignal.value = text;
  const res = await send(undefined, true);
  if (res === null) return;
  importPreviewSignal.value = res;
  importMappingSignal.value = res.mapping;
  importStepSignal.value = 'mapping';
}

export async function loadImportFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadImportText(file.name, decodeCsvBytes(bytes));
}

export async function requestImportPreview(): Promise<void> {
  const res = await send(importMappingSignal.value, true);
  if (res !== null) importPreviewSignal.value = res;
}

export function setColumnField(index: number, field: ImportField | null): void {
  importMappingSignal.value = { ...importMappingSignal.value, [String(index)]: field };
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  previewTimer = setTimeout(() => {
    void requestImportPreview();
  }, PREVIEW_DELAY_MS);
}

export async function confirmImport(): Promise<void> {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  const res = await send(importMappingSignal.value, false);
  if (res === null) return;
  importPreviewSignal.value = res;
  importStepSignal.value = 'done';
}

export function resetImport(): void {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  importFileNameSignal.value = null;
  importCsvSignal.value = '';
  importMappingSignal.value = {};
  importPreviewSignal.value = null;
  importStepSignal.value = 'file';
  importLoadingSignal.value = false;
  importErrorSignal.value = null;
  importOnlyIssuesSignal.value = false;
}
```

- [ ] **Paso 4: componentes**

`ImportWizard.tsx` (contenedor; prop `onDone?: (() => void) | undefined` para el alta, que muestra
"Seguir" en el resultado):

```tsx
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { ImportFileStep } from './ImportFileStep.tsx';
import { ImportMappingStep } from './ImportMappingStep.tsx';
import { ImportResultTable } from './ImportResultTable.tsx';
import {
  importStepSignal, importPreviewSignal, importErrorSignal, importLoadingSignal, importEntitySignal, confirmImport, resetImport,
} from '../../state/import-state.ts';
import { navigateTo } from '../../state/navigation-state.ts';

export type ImportWizardProps = { onDone?: (() => void) | undefined };

export function ImportWizard(props: ImportWizardProps) {
  const step = importStepSignal.value;
  const preview = importPreviewSignal.value;
  const blocked = preview === null || preview.missing.length > 0 || preview.needsBranch.length > 0;
  const toImport = preview === null ? 0 : preview.totals.create + preview.totals.update;
  return (
    <Card class="space-y-5">
      <div>
        <h3 class="text-base font-bold text-slate-900 dark:text-white">Importar desde un archivo</h3>
        <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Productos y stock, o clientes y saldos, desde un CSV de cualquier sistema o planilla.
        </p>
      </div>
      {importErrorSignal.value !== null && (
        <p role="alert" class="text-sm text-rose-600 dark:text-rose-400">{importErrorSignal.value}</p>
      )}
      {step === 'file' && <ImportFileStep />}
      {step === 'mapping' && preview !== null && (
        <>
          <ImportMappingStep preview={preview} />
          <ImportResultTable preview={preview} />
          <div class="flex flex-wrap items-center justify-end gap-3">
            <Button variant="ghost" onClick={resetImport}>Elegir otro archivo</Button>
            <Button loading={importLoadingSignal.value} disabled={blocked || toImport === 0} onClick={() => { void confirmImport(); }}>
              {`Importar ${String(toImport)}`}
              {preview.totals.error > 0 ? ` · se omiten ${String(preview.totals.error)} con errores` : ''}
            </Button>
          </div>
        </>
      )}
      {step === 'done' && preview !== null && (
        <>
          <ImportResultTable preview={preview} />
          <div class="flex flex-wrap justify-end gap-3">
            <Button variant="outline" onClick={resetImport}>Importar otro archivo</Button>
            {importEntitySignal.value === 'customers' && props.onDone === undefined && (
              <Button variant="outline" onClick={() => navigateTo('customers')}>Ver clientes</Button>
            )}
            {props.onDone !== undefined && <Button onClick={props.onDone}>Seguir</Button>}
          </div>
        </>
      )}
    </Card>
  );
}
```

> Verificar el nombre de la vista de clientes en `navigation-state.ts` (`navigateTo('customers')` o el
> que use el menú).

`ImportFileStep.tsx`: dos botones de entidad ("Productos y stock" / "Clientes y saldos", mismo estilo
que el selector de hoy en `ImportExportCard`), un `<input type="file" accept=".csv,text/csv,text/plain">`
con etiqueta "Elegí el archivo", soltar sobre la tarjeta (`onDragOver` con `preventDefault`, `onDrop`
toma `e.dataTransfer?.files[0]`) y el texto de ayuda de la spec:

```tsx
import type { JSX } from 'preact';
import { importEntitySignal, importLoadingSignal, loadImportFile } from '../../state/import-state.ts';
import type { ImportEntity } from '../../../shared/import-fields.ts';

const ENTITIES: { value: ImportEntity; label: string }[] = [
  { value: 'products', label: 'Productos y stock' },
  { value: 'customers', label: 'Clientes y saldos' },
];

export function ImportFileStep() {
  const pick = (file: File | undefined): void => {
    if (file !== undefined) void loadImportFile(file);
  };
  const onChange = (e: JSX.TargetedEvent<HTMLInputElement, Event>): void => pick(e.currentTarget.files?.[0]);
  const onDrop = (e: JSX.TargetedDragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    pick(e.dataTransfer?.files[0]);
  };
  return (
    <div class="space-y-4">
      <div role="radiogroup" aria-label="Qué importar" class="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl">
        {ENTITIES.map((e) => (
          <button
            key={e.value}
            type="button"
            role="radio"
            aria-checked={importEntitySignal.value === e.value}
            onClick={() => (importEntitySignal.value = e.value)}
            class={`py-1.5 rounded-lg text-xs font-bold transition-colors cursor-pointer ${
              importEntitySignal.value === e.value ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
            }`}
          >
            {e.label}
          </button>
        ))}
      </div>
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        class="border-2 border-dashed border-slate-300 dark:border-slate-700 rounded-2xl p-6 text-center space-y-2"
      >
        <label class="inline-block cursor-pointer text-sm font-semibold text-indigo-600 dark:text-indigo-400 underline">
          {importLoadingSignal.value ? 'Leyendo…' : 'Elegí el archivo'}
          <input type="file" accept=".csv,text/csv,text/plain" class="sr-only" onChange={onChange} />
        </label>
        <p class="text-xs text-slate-500 dark:text-slate-400">o arrastralo acá</p>
      </div>
      <p class="text-xs text-slate-500 dark:text-slate-400">
        Exportalo desde Excel como CSV. La primera fila tiene que tener los nombres de las columnas, en cualquier
        orden. Saldo positivo: el cliente te debe.
      </p>
    </div>
  );
}
```

`ImportMappingStep.tsx`: "Falta asignar" y una fila por columna con su `Select`:

```tsx
import { Select } from '../ui/Select.tsx';
import { importMappingSignal, setColumnField } from '../../state/import-state.ts';
import {
  CUSTOMER_FIELDS, PRODUCT_FIELDS, STOCK_UNASSIGNED, fieldLabel, isImportFieldName, stockField, type ImportField, type ImportPreview,
} from '../../../shared/import-fields.ts';

export function ImportMappingStep(props: { preview: ImportPreview }) {
  const { preview } = props;
  const mapping = importMappingSignal.value;
  const options: ImportField[] = preview.entity === 'customers'
    ? CUSTOMER_FIELDS.map((f) => f.field)
    : [...PRODUCT_FIELDS.map((f) => f.field), ...preview.branches.map((b) => stockField(b.id))];
  return (
    <div class="space-y-3">
      {preview.missing.length > 0 && (
        <p class="text-sm text-amber-700 dark:text-amber-400">
          {`Falta asignar: ${preview.missing.map((f) => fieldLabel(f, preview.branches)).join(', ')}`}
        </p>
      )}
      {preview.needsBranch.length > 0 && (
        <p class="text-sm text-amber-700 dark:text-amber-400">Elegí a qué sucursal va cada columna de stock.</p>
      )}
      <div class="divide-y divide-slate-200 dark:divide-slate-800">
        {preview.columns.map((c) => {
          const current = mapping[String(c.index)] ?? null;
          return (
            <div key={c.index} class="grid grid-cols-1 sm:grid-cols-2 gap-2 py-2 items-center">
              <div>
                <div class="text-sm font-semibold text-slate-900 dark:text-white">{c.header || `Columna ${String(c.index + 1)}`}</div>
                <div class="text-xs text-slate-500 dark:text-slate-400 truncate">{c.samples.filter((s) => s !== '').join(' · ')}</div>
              </div>
              <Select
                aria-label={`Campo de ${c.header}`}
                value={current ?? ''}
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  setColumnField(c.index, v === '' || !isImportFieldName(v) ? null : v);
                }}
              >
                <option value="">No importar</option>
                {current === STOCK_UNASSIGNED && <option value={STOCK_UNASSIGNED}>{fieldLabel(STOCK_UNASSIGNED, preview.branches)}</option>}
                {options.map((f) => (
                  <option key={f} value={f}>{fieldLabel(f, preview.branches)}</option>
                ))}
              </Select>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

`ImportResultTable.tsx`: totales y tabla con filtro:

```tsx
import { importOnlyIssuesSignal } from '../../state/import-state.ts';
import { formatQty } from '../../format.ts';
import type { ImportPreview, ImportRowAction } from '../../../shared/import-fields.ts';

const LABELS: Record<ImportRowAction, string> = { create: 'Se crea', update: 'Se actualiza', unchanged: 'Sin cambios', error: 'Error' };
const TONES: Record<ImportRowAction, string> = {
  create: 'text-emerald-700 dark:text-emerald-400', update: 'text-indigo-700 dark:text-indigo-400',
  unchanged: 'text-slate-500 dark:text-slate-400', error: 'text-rose-700 dark:text-rose-400',
};

export function ImportResultTable(props: { preview: ImportPreview }) {
  const { preview } = props;
  const rows = importOnlyIssuesSignal.value ? preview.rows.filter((r) => r.action === 'error' || r.messages.length > 0) : preview.rows;
  const t = preview.totals;
  return (
    <div class="space-y-3">
      <p class="text-sm text-slate-700 dark:text-slate-300">
        {preview.dryRun ? 'Vista previa: ' : 'Listo: '}
        {`${formatQty(t.create)} nuevos · ${formatQty(t.update)} actualizados · ${formatQty(t.unchanged)} sin cambios · ${formatQty(t.error)} con errores`}
      </p>
      <label class="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <input type="checkbox" checked={importOnlyIssuesSignal.value} onChange={(e) => (importOnlyIssuesSignal.value = e.currentTarget.checked)} />
        Solo errores y avisos
      </label>
      <div class="max-h-80 overflow-auto border border-slate-200 dark:border-slate-800 rounded-xl">
        <table class="w-full text-sm">
          <thead class="text-xs text-left text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-950 sticky top-0">
            <tr><th class="px-3 py-2">Línea</th><th class="px-3 py-2">Clave</th><th class="px-3 py-2">Acción</th><th class="px-3 py-2">Detalle</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.line} class="border-t border-slate-100 dark:border-slate-800">
                <td class="px-3 py-1.5 tabular-nums">{r.line}</td>
                <td class="px-3 py-1.5">{r.key}</td>
                <td class={`px-3 py-1.5 font-semibold ${TONES[r.action]}`}>{LABELS[r.action]}</td>
                <td class="px-3 py-1.5 text-xs">{r.messages.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

`BulkView.tsx`: `{activeTab === 'io' && (<div class="space-y-6"><ImportExportCard /><ImportWizard /></div>)}`.
`ImportExportCard.tsx`: borrar la "SECCIÓN 2: IMPORTACIÓN MASIVA" y los imports de `bulk-state` que
queden sin uso. Si la pestaña dice "Importar / Exportar" o similar, se deja.

- [ ] **Paso 5: correr tests, lint y build**

Run: `pnpm vitest run test/import-client.test.ts test/bulk-client.test.ts` — Esperado: PASS.
Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build` — Esperado: todo en verde.

- [ ] **Paso 6: commit**

```bash
git add src/client/state/import-state.ts src/client/components/import src/client/components/bulk/ImportExportCard.tsx src/client/components/bulk/BulkView.tsx src/client/state/bulk-state.ts test/import-client.test.ts test/bulk-client.test.ts
git commit -m "feat: asistente de importación con mapeo y vista previa en Operaciones masivas (#22)"
```

---

### Tarea 7: Alta en el servidor — WhatsApp, rubro y comercio vacío

**Archivos:**
- Crear: `src/shared/business-type.ts`, `src/shared/whatsapp.ts`,
  `src/server/db/migrations/system/v6-alta-whatsapp-rubro.ts`, `test/system-migration-v6.test.ts`
- Modificar: `src/server/db/migrations/system.ts` (lista), `src/server/auth/auth-service.ts`
  (`createUser` con `whatsapp?`), `src/server/db/tenant-manager.ts` (`businessType` en
  `createTenant`; `getBusinessType`), `src/server/alta/alta-service.ts`, `src/server/routes/alta-routes.ts`,
  `src/server/routes/io-routes.ts` (`/catalog/example`), `src/server/app.ts` (pasar `tenantManager` a
  `createIoRoutes`), `src/server/io/import-export-service.ts` (`countProducts`),
  `src/server/db/dev-seed.ts` (rubro), `test/alta-api.test.ts`, `test/permissions-api.test.ts`,
  `e2e/sales-cash.spec.ts`, `e2e/roles-invitations.spec.ts`
- Test: `test/system-migration-v6.test.ts`, `test/alta-api.test.ts`, `test/catalog-example-api.test.ts` (nuevo)

**Interfaces:**
- Produce:
  - `BUSINESS_TYPES = ['kiosco', 'almacen', 'ferreteria', 'otro'] as const`, `type BusinessType`,
    `BUSINESS_TYPE_LABELS: Record<BusinessType, string>`,
    `hasExampleCatalog(t: BusinessType | null): t is 'kiosco' | 'almacen' | 'ferreteria'`
  - `normalizeWhatsapp(raw: string): string | undefined` y `WHATSAPP_MESSAGE = 'Escribí un WhatsApp con código de área (8 a 15 números)'`
  - `POST /api/alta` con `{ businessName, businessType }` y, sin sesión, `{ name, email, password, whatsapp }`
  - `GET /api/tenants/:tenantId/catalog/example` → `{ businessType: BusinessType | null; available: boolean }` (`bulk`)
  - `POST /api/tenants/:tenantId/catalog/example` → `{ productsCreated: number }` (`bulk`; `409` sin catálogo de ejemplo)
  - `TenantManager.getBusinessType(tenantId: string): BusinessType | null`

- [ ] **Paso 1: test de la migración**

```ts
// test/system-migration-v6.test.ts
import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

describe('migración de sistema v6 alta-whatsapp-rubro (#22)', () => {
  it('suma users.whatsapp y tenants.business_type nulos, y los datos sobreviven', () => {
    const db = createDbAtVersion(SYSTEM_SCHEMA, 5);
    const at = '2026-10-01T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'a@x.com', 'h', 'Ana', 'user', ?)").run(at);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES ('k', 'k', 'Kiosco', ?, 'u1')").run(at);
    migrateDb(db, SYSTEM_SCHEMA);
    expect(db.prepare('SELECT id, name, whatsapp FROM users').all()).toEqual([{ id: 'u1', name: 'Ana', whatsapp: null }]);
    expect(db.prepare('SELECT id, holder_user_id, business_type FROM tenants').all()).toEqual([{ id: 'k', holder_user_id: 'u1', business_type: null }]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
  });
});
```

Run: `pnpm vitest run test/system-migration-v6.test.ts` — Esperado: FAIL.

- [ ] **Paso 2: la migración**

```ts
// src/server/db/migrations/system/v6-alta-whatsapp-rubro.ts
import type { Migration } from '../types.ts';

/** Alta (#22): el WhatsApp del responsable y el rubro del comercio. Nulos en los que ya existen. */
export const v6AltaWhatsappRubro: Migration = {
  version: 6,
  name: 'alta-whatsapp-rubro',
  up: (db) => {
    db.exec(`
ALTER TABLE users ADD COLUMN whatsapp TEXT;
ALTER TABLE tenants ADD COLUMN business_type TEXT;
`);
  },
};
```

En `system.ts`: `migrations: [v5CreditosYCobro, v6AltaWhatsappRubro],` con su import. Correr el test
de la migración y `test/migrations.test.ts`, `test/run-migrations.test.ts` (que pueden fijar la
versión esperada de sistema: actualizar a 6 donde corresponda).

- [ ] **Paso 3: tests del alta y del catálogo de ejemplo**

En `test/alta-api.test.ts`:
- `const alta = { name: 'Marta', email: 'marta@kiosco.com', password: 'clave-segura', whatsapp: '+54 9 11 5555-1234', businessName: 'Kiosco Marta', businessType: 'kiosco' };`
- El primer test pasa a "crea cuenta, comercio **vacío** con su rubro, owner y key de Caja 1…":
  `products.n` es `0`, y además
  `expect(systemDb.prepare('SELECT business_type FROM tenants WHERE id = ?').get('kiosco-marta')).toEqual({ business_type: 'kiosco' })` y
  `expect(systemDb.prepare('SELECT whatsapp FROM users WHERE email = ?').get('marta@kiosco.com')).toEqual({ whatsapp: '5491155551234' })`.
- El test de `'empty'` pasa a: "un rubro desconocido da 400" (`businessType: 'empty'` → 400).
- Nuevo: "sin WhatsApp o con uno inválido, 400 y no crea nada" (`whatsapp: ''` y `whatsapp: '123'`).
- Nuevo: "con sesión no pide WhatsApp" (el test existente "con sesión crea otro comercio…" manda
  `{ businessName: 'Ferretería Marta', businessType: 'ferreteria' }`).

```ts
// test/catalog-example-api.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('catálogo de ejemplo del rubro (#22)', () => {
  let app: Express;
  let tenants: TenantManager;
  let token: string;

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    tenants = new TenantManager(systemDb, { inMemory: true });
    app = createApp({ systemDb, tenantManager: tenants }).app;
    const res = await request(app).post('/api/alta').send({
      name: 'Marta', email: 'm@x.com', password: 'clave-segura', whatsapp: '1155551234', businessName: 'Almacén Marta', businessType: 'almacen',
    });
    token = (res.body as { token: string }).token;
  });

  const auth = () => ({ Authorization: `Bearer ${token}` });

  it('disponible con rubro y sin productos; se aplica una vez y deja de estar disponible', async () => {
    expect((await request(app).get('/api/tenants/almacen-marta/catalog/example').set(auth())).body).toEqual({ businessType: 'almacen', available: true });
    const first = await request(app).post('/api/tenants/almacen-marta/catalog/example').set(auth());
    expect(first.status).toBe(200);
    expect((first.body as { productsCreated: number }).productsCreated).toBeGreaterThan(0);
    expect((await request(app).post('/api/tenants/almacen-marta/catalog/example').set(auth())).body).toEqual({ productsCreated: 0 });
    expect((await request(app).get('/api/tenants/almacen-marta/catalog/example').set(auth())).body).toEqual({ businessType: 'almacen', available: false });
  });

  it('con rubro "otro": no disponible y 409', async () => {
    const res = await request(app).post('/api/alta').set(auth()).send({ businessName: 'Otro Marta', businessType: 'otro' });
    const id = (res.body as { tenant: { id: string } }).tenant.id;
    expect((await request(app).get(`/api/tenants/${id}/catalog/example`).set(auth())).body).toEqual({ businessType: 'otro', available: false });
    expect((await request(app).post(`/api/tenants/${id}/catalog/example`).set(auth())).status).toBe(409);
  });
});
```

En `test/permissions-api.test.ts`, sumar a la tabla:
`'GET /catalog/example': 'bulk'` y `'POST /catalog/example': 'bulk'`.

Run: `pnpm vitest run test/alta-api.test.ts test/catalog-example-api.test.ts test/permissions-api.test.ts` — Esperado: FAIL.

- [ ] **Paso 4: implementar**

`src/shared/business-type.ts`:

```ts
/** El rubro del comercio (#22): elige el catálogo de ejemplo y sirve para el embudo (M8). */
export const BUSINESS_TYPES = ['kiosco', 'almacen', 'ferreteria', 'otro'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];
export type ExampleCatalog = Exclude<BusinessType, 'otro'>;

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  kiosco: 'Kiosco', almacen: 'Almacén', ferreteria: 'Ferretería', otro: 'Otro',
};

export function isBusinessType(v: string): v is BusinessType {
  return (BUSINESS_TYPES as readonly string[]).includes(v);
}

export function hasExampleCatalog(t: BusinessType | null): t is ExampleCatalog {
  return t !== null && t !== 'otro';
}
```

`src/shared/whatsapp.ts`:

```ts
export const WHATSAPP_MESSAGE = 'Escribí un WhatsApp con código de área (8 a 15 números)';

/** Solo los dígitos (sin espacios, guiones, paréntesis ni `+`), entre 8 y 15; si no, `undefined`. */
export function normalizeWhatsapp(raw: string): string | undefined {
  const digits = raw.replace(/[\s\-()+.]/g, '');
  return /^\d{8,15}$/.test(digits) ? digits : undefined;
}
```

`AuthService.createUser(params: { email: string; password: string; name: string; whatsapp?: string | undefined })`:
el `INSERT` suma la columna `whatsapp` con `params.whatsapp ?? null`.

`TenantManager`: `CreateTenantParams` suma `businessType?: BusinessType | undefined`; el `INSERT INTO
tenants` suma `business_type` (`params.businessType ?? null`). Nuevo método:

```ts
  getBusinessType(tenantId: string): BusinessType | null {
    const row = this.systemDb.prepare('SELECT business_type FROM tenants WHERE id = ?').get(tenantId) as { business_type: string | null } | undefined;
    const value = row?.business_type ?? null;
    return value !== null && isBusinessType(value) ? value : null;
  }
```

`AltaService.create`: `account?: { name; email; password; whatsapp: string }`, `businessType:
BusinessType` en lugar de `template`; `createTenant({ ..., businessType: params.businessType })`;
borrar el `applyPreset` y el import; la auditoría pasa a `details: { businessType: params.businessType }`.
Borrar `AltaTemplate` del servicio.

`alta-routes.ts`:

```ts
const businessSchema = z.object({
  businessName: z.string().trim().min(2, 'Escribí el nombre de tu comercio'),
  businessType: z.enum(BUSINESS_TYPES, { errorMap: () => ({ message: 'Elegí el rubro de tu comercio' }) }),
});

const accountSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres'),
  email: z.string().trim().email('Email inválido'),
  password: passwordSchema,
  whatsapp: z.string().transform((v, ctx) => {
    const n = normalizeWhatsapp(v);
    if (n === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: WHATSAPP_MESSAGE });
      return z.NEVER;
    }
    return n;
  }),
});
```

`ImportExportService.countProducts(): number` (`SELECT COUNT(*) AS n FROM products`).

`io-routes.ts`: `createIoRoutes(tenants: TenantManager)` y en `app.ts` `createIoRoutes(tenantManager)`
(usar el nombre de la variable que ya está en `createApp`):

```ts
  // Catálogo de ejemplo del rubro (#22): disponible mientras el comercio no tenga productos
  router.get('/catalog/example', requirePermission('bulk'), (req: AuthenticatedAdminRequest, res: Response) => {
    const businessType = tenants.getBusinessType(req.activeTenantId ?? '');
    const service = getImportExportService(req);
    res.status(200).json({ businessType, available: hasExampleCatalog(businessType) && service.countProducts() === 0 });
  });

  router.post('/catalog/example', requirePermission('bulk'), (req: AuthenticatedAdminRequest, res: Response) => {
    const businessType = tenants.getBusinessType(req.activeTenantId ?? '');
    if (!hasExampleCatalog(businessType)) {
      res.status(409).json({ error: 'Tu rubro no tiene catálogo de ejemplo' });
      return;
    }
    res.status(200).json({ productsCreated: getImportExportService(req).applyBusinessPreset(businessType).productsCreated });
  });
```

`dev-seed.ts`: después de `createTenant`, guardar el rubro (pasar `businessType: t.preset` a
`createTenant`; `t.preset` es `BusinessPreset` = `'kiosco' | 'ferreteria' | 'almacen'`, asignable a
`BusinessType`). El seed es idempotente: si el comercio ya existía (de antes de M6), completar con
`UPDATE tenants SET business_type = ? WHERE id = ? AND business_type IS NULL`.

e2e: en `sales-cash.spec.ts` y `roles-invitations.spec.ts`, el cuerpo del alta pasa a
`businessType: 'kiosco', whatsapp: '1155550000'` (sin `template`). En `sales-cash.spec.ts`, antes de
pedir los productos:
`await request.post(`/api/tenants/${tenant.id}/catalog/example`, { headers: { Authorization: `Bearer ${token}` } });`

- [ ] **Paso 5: correr los tests**

Run: `pnpm vitest run test/alta-api.test.ts test/catalog-example-api.test.ts test/permissions-api.test.ts test/system-migration-v6.test.ts test/bootstrap.test.ts` — Esperado: PASS.

- [ ] **Paso 6: verificación completa y commit**

Los tests de cliente del alta (`merchant-onboarding`, `onboarding-wizard`) mockean `fetch`: siguen en
verde aunque manden `template`; los arregla la tarea 8.

```bash
pnpm lint && pnpm typecheck && pnpm test
git add src/shared/business-type.ts src/shared/whatsapp.ts src/server/db/migrations src/server/auth/auth-service.ts src/server/db/tenant-manager.ts src/server/alta/alta-service.ts src/server/routes/alta-routes.ts src/server/routes/io-routes.ts src/server/app.ts src/server/io/import-export-service.ts src/server/db/dev-seed.ts test/system-migration-v6.test.ts test/alta-api.test.ts test/catalog-example-api.test.ts test/permissions-api.test.ts e2e/sales-cash.spec.ts e2e/roles-invitations.spec.ts
git commit -m "feat: alta con WhatsApp y rubro, comercio vacío y catálogo de ejemplo aparte (#22)"
```

---

### Tarea 8: Alta en el cliente — "Cargá tus datos"

**Archivos:**
- Modificar: `src/client/state/merchant-onboarding-state.ts`,
  `src/client/components/onboarding/MerchantOnboardingView.tsx`, `src/client/state/onboarding-state.ts`,
  `src/client/components/shell/OnboardingModal.tsx`, `src/client/components/auth/AuthView.tsx` (si usa
  `BusinessPreset`), `src/client/components/bulk/BulkView.tsx` (botón del catálogo de ejemplo),
  `e2e/demo-onboarding.spec.ts`
- Crear: `src/client/state/example-catalog-state.ts`
- Test: `test/merchant-onboarding.test.ts`, `test/onboarding-wizard.test.ts`, `test/example-catalog-client.test.ts` (nuevo)

**Interfaces:**
- Consume: `BusinessType`, `BUSINESS_TYPE_LABELS`, `hasExampleCatalog` (tarea 7), `normalizeWhatsapp`,
  `WHATSAPP_MESSAGE`; `ImportWizard` y `resetImport` (tarea 6); `GET`/`POST /catalog/example`.
- Produce:
  - Pasos del alta: `1` cuenta, `2` comercio, `3` creando, `4` cargá tus datos, `5` listo
    (`LOAD_STEP = 4`, `DONE_STEP = 5` exportados de `merchant-onboarding-state.ts`).
  - `userWhatsappSignal`, `selectedBusinessTypeSignal: Signal<BusinessType>` (reemplaza a
    `selectedMerchantPresetSignal`), `loadModeSignal: Signal<'choose' | 'files'>`.
  - `chooseUploadFiles(): void`, `useExampleCatalog(): Promise<void>`, `skipLoadStep(): void`.
  - `MerchantProvisionResult.preset` pasa a `businessType: BusinessType`.
  - `example-catalog-state.ts`: `exampleCatalogSignal: Signal<{ businessType: BusinessType | null; available: boolean } | null>`,
    `fetchExampleCatalog(): Promise<void>`, `applyExampleCatalog(): Promise<number | null>`.

- [ ] **Paso 1: tests del estado**

En `test/merchant-onboarding.test.ts`:
- Paso 1: "valida campos obligatorios…" suma el caso WhatsApp inválido (`userWhatsappSignal.value =
  '123'` → `errorMessageSignal.value === WHATSAPP_MESSAGE`, sigue en el paso 1).
- El test del aprovisionamiento completo espera el cuerpo
  `{ name, email, password, whatsapp: '11 5555-1234', businessName, businessType: 'kiosco' }` (el
  servidor normaliza) y que, al terminar, `merchantStepSignal.value === LOAD_STEP` (antes 4 = listo).
- "con sesión manda solo el comercio": `{ businessName, businessType }`.
- `readAltaParams` con `template=almacen` preselecciona `selectedBusinessTypeSignal` en `almacen`.
- Nuevos:

```ts
  describe('Paso 4 · Cargá tus datos (#22)', () => {
    it('el catálogo de ejemplo llama a POST /catalog/example y pasa a Listo', async () => {
      merchantStepSignal.value = LOAD_STEP;
      merchantResultSignal.value = { ...resultFixture, tenantId: 'kiosco-marta', businessType: 'kiosco' };
      const calls: string[] = [];
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        calls.push(url);
        return Promise.resolve(new Response(JSON.stringify({ productsCreated: 40 }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });
      await useExampleCatalog();
      expect(calls).toEqual(['/api/tenants/kiosco-marta/catalog/example']);
      expect(merchantStepSignal.value).toBe(DONE_STEP);
    });

    it('subir archivos muestra el asistente; "Lo hago después" pasa a Listo', () => {
      merchantStepSignal.value = LOAD_STEP;
      chooseUploadFiles();
      expect(loadModeSignal.value).toBe('files');
      skipLoadStep();
      expect(merchantStepSignal.value).toBe(DONE_STEP);
    });

    it('desde el paso 4 no se vuelve al 2', () => {
      merchantStepSignal.value = LOAD_STEP;
      goBackMerchantStep();
      expect(merchantStepSignal.value).toBe(LOAD_STEP);
    });
  });
```

(`resultFixture` = un `MerchantProvisionResult` completo armado al principio del archivo.)

En `test/onboarding-wizard.test.ts`: el cuerpo esperado pasa a `{ businessName, businessType: 'kiosco' }`.

```ts
// test/example-catalog-client.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { exampleCatalogSignal, fetchExampleCatalog, applyExampleCatalog } from '../src/client/state/example-catalog-state.ts';
import { tokenSignal, activeTenantIdSignal } from '../src/client/state/auth-state.ts';

const json = (body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));

describe('catálogo de ejemplo en Operaciones masivas (#22)', () => {
  beforeEach(() => {
    tokenSignal.value = 'tok';
    activeTenantIdSignal.value = 't1';
    exampleCatalogSignal.value = null;
  });

  it('pregunta si está disponible y, al aplicarlo, deja de estarlo', async () => {
    globalThis.fetch = vi.fn()
      .mockImplementationOnce(() => json({ businessType: 'kiosco', available: true }))
      .mockImplementationOnce(() => json({ productsCreated: 40 }));
    await fetchExampleCatalog();
    expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: true });
    expect(await applyExampleCatalog()).toBe(40);
    expect(exampleCatalogSignal.value).toEqual({ businessType: 'kiosco', available: false });
  });
});
```

Run: `pnpm vitest run test/merchant-onboarding.test.ts test/onboarding-wizard.test.ts test/example-catalog-client.test.ts` — Esperado: FAIL.

- [ ] **Paso 2: estado del alta**

En `merchant-onboarding-state.ts`:
- `export const LOAD_STEP = 4; export const DONE_STEP = 5;`
- `userWhatsappSignal = signal('')`; `selectedBusinessTypeSignal = signal<BusinessType>('kiosco')`
  (reemplaza a `selectedMerchantPresetSignal` en todos los usos); `loadModeSignal = signal<'choose' | 'files'>('choose')`.
- `readAltaParams` sigue devolviendo `template` (es el parámetro del POS); `initMerchantOnboardingFromUrl`
  asigna `selectedBusinessTypeSignal.value = template`.
- Paso 1 (cuenta nueva): después de la contraseña,
  `if (normalizeWhatsapp(userWhatsappSignal.value) === undefined) { errorMessageSignal.value = WHATSAPP_MESSAGE; return; }`.
- `executeMerchantProvisioning`: mensaje "Creando tu comercio y la conexión de tu caja..."; cuerpo con
  `businessType: selectedBusinessTypeSignal.value` y, sin sesión, `whatsapp: userWhatsappSignal.value.trim()`;
  `merchantResultSignal` con `businessType`; al terminar `merchantStepSignal.value = LOAD_STEP` y
  `loadModeSignal.value = 'choose'`, más `resetImport()`.
- `goBackMerchantStep`: solo baja de 2 a 1 (como hoy); en `LOAD_STEP` no hace nada.
- Nuevas:

```ts
export function chooseUploadFiles(): void {
  resetImport();
  loadModeSignal.value = 'files';
}

export function skipLoadStep(): void {
  merchantStepSignal.value = DONE_STEP;
}

/** El catálogo de ejemplo del rubro elegido (#22): el comercio nació vacío. */
export async function useExampleCatalog(): Promise<void> {
  const res = merchantResultSignal.value;
  const token = tokenSignal.value;
  if (res === null || !token) return;
  isSubmittingSignal.value = true;
  errorMessageSignal.value = null;
  try {
    await apiFetch<{ productsCreated: number }>(`tenants/${res.tenantId}/catalog/example`, { method: 'POST', token });
    merchantStepSignal.value = DONE_STEP;
  } catch (err: unknown) {
    errorMessageSignal.value = err instanceof Error ? err.message : 'No se pudo cargar el catálogo de ejemplo';
  } finally {
    isSubmittingSignal.value = false;
  }
}
```

> `useExampleCatalog` empieza con `use` y el lint de hooks podría confundirlo con un hook. Si
> `eslint-plugin-react-hooks` lo marca, llamarla `applyExampleCatalogOnSignup` (y en los tests).

- [ ] **Paso 3: vista del alta**

En `MerchantOnboardingView.tsx`:
- El stepper muestra 4 etapas visibles: "Tu cuenta" (1), "Tu comercio" (2), "Cargá tus datos" (4) y
  "Listo" (5); el 3 es la pantalla de "creando".
- Paso 1: campo "WhatsApp" (`type="tel"`, `autocomplete="tel"`, placeholder `Ej: 11 5555-1234`,
  ayuda "Para ayudarte a empezar. No mandamos mensajes automáticos.") ligado a `userWhatsappSignal`,
  solo en la cuenta nueva.
- Paso 2: título "Tu comercio"; las cuatro tarjetas de rubro con `BUSINESS_TYPE_LABELS` (Kiosco,
  Almacén, Ferretería, Otro) en lugar de las plantillas; el botón dice "Crear mi comercio".
- Paso 4 (`LOAD_STEP`), con `loadModeSignal === 'choose'`: título "Cargá tus datos" y tres tarjetas:
  - "Subir mis archivos" → `chooseUploadFiles()`; texto "Productos y stock, o clientes y saldos, desde
    un CSV de Excel o de tu sistema."
  - "Empezar con el catálogo de ejemplo de {BUSINESS_TYPE_LABELS[businessType]}" →
    `useExampleCatalog()` (solo si `hasExampleCatalog(result.businessType)`); texto "Lo corregís
    después: precios, nombres y stock."
  - "Relevar escaneando" deshabilitada, con la etiqueta "Próximamente".
  - Un botón `ghost` "Lo hago después" → `skipLoadStep()`.
  Con `loadModeSignal === 'files'`: `<ImportWizard onDone={skipLoadStep} />` y un botón "Volver" que
  pone `loadModeSignal.value = 'choose'`.
- Paso 5 (`DONE_STEP`): el contenido del paso 4 de hoy (key, volver al POS, entrar al admin).
- El pie con "Continuar"/"Crear mi comercio" se muestra solo en los pasos 1 y 2.

- [ ] **Paso 4: "Crear nuevo comercio…" y Operaciones masivas**

`onboarding-state.ts`: `selectedPresetSignal` pasa a `signal<BusinessType>('kiosco')` y el cuerpo a
`{ businessName: name, businessType: selectedPresetSignal.value }`; borrar `BusinessPreset` (o dejarlo
como alias de `BusinessType` si `AuthView` lo usa y el cambio crece; preferir borrarlo).
`OnboardingModal.tsx`: las opciones de rubro con `BUSINESS_TYPE_LABELS`; el paso final suma "Cargá tus
productos y clientes desde Operaciones masivas: un archivo o el catálogo de ejemplo."

`example-catalog-state.ts`:

```ts
import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import type { BusinessType } from '../../shared/business-type.ts';

export const exampleCatalogSignal = signal<{ businessType: BusinessType | null; available: boolean } | null>(null);

export async function fetchExampleCatalog(): Promise<void> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return;
  try {
    exampleCatalogSignal.value = await apiFetch(`tenants/${tenantId}/catalog/example`, { token });
  } catch {
    exampleCatalogSignal.value = null;
  }
}

export async function applyExampleCatalog(): Promise<number | null> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return null;
  try {
    const res = await apiFetch<{ productsCreated: number }>(`tenants/${tenantId}/catalog/example`, { method: 'POST', token });
    const current = exampleCatalogSignal.value;
    exampleCatalogSignal.value = { businessType: current?.businessType ?? null, available: false };
    showToast({ type: 'success', title: 'Catálogo de ejemplo', message: `Se cargaron ${String(res.productsCreated)} productos` });
    return res.productsCreated;
  } catch (err: unknown) {
    showToast({ type: 'error', title: 'Error', message: err instanceof Error ? err.message : 'No se pudo cargar el catálogo de ejemplo' });
    return null;
  }
}
```

> `apiFetch` sin genérico explícito infiere `unknown`: tiparlo
> `apiFetch<{ businessType: BusinessType | null; available: boolean }>(…)`.

`BulkView.tsx`, en la pestaña `io`: si `exampleCatalogSignal.value?.available`, una `Card` chica arriba
del asistente: "¿Querés empezar con el catálogo de ejemplo de {rubro}?" con el botón "Cargar el
catálogo de ejemplo" → `applyExampleCatalog()`. `fetchExampleCatalog()` se llama al entrar a la
pestaña `io` (en el `onClick` de esa pestaña en `BulkTabs.tsx` y cuando `BulkView` arranca con `io`,
siguiendo cómo el resto de las vistas cargan datos al navegar: revisar `navigation-state.ts`).

- [ ] **Paso 5: e2e**

`e2e/demo-onboarding.spec.ts`, después de la contraseña:
`await page.getByPlaceholder('Ej: 11 5555-1234').fill('1155550000');`, botón
`'Continuar a Datos del Negocio →'` → el nombre que tenga ahora (ajustar), botón
`/Crear mi comercio/`, y después `await page.getByRole('button', { name: /catálogo de ejemplo de Kiosco/ }).click();`
antes de `Vas a volver a…`.

- [ ] **Paso 6: verificación completa**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm test:e2e
```

Esperado: todo en verde.

- [ ] **Paso 7: commit**

```bash
git add src/client test e2e
git commit -m "feat: alta con WhatsApp, rubro y el paso Cargá tus datos (#22)"
```

---

### Tarea 9: Cierre — AGENTS.md, versión y plan

**Archivos:**
- Modificar: `AGENTS.md`, `package.json` (versión), `docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md` (no se toca)
- Borrar: `docs/superpowers/plans/2026-10-03-m6-importacion.md`

- [ ] **Paso 1: AGENTS.md**

- En "Arquitectura", un bloque nuevo **Importación** (#22, spec
  `docs/superpowers/specs/2026-10-03-m6-importacion-design.md`):
  - El servidor parsea, sugiere y valida, sin estado (`POST /import/:entity` con `{ csv, mapping?, dryRun }`);
    la vista previa corre igual dentro de un `SAVEPOINT` y se deshace.
  - Parser común en `src/server/io/csv.ts` (lo usa también la planilla de cobranzas); campos y tipos
    en `src/shared/import-fields.ts`; sinónimos en `src/server/io/suggest-mapping.ts`.
  - Clientes por id, documento (sin puntos ni guiones) o nombre normalizado; productos por código de
    barras, SKU o nombre. El saldo inicial es un movimiento `opening` ("Saldo inicial (importado)") y
    se corrige al reimportar solo si todos los movimientos son `opening`. El stock se fija por
    sucursal con `inventory_count` (`stock/write-stock.ts`).
  - El cliente decodifica UTF-8 o Windows-1252 (`decodeCsvBytes`).
- En el bloque del alta (Roles e invitaciones / "Sin registro suelto" y Demos): el alta pide WhatsApp
  (solo dígitos, `users.whatsapp`) y rubro (`tenants.business_type`, migración de sistema v6), crea el
  comercio vacío y sigue con "Cargá tus datos"; el catálogo de ejemplo es
  `POST /catalog/example`. Sin CUIT ni datos fiscales hasta la facturación.
- "Migraciones de esquema": la línea de base no cambia; sistema llega a v6.
- "Estado": M6 (#22) hecha.

- [ ] **Paso 2: versión**

```bash
pnpm version minor --no-git-tag-version
```

Esperado: `package.json` en `0.8.0`.

- [ ] **Paso 3: borrar el plan y verificar**

```bash
git rm docs/superpowers/plans/2026-10-03-m6-importacion.md
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] **Paso 4: commit**

```bash
git add AGENTS.md package.json
git commit -m "docs: importación y alta en AGENTS.md, borrar el plan de M6 y versión 0.8.0 (#22)"
```

- [ ] **Paso 5: informe final con prueba manual** (checklist con la carpeta del worktree y la rama
  como paso 1; cada paso con acción y verificación):
  1. Worktree `C:\dev\mini-erp\.claude\worktrees\m6-import-column-mapping-8a3b48`, rama
     `claude/m6-importacion`; `pnpm dev`.
  2. Entrar como `dueno-a@local.test` (Kiosco) → Operaciones masivas → Importar/Exportar.
  3. Un CSV de clientes con `;`, coma decimal y encabezados propios (incluido en el informe, para
     guardarlo desde el Bloc de notas como ANSI y probar Windows-1252) → mapeo sugerido → vista previa →
     importar → Clientes → extracto con "Saldo inicial".
  4. Importar el mismo archivo otra vez → "sin cambios".
  5. Un CSV de productos con "Stock Central" → stock en el kardex; reimportar → sin cambios.
  6. `/alta` sin sesión → WhatsApp, rubro Almacén → "Cargá tus datos" → catálogo de ejemplo → Listo.
  7. `/alta` otra vez → "Subir mis archivos" → importar el CSV de productos.
  8. Como `empleado-k@local.test`: Operaciones masivas no aparece.
  Después, con aprobación: push y PR con "Closes #22".
