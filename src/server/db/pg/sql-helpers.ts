import { sql, type Expression, type RawBuilder, type Transaction } from 'kysely';

/**
 * Un valor para una columna `jsonb`. `pg` convierte un array de JavaScript en un array de
 * PostgreSQL, no en JSON: por eso lo que va a `jsonb` se serializa siempre acá.
 */
export function jsonValue(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => (typeof item === 'string' ? item.replaceAll(NUL, '') : item));
}

const NUL = '\u0000';

/**
 * Lo mismo, sin el carácter nulo (U+0000) en ningún texto, clave o valor: PostgreSQL no lo admite
 * ni en `text` ni en `jsonb`. El push limpia así el lote entero antes de guardarlo y de aplicarlo.
 */
export function stripNul<T>(value: T): T;
export function stripNul(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replaceAll(NUL, '');
  }
  if (Array.isArray(value)) {
    const items: unknown[] = value;
    return items.map((item) => stripNul(item));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [key.replaceAll(NUL, ''), stripNul(item)]));
  }
  return value;
}

/**
 * El día argentino de un instante (#20): UTC−3 fijo, igual que `argentinaDay` de
 * `src/shared/argentina-day.ts`. No depende de la zona de la sesión ni de `tzdata`.
 */
export function argentinaDay(instant: Expression<string | null>): RawBuilder<string> {
  return sql<string>`((${instant} - interval '3 hours') AT TIME ZONE 'UTC')::date`;
}

/**
 * Un texto listo para buscar sin distinguir mayúsculas ni tildes (`unaccent` vive en `public`).
 * Se compara contra `searchPattern()`: `where(searchable(ref('name')), 'like', searchPattern(q))`.
 */
export function searchable(expr: Expression<string | null>): RawBuilder<string> {
  return sql<string>`lower(public.unaccent(${expr}))`;
}

/** El patrón de `LIKE` para "contiene", con los comodines del usuario escapados. */
export function searchPattern(query: string): RawBuilder<string> {
  const escaped = query.replace(/[\\%_]/g, (char) => `\\${char}`);
  return sql<string>`lower(public.unaccent(${`%${escaped}%`}))`;
}

/** El código de PostgreSQL de una violación de unicidad. */
const UNIQUE_VIOLATION = '23505';

/** Si el error es de unicidad (un `sku`, un `code` o un id repetido): el servicio lo traduce a su mensaje. */
export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === UNIQUE_VIOLATION;
}

/** El código de PostgreSQL de una violación de clave foránea. */
const FOREIGN_KEY_VIOLATION = '23503';

/** Si el error es de clave foránea (borrar un cliente que tiene cuenta corriente): el servicio lo traduce. */
export function isForeignKeyViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === FOREIGN_KEY_VIOLATION;
}

/** Los códigos de PostgreSQL de un error pasajero: un deadlock o un fallo de serialización. */
const TRANSIENT_ERRORS: ReadonlySet<unknown> = new Set(['40P01', '40001']);

/**
 * Un error pasajero que detecta el propio código (no PostgreSQL): por ejemplo, el push que esperaba
 * el candado de lote y, cuando lo recibe, la fila ya no está porque un reinicio total la borró.
 */
export class TransientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransientError';
  }
}

/**
 * Si el error es pasajero (la base eligió esta transacción para romper un deadlock, o un
 * `TransientError`): reintentar la operación entera anda. No es un dato malo, así que nunca se guarda
 * como un rechazo definitivo.
 */
export function isTransientError(err: unknown): boolean {
  if (err instanceof TransientError) {
    return true;
  }
  return typeof err === 'object' && err !== null && 'code' in err && TRANSIENT_ERRORS.has(err.code);
}

/**
 * Corre `work` dentro de un `SAVEPOINT` de la transacción. Si tira un error (también uno de
 * PostgreSQL, que sin savepoint deja abortada la transacción entera), lo hecho por `work` se deshace
 * solo, la transacción sigue sirviendo y el error sube a quien llama, que decide qué hacer con él.
 */
export async function inSavepoint<DB, T>(trx: Transaction<DB>, name: string, work: () => Promise<T>): Promise<T> {
  const savepoint = sql.id(name);
  await sql`SAVEPOINT ${savepoint}`.execute(trx);
  let result: T;
  try {
    result = await work();
  } catch (err: unknown) {
    await sql`ROLLBACK TO SAVEPOINT ${savepoint}`.execute(trx);
    await sql`RELEASE SAVEPOINT ${savepoint}`.execute(trx);
    throw err;
  }
  await sql`RELEASE SAVEPOINT ${savepoint}`.execute(trx);
  return result;
}

/**
 * Parte una lista en tramos para un `INSERT` de varias filas: PostgreSQL admite 65535 parámetros
 * por sentencia, y 500 filas entran holgadas con cualquier tabla del esquema.
 */
export function inChunks<T>(rows: readonly T[], size = 500): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    chunks.push(rows.slice(i, i + size));
  }
  return chunks;
}
