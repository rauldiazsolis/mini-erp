import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

export type RoundingStrategy = 'none' | '10' | '50' | '100';

export type BulkPriceInput = {
  action: 'percentage' | 'fixed' | 'items';
  value?: number;
  category?: string;
  rounding?: RoundingStrategy;
  items?: Array<{ id: string; price: number }>;
  dryRun?: boolean;
};

export type BulkPricePreviewItem = {
  id: string;
  sku: string;
  name: string;
  category: string;
  oldPrice: number;
  newPrice: number;
  diff: number;
};

export type BulkPriceResult = {
  dryRun: boolean;
  affectedCount: number;
  items: BulkPricePreviewItem[];
};

export type BulkInterestInput = {
  interestRatePercent: number;
  description: string;
  minimumBalance?: number;
  customerIds?: string[];
  dryRun?: boolean;
};

export type BulkInterestPreviewItem = {
  customerId: string;
  customerName: string;
  currentBalance: number;
  interestAmount: number;
  newBalance: number;
};

export type BulkInterestResult = {
  dryRun: boolean;
  affectedCount: number;
  totalInterestAmount: number;
  items: BulkInterestPreviewItem[];
};

interface RawProductRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  price: number;
}

interface RawCustomerRow {
  id: string;
  name: string;
  balance: number;
}

export class BulkService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  // --- ACTUALIZACIÓN MASIVA DE PRECIOS ---

  previewOrApplyPrices(input: BulkPriceInput): BulkPriceResult {
    const rounding = input.rounding ?? 'none';
    const isDryRun = input.dryRun ?? false;
    const now = new Date().toISOString();

    const previewItems: BulkPricePreviewItem[] = [];

    if (input.action === 'items') {
      if (!input.items || input.items.length === 0) {
        throw new Error("Para la acción 'items' se debe proveer una lista de productos con su nuevo precio");
      }

      for (const item of input.items) {
        const prod = this.db.prepare('SELECT id, sku, name, category, price FROM products WHERE id = ?').get(item.id) as unknown as RawProductRow | undefined;
        if (!prod) continue;

        const newPrice = this.applyRounding(item.price, rounding);
        previewItems.push({
          id: prod.id,
          sku: prod.sku,
          name: prod.name,
          category: prod.category,
          oldPrice: prod.price,
          newPrice,
          diff: Math.round((newPrice - prod.price) * 100) / 100,
        });

        if (!isDryRun) {
          this.db
            .prepare('UPDATE products SET price = ?, updated_at = ? WHERE id = ?')
            .run(newPrice, now, prod.id);
        }
      }
    } else {
      // action === 'percentage' | 'fixed'
      if (input.value === undefined) {
        throw new Error("Se debe especificar un 'value' para la acción seleccionada");
      }

      let sql = 'SELECT id, sku, name, category, price FROM products WHERE 1=1';
      const params: string[] = [];

      if (input.category !== undefined && input.category.trim() !== '') {
        sql += ' AND category = ?';
        params.push(input.category.trim());
      }

      const products = this.db.prepare(sql).all(...params) as unknown as RawProductRow[];

      for (const prod of products) {
        let calcPrice: number;
        if (input.action === 'percentage') {
          calcPrice = prod.price * (1 + input.value / 100);
        } else {
          calcPrice = prod.price + input.value;
        }

        const newPrice = Math.max(0, this.applyRounding(calcPrice, rounding));
        previewItems.push({
          id: prod.id,
          sku: prod.sku,
          name: prod.name,
          category: prod.category,
          oldPrice: prod.price,
          newPrice,
          diff: Math.round((newPrice - prod.price) * 100) / 100,
        });

        if (!isDryRun) {
          this.db
            .prepare('UPDATE products SET price = ?, updated_at = ? WHERE id = ?')
            .run(newPrice, now, prod.id);
        }
      }
    }

    return {
      dryRun: isDryRun,
      affectedCount: previewItems.length,
      items: previewItems,
    };
  }

  // --- CÁLCULO MASIVO DE INTERESES ---

  previewOrApplyInterests(input: BulkInterestInput): BulkInterestResult {
    if (input.interestRatePercent <= 0) {
      throw new Error('La tasa de interés debe ser mayor a cero');
    }

    const minBalance = input.minimumBalance ?? 0;
    const isDryRun = input.dryRun ?? false;
    const now = new Date().toISOString();

    const sql = 'SELECT id, name, balance FROM customers WHERE balance > ?';
    const params: (number | string)[] = [minBalance];

    const rows = this.db.prepare(sql).all(...params) as unknown as RawCustomerRow[];

    const targetCustomerIds = input.customerIds;
    const filteredRows = targetCustomerIds && targetCustomerIds.length > 0
      ? rows.filter((c) => targetCustomerIds.includes(c.id))
      : rows;

    const items: BulkInterestPreviewItem[] = [];
    let totalInterest = 0;

    for (const c of filteredRows) {
      const interestAmount = Math.round(c.balance * (input.interestRatePercent / 100) * 100) / 100;
      const newBalance = Math.round((c.balance + interestAmount) * 100) / 100;
      totalInterest += interestAmount;

      items.push({
        customerId: c.id,
        customerName: c.name,
        currentBalance: c.balance,
        interestAmount,
        newBalance,
      });

      if (!isDryRun) {
        const movId = `mov_${randomUUID()}`;
        // 1. Asiento en cuenta corriente
        this.db
          .prepare(
            `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
             VALUES (?, ?, 'interest', ?, ?, ?, NULL, ?)`,
          )
          .run(movId, c.id, interestAmount, newBalance, input.description, now);

        // 2. Actualizar saldo del cliente
        this.db
          .prepare('UPDATE customers SET balance = ?, updated_at = ? WHERE id = ?')
          .run(newBalance, now, c.id);
      }
    }

    return {
      dryRun: isDryRun,
      affectedCount: items.length,
      totalInterestAmount: Math.round(totalInterest * 100) / 100,
      items,
    };
  }

  private applyRounding(val: number, strategy: RoundingStrategy): number {
    switch (strategy) {
      case '10':
        return Math.round(val / 10) * 10;
      case '50':
        return Math.round(val / 50) * 50;
      case '100':
        return Math.round(val / 100) * 100;
      case 'none':
      default:
        return Math.round(val * 100) / 100;
    }
  }
}
