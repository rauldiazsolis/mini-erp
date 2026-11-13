import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { postToBalance, roundMoney } from '../customer/account-ledger.ts';
import { DomainError } from '../errors.ts';
import { MAX_MONEY_AMOUNT } from '../../shared/money.ts';

export type RoundingStrategy = 'none' | '10' | '50' | '100';

export type BulkPriceInput = {
  action: 'percentage' | 'fixed' | 'items';
  value?: number | undefined;
  category?: string | undefined;
  rounding?: RoundingStrategy | undefined;
  items?: Array<{ id: string; price: number }> | undefined;
  dryRun?: boolean | undefined;
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
  minimumBalance?: number | undefined;
  customerIds?: string[] | undefined;
  dryRun?: boolean | undefined;
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

type ProductRow = { id: string; sku: string; name: string; category: string; price: number };

const PRODUCT_COLUMNS = ['id', 'sku', 'name', 'category', 'price'] as const;

/**
 * Operaciones masivas del admin. Cada una corre en una transacción: o se aplica a todos o a
 * ninguno. La vista previa (`dryRun`) calcula lo mismo sin escribir.
 */
export class BulkService {
  private db: Kysely<TenantDatabase>;

  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  // --- ACTUALIZACIÓN MASIVA DE PRECIOS ---

  async previewOrApplyPrices(input: BulkPriceInput): Promise<BulkPriceResult> {
    const rounding = input.rounding ?? 'none';
    const isDryRun = input.dryRun ?? false;
    const now = new Date().toISOString();
    const { action, items, value } = input;

    if (action === 'items' && (items === undefined || items.length === 0)) {
      throw new DomainError(400, "Para la acción 'items' se debe proveer una lista de productos con su nuevo precio");
    }
    if (action !== 'items' && value === undefined) {
      throw new DomainError(400, "Se debe especificar un 'value' para la acción seleccionada");
    }
    const category = input.category?.trim() ?? '';

    const previewItems = await this.db.transaction().execute(async (trx) => {
      const preview: BulkPricePreviewItem[] = [];
      const change = async (prod: ProductRow, newPrice: number): Promise<void> => {
        // `applyRounding` ya dejó el precio al centavo; lo que no entra en la columna no se guarda
        if (newPrice > MAX_MONEY_AMOUNT) {
          throw new DomainError(400, 'Importe inválido');
        }
        preview.push({
          id: prod.id,
          sku: prod.sku,
          name: prod.name,
          category: prod.category,
          oldPrice: prod.price,
          newPrice,
          diff: roundMoney(newPrice - prod.price),
        });
        if (!isDryRun) {
          await trx.updateTable('products').set({ price: newPrice, updated_at: now }).where('id', '=', prod.id).execute();
        }
      };

      if (action === 'items') {
        for (const item of items ?? []) {
          let query = trx.selectFrom('products').select(PRODUCT_COLUMNS).where('id', '=', item.id);
          if (!isDryRun) query = query.forUpdate();
          const prod = await query.executeTakeFirst();
          if (prod === undefined) continue;
          await change(prod, this.applyRounding(item.price, rounding));
        }
        return preview;
      }

      // action === 'percentage' | 'fixed'
      let query = trx.selectFrom('products').select(PRODUCT_COLUMNS);
      if (category !== '') query = query.where('category', '=', category);
      // Bloqueadas mientras se calcula: una edición a la vez no se pierde ni pisa el cálculo
      if (!isDryRun) query = query.forUpdate();
      const products = await query.orderBy('name').orderBy('id').execute();
      const amount = value ?? 0;
      for (const prod of products) {
        const calcPrice = action === 'percentage' ? prod.price * (1 + amount / 100) : prod.price + amount;
        await change(prod, Math.max(0, this.applyRounding(calcPrice, rounding)));
      }
      return preview;
    });

    return {
      dryRun: isDryRun,
      affectedCount: previewItems.length,
      items: previewItems,
    };
  }

  // --- CÁLCULO MASIVO DE INTERESES ---

  async previewOrApplyInterests(input: BulkInterestInput): Promise<BulkInterestResult> {
    if (input.interestRatePercent <= 0) {
      throw new DomainError(400, 'La tasa de interés debe ser mayor a cero');
    }

    const minBalance = input.minimumBalance ?? 0;
    const isDryRun = input.dryRun ?? false;
    const now = new Date().toISOString();
    const targetCustomerIds = input.customerIds ?? [];

    const items = await this.db.transaction().execute(async (trx) => {
      let query = trx.selectFrom('customers').select(['id', 'name', 'balance']).where('balance', '>', minBalance);
      if (targetCustomerIds.length > 0) query = query.where('id', 'in', targetCustomerIds);
      // Bloqueados mientras se calcula: el interés sale del saldo que queda guardado
      if (!isDryRun) query = query.forUpdate();
      const rows = await query.orderBy('name').orderBy('id').execute();

      const preview: BulkInterestPreviewItem[] = [];
      for (const c of rows) {
        const currentBalance = c.balance ?? 0;
        const interestAmount = roundMoney(currentBalance * (input.interestRatePercent / 100));
        if (Math.abs(currentBalance + interestAmount) > MAX_MONEY_AMOUNT) {
          throw new DomainError(400, 'Importe inválido');
        }
        let newBalance = roundMoney(currentBalance + interestAmount);
        if (!isDryRun) {
          // El interés pasa por el libro: el saldo se suma en SQL y el extracto cuadra
          const posted = await postToBalance(trx, c.id, { type: 'interest', delta: interestAmount, description: input.description }, now);
          newBalance = posted?.balanceAfter ?? newBalance;
        }
        preview.push({ customerId: c.id, customerName: c.name, currentBalance, interestAmount, newBalance });
      }
      return preview;
    });

    return {
      dryRun: isDryRun,
      affectedCount: items.length,
      totalInterestAmount: roundMoney(items.reduce((sum, i) => sum + i.interestAmount, 0)),
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
