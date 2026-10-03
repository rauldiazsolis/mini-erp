import { DatabaseSync } from 'node:sqlite';
import { argentinaToday, shiftDay } from '../../shared/argentina-day.ts';
import { applyToBalance } from '../customer/account-ledger.ts';
import { saveCashMovement, saveCustomerPayment, saveSale, type DocumentOrigin } from '../sales/records.ts';

const CAJA: DocumentOrigin = { deviceId: 'pos_caja_1', branch: 'CENTRAL', pointOfSale: 'Caja 1' };

type ProductLine = { kind: 'product'; productId: string; qty: number; unitPrice: number };

/** El instante del día argentino `day` a la hora indicada. */
function at(day: string, hour: number, minute: number): string {
  const hh = String(hour).padStart(2, '0');
  const mm = String(minute).padStart(2, '0');
  return new Date(`${day}T${hh}:${mm}:00.000-03:00`).toISOString();
}

/**
 * Historial de los últimos 7 días con la forma del contrato (#20): ventas numeradas por día (alguna a
 * cuenta corriente), una anulación ayer, una cobranza, ingresos, egresos y un ajuste por arqueo. Es
 * del seed de desarrollo y de los tests (las demos no tienen historial). Nada queda después de `now`.
 */
export function generateHistoricalDemoActivity(
  db: DatabaseSync,
  branchId: string,
  now: Date = new Date(),
): { salesCreated: number; cashMovementsCreated: number } {
  const products = db
    .prepare('SELECT id, price FROM products ORDER BY id LIMIT 8')
    .all() as unknown as { id: string; price: number }[];
  if (products.length === 0) {
    return { salesCreated: 0, cashMovementsCreated: 0 };
  }

  const today = argentinaToday(now);
  const nowIso = now.toISOString();
  let salesCreated = 0;
  let cashMovementsCreated = 0;

  const moveStock = db.prepare(
    `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, sale_id, device_id, branch, point_of_sale, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  const updateStock = db.prepare(
    'UPDATE stock SET quantity = MAX(0, quantity + ?), updated_at = ? WHERE product_id = ? AND branch_id = ?',
  );
  const applyLines = (saleId: string, lines: ProductLine[], reason: 'sale' | 'sale-void', when: string): void => {
    lines.forEach((line, index) => {
      moveStock.run(`stk_${saleId}_${String(index)}`, line.productId, branchId, -line.qty, reason, saleId, when);
      updateStock.run(-line.qty, when, line.productId, branchId);
    });
  };
  const cash = (id: string, when: string, movement: Record<string, unknown>): void => {
    if (when > nowIso) return;
    saveCashMovement(db, { ...movement, id, createdAt: when }, CAJA, when);
    cashMovementsCreated++;
  };

  for (let d = 6; d >= 0; d--) {
    const day = shiftDay(today, -d);
    let ticket = 0;

    cash(`csh_open_d${String(d)}`, at(day, 9, 0), { direction: 'in', amount: 15000, concept: 'Fondo inicial', source: 'manual' });

    const hours = [10, 12, 15, 17, 19];
    const salesCount = 3 + (d % 3);
    let firstSale: { id: string; lines: ProductLine[]; method: string; total: number } | undefined;

    for (let s = 0; s < salesCount; s++) {
      const saleAt = at(day, hours[s] ?? 14, (d * 7 + s * 11) % 50);
      if (saleAt > nowIso) continue;
      const saleId = `sale_demo_d${String(d)}_s${String(s)}`;

      const lines: ProductLine[] = [];
      const p1 = products[(d + s) % products.length];
      if (p1 !== undefined) lines.push({ kind: 'product', productId: p1.id, qty: 1 + (s % 2), unitPrice: p1.price });
      const p2 = products[(d + s + 1) % products.length];
      if (s === 1 && products.length > 1 && p2 !== undefined) lines.push({ kind: 'product', productId: p2.id, qty: 1, unitPrice: p2.price });
      const total = lines.reduce((sum, line) => sum + line.qty * line.unitPrice, 0);

      const isAccountSale = s === 2 && d % 2 === 0;
      const method = isAccountSale ? 'account' : s % 2 === 0 ? 'cash' : 'debit';
      ticket += 1;
      saveSale(
        db,
        {
          id: saleId,
          status: 'closed',
          lines,
          payments: [{ method, amount: total }],
          total,
          createdAt: saleAt,
          ticket: { date: day, number: ticket },
          ...(isAccountSale ? { customerId: 'cust-juan' } : {}),
        },
        CAJA,
        saleAt,
      );
      applyLines(saleId, lines, 'sale', saleAt);
      salesCreated++;
      if (isAccountSale) {
        applyToBalance(db, 'cust-juan', { type: 'sale', delta: total, description: `Venta en cuenta corriente ${saleId}`, saleId }, saleAt);
      }
      if (s === 0) firstSale = { id: saleId, lines, method, total };
    }

    // Ayer: anulación de la primera venta del día, a las 20:00
    const voidAt = at(day, 20, 0);
    if (d === 1 && firstSale !== undefined && voidAt <= nowIso) {
      const voidId = `${firstSale.id}_anulacion`;
      const voidLines = firstSale.lines.map((line) => ({ ...line, qty: -line.qty }));
      ticket += 1;
      saveSale(
        db,
        {
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
        CAJA,
        voidAt,
      );
      applyLines(voidId, voidLines, 'sale-void', voidAt);
      salesCreated++;
    }

    // Anteayer: Juan paga $5.000 en efectivo
    const paymentAt = at(day, 18, 0);
    if (d === 2 && paymentAt <= nowIso) {
      const paymentId = 'pay_demo_d2';
      saveCustomerPayment(
        db,
        { id: paymentId, customerId: 'cust-juan', payments: [{ method: 'cash', amount: 5000 }], total: 5000, createdAt: paymentAt, receipt: { date: day, number: 1 } },
        CAJA,
        paymentAt,
      );
      applyToBalance(db, 'cust-juan', { type: 'payment', delta: -5000, description: `Cobranza ${paymentId}` }, paymentAt);
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

  return { salesCreated, cashMovementsCreated };
}
