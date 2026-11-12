import { sql, type Expression, type RawBuilder } from 'kysely';

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
