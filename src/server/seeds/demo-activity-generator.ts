import type { Insertable, Kysely } from 'kysely';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import { postSeriesToBalance, type LedgerMovement } from '../customer/account-ledger.ts';
import { inChunks } from '../db/pg/sql-helpers.ts';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import {
  saveCashMovements,
  saveCustomerPayments,
  saveSales,
  type CashMovementRecord,
  type CustomerPaymentRecord,
  type DocumentOrigin,
  type SaleRecord,
  type Stamped,
} from '../sales/records.ts';

const CAJA: DocumentOrigin = { deviceId: 'pos_caja_1', branch: 'CENTRAL', pointOfSale: 'Caja 1' };

type ProductLine = { kind: 'product'; productId: string; qty: number; unitPrice: number };

/** El instante del día argentino `day` a la hora indicada. */
function at(day: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00.000-03:00`).toISOString();
}

/** La caja de los documentos, cuántos días y un prefijo para los ids (dos cajas en un mismo comercio). */
export type DemoActivityOptions = { origin?: DocumentOrigin | undefined; days?: number | undefined; idPrefix?: string | undefined };

const JUAN = 'cust-juan';

/**
 * Historial de los últimos 7 días (o `days`) con la forma del contrato (#20): ventas numeradas por día (alguna a
 * cuenta corriente), una anulación ayer, una cobranza, ingresos, egresos y un ajuste por arqueo. Es
 * de las semillas (demos y desarrollo) y de los tests. Nada queda después de `now`.
 *
 * Arma todo en memoria y lo escribe por lotes (un insert de varias filas por tabla; el stock y el
 * saldo finales, una vez), en una transacción: la de quien llama si `db` ya es una, o una nueva.
 */
export async function generateHistoricalDemoActivity(
  db: Kysely<TenantDatabase>,
  branchId: string,
  now: Date = new Date(),
  options: DemoActivityOptions = {},
): Promise<{ salesCreated: number; cashMovementsCreated: number }> {
  if (!db.isTransaction) {
    return await db.transaction().execute(async (trx) => await generateHistoricalDemoActivity(trx, branchId, now, options));
  }
  const origin = options.origin ?? CAJA;
  const days = options.days ?? 7;
  const px = options.idPrefix ?? '';
  const products = await db.selectFrom('products').select(['id', 'price']).orderBy('id').limit(8).execute();
  if (products.length === 0) {
    return { salesCreated: 0, cashMovementsCreated: 0 };
  }

  const today = argentinaToday(now);
  const nowIso = now.toISOString();

  const sales: Stamped<SaleRecord>[] = [];
  const payments: Stamped<CustomerPaymentRecord>[] = [];
  const cashMovements: Stamped<CashMovementRecord>[] = [];
  const kardex: Insertable<TenantDatabase['stock_movements']>[] = [];
  const ledger: { movement: LedgerMovement; now: string }[] = [];

  // El stock de cada producto se sigue en memoria, con el piso en cero, y se escribe una vez
  const stockRows = await db
    .selectFrom('stock')
    .select(['product_id', 'quantity'])
    .where('branch_id', '=', branchId)
    .where('product_id', 'in', products.map((p) => p.id))
    .orderBy('product_id')
    .forUpdate()
    .execute();
  const stock = new Map(stockRows.map((row) => [row.product_id, { quantity: row.quantity, updatedAt: '' }]));

  const applyLines = (saleId: string, lines: ProductLine[], reason: 'sale' | 'sale-void', when: string): void => {
    lines.forEach((line, index) => {
      kardex.push({
        id: `stk_${saleId}_${String(index)}`,
        product_id: line.productId,
        branch_id: branchId,
        delta: -line.qty,
        reason,
        sale_id: saleId,
        device_id: origin.deviceId,
        branch: origin.branch,
        point_of_sale: origin.pointOfSale,
        created_at: when,
      });
      const current = stock.get(line.productId);
      if (current !== undefined) {
        current.quantity = Math.max(0, current.quantity - line.qty);
        current.updatedAt = when;
      }
    });
  };
  const cash = (id: string, when: string, movement: Record<string, unknown>): void => {
    if (when > nowIso) return;
    cashMovements.push({ record: { ...movement, id: `${px}${id}`, createdAt: when }, origin, receivedAt: when });
  };

  for (let d = days - 1; d >= 0; d--) {
    const day = shiftDay(today, -d);
    let ticket = 0;

    cash(`csh_open_d${String(d)}`, at(day, 9, 0), { direction: 'in', amount: 15000, concept: 'Fondo inicial', source: 'manual' });

    const hours = [10, 12, 15, 17, 19];
    const salesCount = 3 + (d % 3);
    let firstSale: { id: string; lines: ProductLine[]; method: string; total: number } | undefined;

    for (let s = 0; s < salesCount; s++) {
      const saleAt = at(day, hours[s] ?? 14, (d * 7 + s * 11) % 50);
      if (saleAt > nowIso) continue;
      const saleId = `${px}sale_demo_d${String(d)}_s${String(s)}`;

      const lines: ProductLine[] = [];
      const p1 = products[(d + s) % products.length];
      if (p1 !== undefined) lines.push({ kind: 'product', productId: p1.id, qty: 1 + (s % 2), unitPrice: p1.price });
      const p2 = products[(d + s + 1) % products.length];
      if (s === 1 && products.length > 1 && p2 !== undefined) lines.push({ kind: 'product', productId: p2.id, qty: 1, unitPrice: p2.price });
      const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);

      const isAccountSale = s === 2 && d % 2 === 0;
      const method = isAccountSale ? 'account' : s % 2 === 0 ? 'cash' : 'debit';
      ticket += 1;
      sales.push({
        record: {
          id: saleId,
          status: 'closed',
          lines,
          payments: [{ method, amount: total }],
          total,
          createdAt: saleAt,
          ticket: { date: day, number: ticket },
          ...(isAccountSale ? { customerId: JUAN } : {}),
        },
        origin,
        receivedAt: saleAt,
      });
      applyLines(saleId, lines, 'sale', saleAt);
      if (isAccountSale) {
        ledger.push({ movement: { type: 'sale', delta: total, description: `Venta en cuenta corriente ${saleId}`, saleId }, now: saleAt });
      }
      if (s === 0) firstSale = { id: saleId, lines, method, total };
    }

    // Ayer: anulación de la primera venta del día, a las 20:00
    const voidAt = at(day, 20, 0);
    if (d === 1 && firstSale !== undefined && voidAt <= nowIso) {
      const voidId = `${firstSale.id}_anulacion`;
      const voidLines = firstSale.lines.map((line) => ({ ...line, qty: -line.qty }));
      ticket += 1;
      sales.push({
        record: {
          id: voidId,
          status: 'closed',
          lines: voidLines,
          payments: [{ method: firstSale.method, amount: -firstSale.total }],
          total: -firstSale.total,
          createdAt: voidAt,
          ticket: { date: day, number: ticket },
          voidsSaleId: firstSale.id,
          voidReason: 'Error de carga',
        },
        origin,
        receivedAt: voidAt,
      });
      applyLines(voidId, voidLines, 'sale-void', voidAt);
    }

    // Anteayer: Juan paga $5.000 en efectivo
    const paymentAt = at(day, 18, 0);
    if (d === 2 && paymentAt <= nowIso) {
      const paymentId = `${px}pay_demo_d2`;
      payments.push({
        record: { id: paymentId, customerId: JUAN, payments: [{ method: 'cash', amount: 5000 }], total: 5000, createdAt: paymentAt, receipt: { date: day, number: 1 } },
        origin,
        receivedAt: paymentAt,
      });
      ledger.push({ movement: { type: 'payment', delta: -5000, description: `Cobranza ${paymentId}` }, now: paymentAt });
    }

    if (d % 2 === 1) {
      cash(`csh_drop_d${String(d)}`, at(day, 16, 0), { direction: 'out', amount: 2500, concept: 'Artículos de limpieza', source: 'manual' });
    }
    if (d === 1) {
      cash('csh_count_d1', at(day, 21, 0), {
        direction: 'out', amount: 150, concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 30000, counted: 29850 },
      });
    }
  }

  await saveSales(db, sales);
  for (const chunk of inChunks(kardex)) {
    await db.insertInto('stock_movements').values(chunk).onConflict((oc) => oc.column('id').doNothing()).execute();
  }
  const touched = [...stock].filter(([, s]) => s.updatedAt !== '');
  if (touched.length > 0) {
    await db
      .insertInto('stock')
      .values(touched.map(([productId, s]) => ({ product_id: productId, branch_id: branchId, quantity: s.quantity, updated_at: s.updatedAt })))
      .onConflict((oc) =>
        oc.columns(['product_id', 'branch_id']).doUpdateSet((eb) => ({ quantity: eb.ref('excluded.quantity'), updated_at: eb.ref('excluded.updated_at') })),
      )
      .execute();
  }
  await saveCashMovements(db, cashMovements);
  await saveCustomerPayments(db, payments);
  // Sin el cliente de la semilla (un comercio sin clientes demo) no hay libro que mover
  await postSeriesToBalance(db, JUAN, ledger);

  return { salesCreated: sales.length, cashMovementsCreated: cashMovements.length };
}
