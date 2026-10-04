import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ImportService } from '../src/server/io/import-service.ts';
import { applyToBalance } from '../src/server/customer/account-ledger.ts';
import { recordDiscrepancy } from '../src/server/discrepancy/discrepancies.ts';

const EXCEL = 'Razón Social;DNI;Celular;Deuda\r\nPérez Juan;20.123.456;11 5555-1234;12.345,50\r\nAna Gómez;;;0\r\n';

function movements(db: DatabaseSync, customerId: string) {
  return db
    .prepare('SELECT type, amount, balance_after, description FROM account_movements WHERE customer_id = ? ORDER BY rowid')
    .all(customerId);
}

describe('importación de clientes (#22)', () => {
  let db: DatabaseSync;
  let service: ImportService;
  const now = '2026-10-03T12:00:00.000Z';

  beforeEach(() => {
    const tm = new TenantManager(openSystemDb(':memory:'), { inMemory: true });
    tm.createTenant({ id: 't1', slug: 't1', name: 'T1', seedDemoData: false });
    db = tm.getTenantDb('t1');
    service = new ImportService(db);
  });

  it('la vista previa no escribe nada y cuenta lo que haría', () => {
    const p = service.run('customers', { csv: EXCEL, dryRun: true }, now);
    expect(p.totals).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });
    expect(p.rows.map((r) => [r.line, r.key, r.action])).toEqual([
      [2, '20.123.456', 'create'],
      [3, 'Ana Gómez', 'create'],
    ]);
    expect(p.columns[0]).toEqual({ index: 0, header: 'Razón Social', samples: ['Pérez Juan', 'Ana Gómez'] });
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 0 });
  });

  it('confirma: el saldo entra como "Saldo inicial (importado)" en el extracto', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = db.prepare("SELECT id, document, phone, balance FROM customers WHERE name = 'Pérez Juan'").get() as { id: string };
    expect(juan).toMatchObject({ document: '20.123.456', phone: '11 5555-1234', balance: 12345.5 });
    expect(movements(db, juan.id)).toEqual([
      { type: 'opening', amount: 12345.5, balance_after: 12345.5, description: 'Saldo inicial (importado)' },
    ]);
  });

  it('reimportar el mismo archivo no duplica clientes ni movimientos', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const again = service.run('customers', { csv: EXCEL, dryRun: false }, now);
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM customers').get()).toEqual({ n: 2 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM account_movements').get()).toEqual({ n: 1 });
  });

  it('reconoce por documento sin puntos y, sin documento, por nombre normalizado', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('customers', { csv: 'Nombre;DNI;Teléfono\nJuan Pérez;20123456;111\n  ana  gomez ;;222\n', dryRun: false }, now);
    expect(p.rows.map((r) => r.action)).toEqual(['update', 'update']);
    // "ana  gomez" reconoce a "Ana Gómez"; el nombre mapeado se actualiza tal cual viene
    expect(db.prepare('SELECT name, phone FROM customers ORDER BY phone').all()).toEqual([
      { name: 'Juan Pérez', phone: '111' },
      { name: 'ana  gomez', phone: '222' },
    ]);
  });

  it('corrige el saldo si solo tiene movimientos de importación', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    service.run('customers', { csv: 'DNI;Saldo\n20123456;10000\n', dryRun: false }, now);
    const juan = db.prepare("SELECT id, balance FROM customers WHERE document = '20.123.456'").get() as { id: string; balance: number };
    expect(juan.balance).toBe(10000);
    expect(movements(db, juan.id)).toEqual([
      { type: 'opening', amount: 12345.5, balance_after: 12345.5, description: 'Saldo inicial (importado)' },
      { type: 'opening', amount: -2345.5, balance_after: 10000, description: 'Saldo inicial (corrección)' },
    ]);
  });

  it('con movimientos posteriores no toca el saldo y avisa en la fila', () => {
    service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = db.prepare("SELECT id FROM customers WHERE document = '20.123.456'").get() as { id: string };
    applyToBalance(db, juan.id, { type: 'sale', delta: 500, description: 'Venta' }, now);
    const p = service.run('customers', { csv: 'DNI;Saldo;Celular\n20123456;0;999\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update', messages: ['Tiene movimientos posteriores: el saldo no se cambia'] });
    expect(db.prepare('SELECT balance, phone FROM customers WHERE id = ?').get(juan.id)).toEqual({ balance: 12845.5, phone: '999' });
  });

  it('errores por fila: sin nombre para crear, número inválido, nombre ambiguo y repetida', () => {
    // Dos clientes con el mismo nombre (cargados a mano en el admin, por ejemplo)
    const insert = db.prepare("INSERT INTO customers (id, name, created_at, updated_at) VALUES (?, 'Repetido', ?, ?)");
    insert.run('c-1', now, now);
    insert.run('c-2', now, now);
    const csv = 'Nombre;DNI;Deuda\n;30111222;10\nZoe;;abc\nZoe;;5\nRepetido;;1\n';
    const p = service.run('customers', { csv, dryRun: true }, now);
    expect(p.rows.map((r) => [r.action, r.messages[0]])).toEqual([
      ['error', 'Falta el nombre para crearlo'],
      ['error', 'Saldo: no es un número'],
      ['create', undefined],
      ['error', 'Hay 2 clientes con ese nombre'],
    ]);
    const dup = service.run('customers', { csv: 'Nombre\nLuz\nluz\n', dryRun: true }, now);
    expect(dup.rows[1]).toMatchObject({ action: 'error', messages: ['Repetida: ver la línea 2'] });
  });

  it('con la columna id aplica los movimientos pendientes del POS (discrepancias)', () => {
    recordDiscrepancy(
      db,
      {
        kind: 'unknown-customer',
        deviceId: 'dev-1',
        originBranch: 'CENTRAL',
        originPos: 'Caja 1',
        customerId: 'cust-pos-1',
        refType: 'sale',
        refId: 's1',
        amount: 700,
        pending: { type: 'sale', delta: 700, description: 'Venta a cuenta' },
      },
      now,
    );
    service.run('customers', { csv: 'id,name,balance\ncust-pos-1,Carla,100\n', dryRun: false }, now);
    expect(db.prepare("SELECT balance FROM customers WHERE id = 'cust-pos-1'").get()).toEqual({ balance: 800 });
  });

  it('sin columna que identifique las filas: missing y la confirmación da 400', () => {
    const csv = 'Celular;Deuda\n111;10\n';
    expect(service.run('customers', { csv, dryRun: true }, now).missing).toEqual(['name']);
    expect(() => service.run('customers', { csv, dryRun: false }, now)).toThrow(/Asigná/);
  });

  it('un mapeo de afuera con un campo de otra entidad o una columna que no existe: error', () => {
    expect(() => service.run('customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'price' } }, now)).toThrow(/Campo desconocido/);
    expect(() => service.run('customers', { csv: EXCEL, dryRun: true, mapping: { '9': 'name' } }, now)).toThrow(/no existe/);
    expect(() => service.run('customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'name', '1': 'name' } }, now)).toThrow(/dos columnas/);
  });
});
