import { z } from '../../shared/zod.ts';
import { DAY_PATTERN } from '../../shared/argentina-day.ts';
import type { Numbered, PaymentLine } from '../../shared/sales-types.ts';
import { parseSaleLines, type SaleLine } from '../dashboard/sale-lines.ts';

/**
 * Lectura tolerante de lo que se guardó (#20): cada campo se valida por separado y lo que no valida
 * se omite. Un payload roto nunca da un 500 en las consultas.
 */

const recordSchema = z.record(z.string(), z.unknown());
const numberedSchema = z.object({ date: z.string().regex(DAY_PATTERN), number: z.number().int() });
const paymentSchema = z.object({ method: z.string(), amount: z.number(), reference: z.string().optional() });
const countSchema = z.object({ expected: z.number(), counted: z.number() });

function parseRecord(payload: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return {};
  }
  const parsed = recordSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numbered(value: unknown): Numbered | undefined {
  const parsed = numberedSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function payments(value: unknown): PaymentLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown) => {
    const parsed = paymentSchema.safeParse(raw);
    if (!parsed.success) return [];
    const { method, amount, reference } = parsed.data;
    return [{ method, amount, ...(reference === undefined ? {} : { reference }) }];
  });
}

export type StoredSale = { createdAt?: string; ticket?: Numbered; payments: PaymentLine[]; lines: SaleLine[]; voidReason?: string };

export function readSale(payload: string): StoredSale {
  const raw = parseRecord(payload);
  const createdAt = text(raw['createdAt']);
  const ticket = numbered(raw['ticket']);
  const voidReason = text(raw['voidReason']);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(ticket === undefined ? {} : { ticket }),
    payments: payments(raw['payments']),
    lines: parseSaleLines(payload),
    ...(voidReason === undefined ? {} : { voidReason }),
  };
}

export type StoredCustomerPayment = { createdAt?: string; receipt?: Numbered; payments: PaymentLine[] };

export function readCustomerPayment(payload: string): StoredCustomerPayment {
  const raw = parseRecord(payload);
  const createdAt = text(raw['createdAt']);
  const receipt = numbered(raw['receipt']);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    ...(receipt === undefined ? {} : { receipt }),
    payments: payments(raw['payments']),
  };
}

export type StoredCashMovement = {
  createdAt?: string;
  direction: 'in' | 'out' | null;
  amount: number;
  concept: string;
  description?: string;
  source: string | null;
  count?: { expected: number; counted: number };
};

export function readCashMovement(payload: string): StoredCashMovement {
  const raw = parseRecord(payload);
  const createdAt = text(raw['createdAt']);
  const description = text(raw['description']);
  const direction = raw['direction'];
  const amount = raw['amount'];
  const count = countSchema.safeParse(raw['count']);
  return {
    ...(createdAt === undefined ? {} : { createdAt }),
    direction: direction === 'in' || direction === 'out' ? direction : null,
    amount: typeof amount === 'number' ? amount : 0,
    concept: text(raw['concept']) ?? 'Movimiento sin concepto',
    ...(description === undefined ? {} : { description }),
    source: text(raw['source']) ?? null,
    ...(count.success ? { count: count.data } : {}),
  };
}
