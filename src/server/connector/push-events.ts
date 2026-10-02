import { z } from 'zod';

/**
 * Eventos del push del Connector API 4.4.0 (`OutboxBatchItem`). Cada tipo valida lo que el mini-erp
 * lee y deja pasar el resto (`passthrough`), así el ERP guarda el evento completo aunque el contrato
 * sume campos. Los enums abiertos (medio de pago, motivo de stock) son `string` por las reglas de
 * evolución del contrato. Un evento inválido es un `LotIssue` del lote, nunca un error del request.
 */

export type LotIssue = { message: string; eventId?: string };

/** Sobre común. Un POS anterior puede mandar un evento sin `origin` ni `createdAt`. */
const envelopeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    createdAt: z.string().optional(),
    origin: z
      .object({ branch: z.string().optional(), pointOfSale: z.string().optional() })
      .passthrough()
      .optional(),
  })
  .passthrough();

const paymentSchema = z
  .object({ method: z.string(), amount: z.number(), reference: z.string().optional() })
  .passthrough();

/** Venta: total, cliente, anulación, pagos y el número de ticket (4.1.0). */
const saleSchema = z
  .object({
    id: z.string().min(1),
    total: z.number(),
    customerId: z.string().optional(),
    voidsSaleId: z.string().optional(),
    payments: z.array(paymentSchema),
    ticket: z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), number: z.number().int().min(1) })
      .optional(),
  })
  .passthrough();

const stockMovementSchema = z
  .object({
    id: z.string().min(1),
    productId: z.string().min(1),
    delta: z.number(),
    reason: z.string(),
    saleId: z.string().optional(),
  })
  .passthrough();

const customerSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    document: z.string().optional(),
    phone: z.string().optional(),
    creditLimit: z.number().optional(),
    margin: z.number().optional(),
    balance: z.number().optional(),
    unrestricted: z.boolean().optional(),
    blocked: z.object({ reason: z.string() }).passthrough().optional(),
  })
  .passthrough();

/** Movimiento de caja: el mini-erp lo guarda completo; solo necesita el id. */
const cashMovementSchema = z.object({ id: z.string().min(1) }).passthrough();

/** Cobranza; con `voidsPaymentId`, la anulación de otra (4.3.0). */
const customerPaymentSchema = z
  .object({
    id: z.string().min(1),
    customerId: z.string().min(1),
    total: z.number(),
    voidsPaymentId: z.string().min(1).optional(),
  })
  .passthrough();

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
