import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { SeedCustomer } from './types.ts';

export const DEMO_CUSTOMERS: SeedCustomer[] = [
  {
    id: 'cust-cf',
    name: 'Consumidor Final',
    document: null,
    phone: null,
    creditLimit: 0,
    margin: 0,
    balance: 0,
    unrestricted: false,
  },
  {
    id: 'cust-juan',
    name: 'Juan Pérez',
    document: '20-12345678-9',
    phone: '11-4567-8901',
    creditLimit: 50000,
    margin: 10000,
    balance: 12500,
    unrestricted: false,
  },
  {
    id: 'cust-maria',
    name: 'María Gómez',
    document: '27-98765432-1',
    phone: '11-9876-5432',
    creditLimit: 30000,
    margin: 5000,
    balance: 0,
    unrestricted: false,
  },
  {
    id: 'cust-carlos',
    name: 'Carlos Vecino (Fiado sin tope)',
    document: '20-44556677-8',
    phone: '11-3322-1100',
    creditLimit: 0,
    margin: 0,
    balance: 3800,
    unrestricted: true, // Fiado sin límite
  },
];

/** Los clientes demo, con su saldo inicial en el libro. Los usan la semilla de las demos y la de desarrollo. */
export function insertDemoCustomers(db: DatabaseSync, now: string): void {
  const insertCust = db.prepare(
    'INSERT INTO customers (id, name, document, phone, credit_limit, margin, balance, unrestricted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );

  for (const c of DEMO_CUSTOMERS) {
    const custId = c.id ?? `cust_${randomUUID()}`;
    insertCust.run(
      custId,
      c.name,
      c.document ?? null,
      c.phone ?? null,
      c.creditLimit,
      c.margin,
      c.balance,
      c.unrestricted ? 1 : 0,
      now,
      now,
    );

    if (c.balance > 0) {
      db.prepare(
        `INSERT INTO account_movements (id, customer_id, type, amount, balance_after, description, sale_id, created_at)
         VALUES (?, ?, 'adjustment', ?, ?, 'Saldo inicial cuenta corriente', NULL, ?)`,
      ).run(`mov_init_${custId}`, custId, c.balance, c.balance, now);
    }
  }
}
