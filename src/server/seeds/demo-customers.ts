import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
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

/**
 * Los clientes demo, con su saldo inicial en el libro, en un insert por tabla. Los usan la semilla
 * de las demos y la de desarrollo.
 */
export async function insertDemoCustomers(db: Kysely<TenantDatabase>, now: string): Promise<void> {
  const customers = DEMO_CUSTOMERS.map((c) => ({ ...c, id: c.id ?? `cust_${randomUUID()}` }));
  await db
    .insertInto('customers')
    .values(
      customers.map((c) => ({
        id: c.id,
        name: c.name,
        document: c.document ?? null,
        phone: c.phone ?? null,
        credit_limit: c.creditLimit,
        margin: c.margin,
        balance: c.balance,
        unrestricted: c.unrestricted === true,
        created_at: now,
        updated_at: now,
      })),
    )
    .execute();

  const openings = customers.filter((c) => c.balance > 0);
  if (openings.length > 0) {
    await db
      .insertInto('account_movements')
      .values(
        openings.map((c) => ({
          id: `mov_init_${c.id}`,
          customer_id: c.id,
          type: 'adjustment',
          amount: c.balance,
          balance_after: c.balance,
          description: 'Saldo inicial cuenta corriente',
          sale_id: null,
          created_at: now,
        })),
      )
      .execute();
  }
}
