import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { recordDiscrepancy, listOpenDiscrepancies } from '../src/server/discrepancy/discrepancies.ts';
import { CustomerService } from '../src/server/customer/customer-service.ts';
import { ImportExportService } from '../src/server/io/import-export-service.ts';

const at = '2026-10-02T12:00:00.000Z';
let db: DatabaseSync;

beforeEach(() => {
  db = new DatabaseSync(':memory:');
  initTenantDb(db);
  recordDiscrepancy(db, {
    kind: 'unknown-customer', deviceId: 'dev-1', originBranch: 'CENTRAL', originPos: 'Caja 1',
    customerId: 'c9', refType: 'sale', refId: 'v1', amount: 950,
    pending: { type: 'sale', delta: 950, description: 'Venta v1', saleId: 'v1' },
  }, at);
});

const saldo = () => (db.prepare("SELECT balance FROM customers WHERE id = 'c9'").get() as { balance: number }).balance;

describe('pendientes al crear un cliente (#2)', () => {
  it('el alta en el admin aplica la venta pendiente', () => {
    const creado = new CustomerService(db).createCustomer({ id: 'c9', name: 'Ana' });
    expect(saldo()).toBe(950);
    expect(creado.balance).toBe(950); // la respuesta del alta ya trae el saldo aplicado
    expect(listOpenDiscrepancies(db)).toEqual([]);
  });

  it('la importación aplica la venta pendiente', () => {
    new ImportExportService(db).importCustomers({ items: [{ id: 'c9', name: 'Ana', document: '30111222' }] });
    expect(saldo()).toBe(950);
    expect(listOpenDiscrepancies(db)).toEqual([]);
  });

  it('una importación en dryRun no aplica nada', () => {
    new ImportExportService(db).importCustomers({ items: [{ id: 'c9', name: 'Ana', document: '30111222' }], dryRun: true });
    expect(listOpenDiscrepancies(db)).toHaveLength(1);
  });
});
