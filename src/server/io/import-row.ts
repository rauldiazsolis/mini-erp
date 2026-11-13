import type { Transaction } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { inSavepoint, isUniqueViolation } from '../db/pg/sql-helpers.ts';
import { fitsMoneyColumn } from '../../shared/money.ts';
import { parseDecimal, type DecimalMode } from './csv.ts';

/** Otra operación cargó lo mismo mientras corría la importación (un SKU o un id repetido). */
export const ROW_ALREADY_EXISTS = 'Ya existe: se cargó mientras se importaba. Volvé a importar el archivo';
export const ROW_FAILED = 'No se pudo importar la fila';

/**
 * Escribe una fila dentro de su propio `SAVEPOINT`. En PostgreSQL un error de base (unicidad, un
 * valor que no entra en la columna) deja abortada la transacción entera: así lo de esa fila se
 * deshace solo, queda como error de la fila y el resto del archivo se importa. Devuelve el mensaje
 * del error o `undefined` si la fila se escribió.
 */
export async function writeRow(trx: Transaction<TenantDatabase>, line: number, work: () => Promise<void>): Promise<string | undefined> {
  try {
    await inSavepoint(trx, 'import_row', work);
    return undefined;
  } catch (err: unknown) {
    if (isUniqueViolation(err)) {
      return ROW_ALREADY_EXISTS;
    }
    console.error(`[importación] la línea ${String(line)} falló:`, err);
    return ROW_FAILED;
  }
}

/**
 * Un importe de una celda (precio, límite, margen, saldo). Lo que no entra tal cual en la columna
 * (más de 2 decimales o fuera del tope) es un error de la fila: nunca se redondea en silencio.
 * Los errores se agregan a `errors` con la etiqueta de la columna.
 */
export function parseMoneyCell(label: string, raw: string, decimal: DecimalMode, nonNegative: boolean, errors: string[]): number | undefined {
  const n = parseDecimal(raw, decimal);
  if (n === undefined) {
    errors.push(`${label}: no es un número`);
    return undefined;
  }
  if (nonNegative && n < 0) {
    errors.push(`${label}: no puede ser negativo`);
  } else if (!fitsMoneyColumn(n)) {
    errors.push(`${label}: importe inválido (hasta 2 decimales)`);
  }
  return n;
}
