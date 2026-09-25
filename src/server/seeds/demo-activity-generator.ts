import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export function generateHistoricalDemoActivity(db: DatabaseSync, branchId: string): {
  salesCreated: number;
  cashMovementsCreated: number;
} {
  // Obtener productos disponibles en la base
  const products = db
    .prepare('SELECT id, sku, name, price, tax_rate FROM products LIMIT 8')
    .all() as unknown as { id: string; sku: string; name: string; price: number; tax_rate: number }[];

  if (products.length === 0) {
    return { salesCreated: 0, cashMovementsCreated: 0 };
  }

  const now = Date.now();
  const ONE_DAY = 24 * 60 * 60 * 1000;
  let salesCreated = 0;
  let cashMovementsCreated = 0;

  // Generar actividad para los últimos 7 días (del día -6 al día 0 = hoy)
  for (let d = 6; d >= 0; d--) {
    const dayBaseTime = now - d * ONE_DAY;

    // 1. Apertura de caja del día (9:00 AM aprox)
    const openTime = new Date(dayBaseTime);
    openTime.setHours(9, 0, 0, 0);
    const openIso = openTime.toISOString();
    const openCashId = `csh_open_d${d}`;

    db.prepare(
      `INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at)
       VALUES (?, ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?)
       ON CONFLICT(id) DO NOTHING`,
    ).run(
      openCashId,
      JSON.stringify({
        id: openCashId,
        type: 'float-in',
        amount: 15000,
        currency: 'ARS',
        note: 'Fondo inicial de caja',
        timestamp: openIso,
      }),
      openIso,
    );
    cashMovementsCreated++;

    // 2. Entre 3 y 5 ventas distribuidas en el día
    const salesCount = 3 + (d % 3); // 3 a 5 ventas
    const hours = [10, 12, 15, 17, 19];

    for (let s = 0; s < salesCount; s++) {
      const saleTime = new Date(dayBaseTime);
      saleTime.setHours(hours[s] ?? 14, Math.floor(Math.random() * 50), 0, 0);
      const saleIso = saleTime.toISOString();
      const saleId = `sale_demo_d${d}_s${s}`;

      // Elegir 1 o 2 productos
      const prod1 = products[(d + s) % products.length]!;
      const qty1 = 1 + (s % 2);
      const line1Total = prod1.price * qty1;

      let saleTotal = line1Total;
      const lines = [
        {
          kind: 'product',
          productId: prod1.id,
          name: prod1.name,
          qty: qty1,
          unitPrice: prod1.price,
          lineTotal: line1Total,
        },
      ];

      // Reducir stock por la venta
      db.prepare(
        `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, sale_id, device_id, branch, point_of_sale, created_at)
         VALUES (?, ?, ?, ?, 'sale', ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(`stk_mov_d${d}_s${s}_1`, prod1.id, branchId, -qty1, saleId, saleIso);

      db.prepare(
        `UPDATE stock SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE product_id = ? AND branch_id = ?`,
      ).run(qty1, saleIso, prod1.id, branchId);

      // Si s == 1, agregar un segundo producto
      if (s === 1 && products.length > 1) {
        const prod2 = products[(d + s + 1) % products.length]!;
        const qty2 = 1;
        const line2Total = prod2.price * qty2;
        saleTotal += line2Total;
        lines.push({
          kind: 'product',
          productId: prod2.id,
          name: prod2.name,
          qty: qty2,
          unitPrice: prod2.price,
          lineTotal: line2Total,
        });

        db.prepare(
          `INSERT INTO stock_movements (id, product_id, branch_id, delta, reason, sale_id, device_id, branch, point_of_sale, created_at)
           VALUES (?, ?, ?, ?, 'sale', ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?)
           ON CONFLICT(id) DO NOTHING`,
        ).run(`stk_mov_d${d}_s${s}_2`, prod2.id, branchId, -qty2, saleId, saleIso);

        db.prepare(
          `UPDATE stock SET quantity = MAX(0, quantity - ?), updated_at = ? WHERE product_id = ? AND branch_id = ?`,
        ).run(qty2, saleIso, prod2.id, branchId);
      }

      // Método de pago: la mayoría efectivo/tarjeta, alguna a cuenta corriente
      const isAccountSale = s === 2 && d % 2 === 0;
      const paymentMethod = isAccountSale ? 'account' : s % 2 === 0 ? 'cash' : 'card';
      const customerId = isAccountSale ? 'cust-juan' : 'cust-cf';

      const salePayload = {
        id: saleId,
        status: 'closed',
        total: saleTotal,
        customerId: isAccountSale ? customerId : undefined,
        lines,
        payments: [{ method: paymentMethod, amount: saleTotal }],
        createdAt: saleIso,
      };

      db.prepare(
        `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at)
         VALUES (?, ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?, NULL, ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(saleId, JSON.stringify(salePayload), saleTotal, saleIso);

      salesCreated++;

      // Si fue a cuenta corriente, asentar movimiento contable
      if (isAccountSale) {
        const custRow = db.prepare('SELECT balance FROM customers WHERE id = ?').get(customerId) as
          | { balance: number }
          | undefined;
        const prevBal = custRow?.balance ?? 0;
        const newBal = prevBal + saleTotal;

        db.prepare(
          `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
           VALUES (?, ?, 'sale', ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO NOTHING`,
        ).run(`mov_act_d${d}_s${s}`, customerId, saleTotal, newBal, `Venta en cuenta corriente ${saleId}`, saleId, saleIso);

        db.prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?').run(newBal, saleIso, customerId);
      }
    }

    // 3. Retiro / Pago de gastos a mitad del día (16:00 hs)
    if (d % 2 === 1) {
      const dropTime = new Date(dayBaseTime);
      dropTime.setHours(16, 0, 0, 0);
      const dropIso = dropTime.toISOString();
      const dropId = `csh_drop_d${d}`;

      db.prepare(
        `INSERT INTO cash_movements (id, payload, device_id, branch, point_of_sale, created_at)
         VALUES (?, ?, 'pos_caja_1', 'CENTRAL', 'Caja 1', ?)
         ON CONFLICT(id) DO NOTHING`,
      ).run(
        dropId,
        JSON.stringify({
          id: dropId,
          type: 'expense',
          amount: 2500,
          currency: 'ARS',
          note: 'Compra de artículos de limpieza',
          timestamp: dropIso,
        }),
        dropIso,
      );
      cashMovementsCreated++;
    }
  }

  return { salesCreated, cashMovementsCreated };
}
