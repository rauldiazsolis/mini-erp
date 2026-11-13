import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { searchable, searchPattern } from '../db/pg/sql-helpers.ts';

/**
 * Si un producto contiene el texto en el nombre, el SKU o alguno de sus códigos de barras, sin
 * distinguir mayúsculas ni tildes. Lo comparten el catálogo y la matriz de stock.
 */
export function productMatchesSearch(eb: ExpressionBuilder<TenantDatabase, 'products'>, search: string): Expression<SqlBool> {
  const pattern = searchPattern(search);
  // Cada código de barras del jsonb, como texto (una columna que no sea una lista no tiene ninguno)
  const barcodes = sql`jsonb_array_elements_text(case when jsonb_typeof(${eb.ref('barcodes')}) = 'array' then ${eb.ref('barcodes')} else '[]'::jsonb end)`;
  return eb.or([
    eb(searchable(eb.ref('name')), 'like', pattern),
    eb(searchable(eb.ref('sku')), 'like', pattern),
    sql<boolean>`exists (select 1 from ${barcodes} as ${sql.ref('barcode')} where ${searchable(sql.ref<string>('barcode'))} like ${pattern})`,
  ]);
}
