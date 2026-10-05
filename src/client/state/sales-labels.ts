import { z } from '../../shared/zod.ts';
import { methodKey, type MethodKey } from '../../shared/payment-methods.ts';
import type { CustomerRef, SaleKind } from '../../shared/sales-types.ts';

/** Los mismos textos que el POS (`PAYMENT_METHOD_LABELS` de offline-pos), más "Otro". */
const METHOD_LABELS: Record<MethodKey, string> = {
  cash: 'Efectivo',
  debit: 'Tarjeta de Débito',
  credit: 'Tarjeta de Crédito',
  transfer: 'Transferencia',
  qr: 'Código QR',
  account: 'Cuenta corriente',
  other: 'Otro',
};

export function methodLabel(method: string): string {
  return METHOD_LABELS[methodKey(method)];
}

/** "1 ticket", "3 tickets": el encabezado de cada lista. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${String(count)} ${count === 1 ? singular : plural}`;
}

export const KIND_LABELS: Record<SaleKind, string> = { sale: 'Venta', return: 'Devolución', void: 'Anulación' };

/** La caja como la ve el comerciante; la cobranza cargada en el admin es "Admin". */
export function registerLabel(branch: string | null, pointOfSale: string | null): string {
  if (branch === 'ADMIN') return 'Admin';
  const pos = pointOfSale === null || pointOfSale === '' ? 'Sin punto de venta' : pointOfSale;
  return branch === null || branch === '' ? pos : `${branch} · ${pos}`;
}

export function customerLabel(customer: CustomerRef | undefined): string {
  if (customer === undefined) return 'Consumidor final';
  return customer.name ?? `Cliente desconocido (${customer.id})`;
}

export type RegisterChoice = { branch?: string | undefined; pointOfSale?: string | undefined };

/** Clave de un `<select>` de cajas: `''` es "todas"; `null` adentro es "sin filtro" en ese campo. */
export function registerKey(choice: RegisterChoice): string {
  if (choice.branch === undefined && choice.pointOfSale === undefined) return '';
  return JSON.stringify([choice.branch ?? null, choice.pointOfSale ?? null]);
}

const keySchema = z.tuple([z.string().nullable(), z.string().nullable()]);

export function parseRegisterKey(key: string): RegisterChoice {
  if (key === '') return {};
  let raw: unknown;
  try {
    raw = JSON.parse(key);
  } catch {
    return {};
  }
  const parsed = keySchema.safeParse(raw);
  if (!parsed.success) return {};
  const [branch, pointOfSale] = parsed.data;
  return { ...(branch === null ? {} : { branch }), ...(pointOfSale === null ? {} : { pointOfSale }) };
}
