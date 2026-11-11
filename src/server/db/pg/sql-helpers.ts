import { sql, type Expression, type RawBuilder } from 'kysely';

/**
 * Un valor para una columna `jsonb`. `pg` convierte un array de JavaScript en un array de
 * PostgreSQL, no en JSON: por eso lo que va a `jsonb` se serializa siempre acá.
 */
export function jsonValue(value: unknown): string {
  return JSON.stringify(value);
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
