import { z } from '../../shared/zod.ts';

/**
 * Eventos del push del Connector API 4.4.0 (`OutboxBatchItem`). Cada tipo valida lo que el mini-erp
 * lee y deja pasar el resto (`z.looseObject`), así el ERP guarda el evento completo aunque el contrato
 * sume campos. Los enums abiertos (medio de pago, motivo de stock) son `string` por las reglas de
 * evolución del contrato. Un evento inválido es un `LotIssue` del lote, nunca un error del request.
 */

/** Un aviso del lote; así se guarda en `push_lots.issues` (`jsonb`) y así se valida al leerlo. */
export const lotIssuesSchema = z.array(z.object({ message: z.string(), eventId: z.string().optional() }));

export type LotIssue = z.infer<typeof lotIssuesSchema>[number];

/**
 * Un instante ISO 8601 con zona (el `date-time` del contrato; el POS manda `toISOString()`). Se
 * valida en la frontera: una fecha ilegible deja al evento como aviso, no se adivina (el día de una
 * venta decide el cargo de uso y el resumen de caja).
 */
const instantSchema = z.iso.datetime({ offset: true, error: 'tiene que ser una fecha y hora ISO 8601 con zona' });

/** Un día que existe (`2026-02-31` no pasa). */
const daySchema = z.iso.date({ error: 'tiene que ser un día que exista, como AAAA-MM-DD' });

/** Sobre común. Un POS anterior puede mandar un evento sin `origin` ni `createdAt`. */
const envelopeSchema = z.looseObject({
  id: z.string().min(1),
  type: z.string().min(1),
  createdAt: instantSchema.optional(),
  origin: z.looseObject({ branch: z.string().optional(), pointOfSale: z.string().optional() }).optional(),
});

const paymentSchema = z.looseObject({ method: z.string(), amount: z.number(), reference: z.string().optional() });

/** Número de ticket (4.1.0) o de recibo (4.2.0) en su día. */
const numberedSchema = z.object({ date: daySchema, number: z.number().int().min(1) });

/** Venta: total, cliente, anulación, pagos, el número de ticket (4.1.0) y su `createdAt` (el día, #20). */
const saleSchema = z.looseObject({
  id: z.string().min(1),
  total: z.number(),
  customerId: z.string().optional(),
  voidsSaleId: z.string().optional(),
  payments: z.array(paymentSchema),
  ticket: numberedSchema.optional(),
  createdAt: instantSchema.optional(),
});

const stockMovementSchema = z.looseObject({
  id: z.string().min(1),
  productId: z.string().min(1),
  delta: z.number(),
  reason: z.string(),
  saleId: z.string().optional(),
});

const customerSchema = z.looseObject({
  id: z.string().min(1),
  name: z.string(),
  document: z.string().optional(),
  phone: z.string().optional(),
  creditLimit: z.number().optional(),
  margin: z.number().optional(),
  balance: z.number().optional(),
  unrestricted: z.boolean().optional(),
  blocked: z.looseObject({ reason: z.string() }).optional(),
});

/** Movimiento de caja: el mini-erp lo guarda completo; necesita el id y su `createdAt` (el día, #20). */
const cashMovementSchema = z.looseObject({ id: z.string().min(1), createdAt: instantSchema.optional() });

/** Cobranza; con `voidsPaymentId`, la anulación de otra (4.3.0). El recibo y `createdAt` dan su día (#20). */
const customerPaymentSchema = z.looseObject({
  id: z.string().min(1),
  customerId: z.string().min(1),
  total: z.number(),
  voidsPaymentId: z.string().min(1).optional(),
  receipt: numberedSchema.optional(),
  createdAt: instantSchema.optional(),
});

const pushEventSchema = z.discriminatedUnion('type', [
  envelopeSchema.extend({ type: z.literal('sale'), sale: saleSchema }),
  envelopeSchema.extend({ type: z.literal('stock-movement'), movement: stockMovementSchema }),
  envelopeSchema.extend({ type: z.literal('customer'), customer: customerSchema }),
  envelopeSchema.extend({
    type: z.literal('account-hold-confirm'),
    holdId: z.string().min(1),
    saleId: z.string().min(1),
  }),
  envelopeSchema.extend({ type: z.literal('account-hold-release'), holdId: z.string().min(1) }),
  envelopeSchema.extend({ type: z.literal('cash-movement'), movement: cashMovementSchema }),
  envelopeSchema.extend({ type: z.literal('customer-payment'), payment: customerPaymentSchema }),
]);

export type PushEvent = z.infer<typeof pushEventSchema>;

export type ParsedBatchEvent = { ok: true; event: PushEvent } | { ok: false; issue: LotIssue };

const knownTypes: ReadonlySet<string> = new Set(
  pushEventSchema.options.map((option) => option.shape.type.value),
);

function describeError(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

/** El `id` del elemento, si es un string no vacío (para el `eventId` del issue). */
function eventIdOf(raw: unknown): { eventId?: string } {
  if (typeof raw === 'object' && raw !== null && 'id' in raw && typeof raw.id === 'string' && raw.id !== '') {
    return { eventId: raw.id };
  }
  return {};
}

export function parseBatchEvent(raw: unknown): ParsedBatchEvent {
  const envelope = envelopeSchema.safeParse(raw);
  if (!envelope.success) {
    return {
      ok: false,
      issue: { message: `Evento inválido: ${describeError(envelope.error)}`, ...eventIdOf(raw) },
    };
  }
  const { id, type } = envelope.data;
  if (!knownTypes.has(type)) {
    return { ok: false, issue: { message: `Tipo de evento no reconocido: ${type}`, eventId: id } };
  }
  const event = pushEventSchema.safeParse(raw);
  if (!event.success) {
    return {
      ok: false,
      issue: { message: `Evento ${type} inválido: ${describeError(event.error)}`, eventId: id },
    };
  }
  return { ok: true, event: event.data };
}

function detailOf(event: PushEvent): string | undefined {
  switch (event.type) {
    case 'sale':
      return `$${String(event.sale.total)}`;
    case 'stock-movement':
      return `${event.movement.productId} (${String(event.movement.delta)})`;
    case 'customer':
      return event.customer.name;
    default:
      return undefined;
  }
}

/** Resumen de un elemento del lote para el log del push; un evento inválido figura como tal. */
export function summarizeForLog(raw: unknown): { type: string; id: string; detail?: string } {
  const parsed = parseBatchEvent(raw);
  if (!parsed.ok) {
    return { type: 'inválido', id: parsed.issue.eventId ?? '?' };
  }
  const detail = detailOf(parsed.event);
  return {
    type: parsed.event.type,
    id: parsed.event.id,
    ...(detail === undefined ? {} : { detail }),
  };
}
