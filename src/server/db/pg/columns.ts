import type { ColumnType } from 'kysely';

/**
 * Los tipos de columna que usa el esquema, con un sufijo:
 * - `?`: admite NULL.
 * - `=`: NOT NULL con DEFAULT (opcional al insertar).
 * - `!`: generada por la base (no se escribe nunca).
 *
 * De este manifiesto salen los tipos de Kysely (`TablesOf`) y `test/pg-schema.test.ts` lo compara
 * contra la base real: una columna que no está acá no existe para el código.
 */
export type PgType = 'text' | 'integer' | 'bigint' | 'numeric' | 'boolean' | 'date' | 'timestamptz' | 'jsonb';
export type ColumnSpec = PgType | `${PgType}?` | `${PgType}=` | `${PgType}!`;
export type TableSpec = Readonly<Record<string, ColumnSpec>>;
export type SchemaSpec = Readonly<Record<string, TableSpec>>;

/** [lo que se lee, lo que se escribe] de cada tipo, según los parsers de `database.ts`. */
type Values = {
  text: [string, string];
  integer: [number, number];
  /** `count(*)` y las columnas `seq`: el parser lo baja a `number`. */
  bigint: [number, number];
  /** Dinero `numeric(14,2)` y cantidades `numeric(14,4)`: el parser lo baja a `number`. */
  numeric: [number, number];
  boolean: [boolean, boolean];
  /** Un día (`YYYY-MM-DD`), sin hora ni zona. */
  date: [string, string];
  /** Se lee como texto ISO en UTC (`2026-11-11T12:00:00.000Z`), que es lo que viaja en la API. */
  timestamptz: [string, string | Date];
  /** Se lee ya parseado y se valida con Zod; se escribe con `jsonValue()`. */
  jsonb: [unknown, string];
};

type Select<T extends PgType> = Values[T][0];
type Write<T extends PgType> = Values[T][1];

export type ColumnOf<S extends ColumnSpec> = S extends `${infer T extends PgType}?`
  ? ColumnType<Select<T> | null, Write<T> | null | undefined, Write<T> | null>
  : S extends `${infer T extends PgType}=`
    ? ColumnType<Select<T>, Write<T> | undefined, Write<T>>
    : S extends `${infer T extends PgType}!`
      ? ColumnType<Select<T>, never, never>
      : S extends PgType
        ? ColumnType<Select<S>, Write<S>, Write<S>>
        : never;

export type TablesOf<S extends SchemaSpec> = {
  [T in keyof S]: { [C in keyof S[T]]: ColumnOf<S[T][C]> };
};

export function parseColumnSpec(spec: ColumnSpec): { type: PgType; nullable: boolean; hasDefault: boolean; generated: boolean } {
  const suffix = spec.at(-1);
  const type = (suffix === '?' || suffix === '=' || suffix === '!' ? spec.slice(0, -1) : spec) as PgType;
  return { type, nullable: suffix === '?', hasDefault: suffix === '=', generated: suffix === '!' };
}
