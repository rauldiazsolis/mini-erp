import { z } from '../../shared/zod.ts';

/** Líneas de venta del contrato (`ProductSaleLine` / `FreeformSaleLine`), para leer el payload guardado. */
const discountSchema = z.object({ type: z.enum(['amount', 'percentage']), value: z.number() });

export const saleLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('product'),
    productId: z.string().min(1),
    qty: z.number(),
    unitPrice: z.number(),
    discount: discountSchema.optional(),
  }),
  z.object({
    kind: z.literal('freeform'),
    description: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    discount: discountSchema.optional(),
  }),
]);

export type SaleLine = z.infer<typeof saleLineSchema>;

export function roundAmount(value: number): number {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

/**
 * Total de la línea con su descuento, con la misma fórmula del POS (`calculateLineTotal` en
 * offline-pos `src/domain/totals.ts`): el descuento se toma sobre el valor absoluto, con el signo de
 * la línea, y nunca supera la línea. El ajuste global del ticket no es de ninguna línea.
 */
export function lineTotal(line: SaleLine): number {
  const subtotal = line.unitPrice * line.qty;
  const magnitude = Math.abs(subtotal);
  const discount =
    line.discount === undefined
      ? 0
      : line.discount.type === 'amount'
        ? line.discount.value
        : magnitude * (line.discount.value / 100);
  return roundAmount(subtotal - Math.sign(subtotal) * Math.min(discount, magnitude));
}

const storedSaleSchema = z.object({ lines: z.array(z.unknown()) });

/** Las líneas válidas de una venta guardada; un payload roto o una línea que no valida se saltean. */
export function parseSaleLines(payload: string): SaleLine[] {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return [];
  }
  const sale = storedSaleSchema.safeParse(raw);
  if (!sale.success) return [];
  return sale.data.lines.flatMap((line) => {
    const parsed = saleLineSchema.safeParse(line);
    return parsed.success ? [parsed.data] : [];
  });
}
