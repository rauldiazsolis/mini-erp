import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import type { Kysely } from 'kysely';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { createTenantSchema } from '../src/server/db/pg/migrations/migrate.ts';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { recordDiscrepancy, listOpenDiscrepancies } from '../src/server/discrepancy/discrepancies.ts';
import {
  recordDiscrepancy as recordDiscrepancySqlite,
  listOpenDiscrepancies as listOpenDiscrepanciesSqlite,
} from '../src/server/discrepancy/discrepancies.sqlite.ts';
import { CustomerService } from '../src/server/customer/customer-service.ts';
import { ImportService } from '../src/server/io/import-service.ts';
import { setupTestDb } from './helpers/test-db.ts';

const pg = setupTestDb();

const at = '2026-10-02T12:00:00.000Z';
// El cliente con el id que usó el POS (#22: la columna id engancha los pendientes)
const CSV = 'id;nombre;dni\nc9;Ana;30111222\n';
const pendiente = {
  kind: 'unknown-customer', deviceId: 'dev-1', originBranch: 'CENTRAL', originPos: 'Caja 1',
  customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
  pending: { type: 'sale', delta: 950, description: 'Venta v1', saleId: 'v1' },
} as const;

describe('pendientes al crear un cliente (#2)', () => {
  let db: Kysely<TenantDatabase>;

  beforeEach(async () => {
    await createTenantSchema(pg().root, 'kiosco');
    db = pg().forTenant('kiosco');
    await recordDiscrepancy(db, pendiente, at);
  });

  const saldo = async () => (await db.selectFrom('customers').select('balance').where('id', '=', 'c9').executeTakeFirstOrThrow()).balance;

  it('el alta en el admin aplica la venta pendiente', async () => {
    const creado = await new CustomerService(db).createCustomer({ id: 'c9', name: 'Ana' });
    expect(await saldo()).toBe(950);
    expect(creado.balance).toBe(950); // la respuesta del alta ya trae el saldo aplicado
    expect(await listOpenDiscrepancies(db)).toEqual([]);
  });

  it('el alta con saldo inicial suma el saldo inicial y la venta pendiente, en ese orden', async () => {
    const creado = await new CustomerService(db).createCustomer({ id: 'c9', name: 'Ana', initialBalance: 50 });
    expect(creado.balance).toBe(1000);
    expect(await db.selectFrom('account_movements').select(['type', 'amount', 'balance_after']).orderBy('seq').execute()).toEqual([
      { type: 'adjustment', amount: 50, balance_after: 50 },
      { type: 'sale', amount: 950, balance_after: 1000 },
    ]);
  });
});

// La importación todavía corre sobre SQLite (se migra con su dominio)
describe('pendientes al importar clientes (#2)', () => {
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    initTenantDb(db);
    await recordDiscrepancySqlite(db, pendiente, at);
  });

  const saldo = () => (db.prepare("SELECT balance FROM customers WHERE id = 'c9'").get() as { balance: number }).balance;

  it('la importación aplica la venta pendiente', async () => {
    await new ImportService(db).run('customers', { csv: CSV, dryRun: false }, at);
    expect(saldo()).toBe(950);
    expect(await listOpenDiscrepanciesSqlite(db)).toEqual([]);
  });

  it('una importación en dryRun no aplica nada', async () => {
    await new ImportService(db).run('customers', { csv: CSV, dryRun: true }, at);
    expect(await listOpenDiscrepanciesSqlite(db)).toHaveLength(1);
  });
});
