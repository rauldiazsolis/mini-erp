import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ImportService } from '../src/server/io/import-service.ts';
import { applyToBalance } from '../src/server/customer/account-ledger.ts';
import { recordDiscrepancy } from '../src/server/discrepancy/discrepancies.ts';
import { setupTestDb } from './helpers/test-db.ts';
import { waitForBlockedQuery } from './helpers/blocked-query.ts';

const pgDb = setupTestDb();

const EXCEL = 'Razón Social;DNI;Celular;Deuda\r\nPérez Juan;20.123.456;11 5555-1234;12.345,50\r\nAna Gómez;;;0\r\n';

async function movements(db: Kysely<TenantDatabase>, customerId: string) {
  return await db
    .selectFrom('account_movements')
    .select(['type', 'amount', 'balance_after', 'description'])
    .where('customer_id', '=', customerId)
    .orderBy('seq')
    .execute();
}

async function count(db: Kysely<TenantDatabase>, table: 'customers' | 'account_movements'): Promise<number> {
  const row = await db
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number>().as('n'))
    .executeTakeFirstOrThrow();
  return row.n;
}

describe('importación de clientes (#22)', () => {
  let db: Kysely<TenantDatabase>;
  let service: ImportService;
  const now = '2026-10-03T12:00:00.000Z';

  beforeEach(async () => {
    const tm = new TenantManager(pgDb(), { inMemory: true });
    await tm.createTenant({ id: 't1', slug: 't1', name: 'T1', seedDemoData: false });
    db = pgDb().forTenant('t1');
    service = new ImportService(db);
  });

  it('la vista previa no escribe nada y cuenta lo que haría', async () => {
    const p = await service.run('customers', { csv: EXCEL, dryRun: true }, now);
    expect(p.totals).toEqual({ create: 2, update: 0, unchanged: 0, error: 0 });
    expect(p.rows.map((r) => [r.line, r.key, r.action])).toEqual([
      [2, '20.123.456', 'create'],
      [3, 'Ana Gómez', 'create'],
    ]);
    expect(p.columns[0]).toEqual({ index: 0, header: 'Razón Social', samples: ['Pérez Juan', 'Ana Gómez'] });
    expect(await count(db, 'customers')).toBe(0);
  });

  it('confirma: el saldo entra como "Saldo inicial (importado)" en el extracto', async () => {
    await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = await db.selectFrom('customers').select(['id', 'document', 'phone', 'balance']).where('name', '=', 'Pérez Juan').executeTakeFirstOrThrow();
    expect(juan).toMatchObject({ document: '20.123.456', phone: '11 5555-1234', balance: 12345.5 });
    expect(await movements(db, juan.id)).toEqual([
      { type: 'opening', amount: 12345.5, balance_after: 12345.5, description: 'Saldo inicial (importado)' },
    ]);
  });

  it('reimportar el mismo archivo no duplica clientes ni movimientos', async () => {
    await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const again = await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 2, error: 0 });
    expect(await count(db, 'customers')).toBe(2);
    expect(await count(db, 'account_movements')).toBe(1);
  });

  it('reconoce por documento sin puntos y, sin documento, por nombre normalizado', async () => {
    await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const p = await service.run('customers', { csv: 'Nombre;DNI;Teléfono\nJuan Pérez;20123456;111\n  ana  gomez ;;222\n', dryRun: false }, now);
    expect(p.rows.map((r) => r.action)).toEqual(['update', 'update']);
    // "ana  gomez" reconoce a "Ana Gómez"; el nombre mapeado se actualiza tal cual viene
    expect(await db.selectFrom('customers').select(['name', 'phone']).orderBy('phone').execute()).toEqual([
      { name: 'Juan Pérez', phone: '111' },
      { name: 'ana  gomez', phone: '222' },
    ]);
  });

  it('corrige el saldo si solo tiene movimientos de importación', async () => {
    await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    await service.run('customers', { csv: 'DNI;Saldo\n20123456;10000\n', dryRun: false }, now);
    const juan = await db.selectFrom('customers').select(['id', 'balance']).where('document', '=', '20.123.456').executeTakeFirstOrThrow();
    expect(juan.balance).toBe(10000);
    expect(await movements(db, juan.id)).toEqual([
      { type: 'opening', amount: 12345.5, balance_after: 12345.5, description: 'Saldo inicial (importado)' },
      { type: 'opening', amount: -2345.5, balance_after: 10000, description: 'Saldo inicial (corrección)' },
    ]);
  });

  it('con movimientos posteriores no toca el saldo y avisa en la fila', async () => {
    await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = await db.selectFrom('customers').select('id').where('document', '=', '20.123.456').executeTakeFirstOrThrow();
    await applyToBalance(db, juan.id, { type: 'sale', delta: 500, description: 'Venta' }, now);
    const p = await service.run('customers', { csv: 'DNI;Saldo;Celular\n20123456;0;999\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update', messages: ['Tiene movimientos posteriores: el saldo no se cambia'] });
    expect(await db.selectFrom('customers').select(['balance', 'phone']).where('id', '=', juan.id).executeTakeFirstOrThrow()).toEqual({
      balance: 12845.5,
      phone: '999',
    });
  });

  it('errores por fila: sin nombre para crear, número inválido, nombre ambiguo y repetida', async () => {
    // Dos clientes con el mismo nombre (cargados a mano en el admin, por ejemplo)
    await db
      .insertInto('customers')
      .values(['c-1', 'c-2'].map((id) => ({ id, name: 'Repetido', created_at: now, updated_at: now })))
      .execute();
    const csv = 'Nombre;DNI;Deuda\n;30111222;10\nZoe;;abc\nZoe;;5\nRepetido;;1\n';
    const p = await service.run('customers', { csv, dryRun: true }, now);
    expect(p.rows.map((r) => [r.action, r.messages[0]])).toEqual([
      ['error', 'Falta el nombre para crearlo'],
      ['error', 'Saldo: no es un número'],
      ['create', undefined],
      ['error', 'Hay 2 clientes con ese nombre'],
    ]);
    const dup = await service.run('customers', { csv: 'Nombre\nLuz\nluz\n', dryRun: true }, now);
    expect(dup.rows[1]).toMatchObject({ action: 'error', messages: ['Repetida: ver la línea 2'] });
  });

  it('con la columna id aplica los movimientos pendientes del POS (discrepancias)', async () => {
    await recordDiscrepancy(
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
    await service.run('customers', { csv: 'id,name,balance\ncust-pos-1,Carla,100\n', dryRun: false }, now);
    expect(await db.selectFrom('customers').select('balance').where('id', '=', 'cust-pos-1').executeTakeFirstOrThrow()).toEqual({ balance: 800 });
  });

  it('sin columna que identifique las filas: missing y la confirmación da 400', async () => {
    const csv = 'Celular;Deuda\n111;10\n';
    expect((await service.run('customers', { csv, dryRun: true }, now)).missing).toEqual(['name']);
    await expect(service.run('customers', { csv, dryRun: false }, now)).rejects.toThrow(/Asigná/);
  });

  it('un mapeo de afuera con un campo de otra entidad o una columna que no existe: error', async () => {
    await expect(service.run('customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'price' } }, now)).rejects.toThrow(/Campo desconocido/);
    await expect(service.run('customers', { csv: EXCEL, dryRun: true, mapping: { '9': 'name' } }, now)).rejects.toThrow(/no existe/);
    await expect(service.run('customers', { csv: EXCEL, dryRun: true, mapping: { '0': 'name', '1': 'name' } }, now)).rejects.toThrow(/dos columnas/);
  });

  // Decisión 2 de la fase 4: un importe que no entra tal cual en la columna es un error de la fila
  it('un límite, un margen o un saldo con más de 2 decimales da el error en la fila y el resto se importa', async () => {
    const csv = 'Nombre;Límite;Margen;Saldo\nAna;100,123;;\nBeto;;5,555;\nCarla;;;10,001\nDora;100,10;5,5;10\nEva;;;9999999999999\n';
    const mapping = { '0': 'name', '1': 'creditLimit', '2': 'margin', '3': 'balance' } as const;
    const preview = await service.run('customers', { csv, mapping, dryRun: true }, now);
    expect(preview.rows.map((r) => [r.key, r.action, r.messages[0]])).toEqual([
      ['Ana', 'error', 'Límite de crédito: importe inválido (hasta 2 decimales)'],
      ['Beto', 'error', 'Margen: importe inválido (hasta 2 decimales)'],
      ['Carla', 'error', 'Saldo: importe inválido (hasta 2 decimales)'],
      ['Dora', 'create', undefined],
      ['Eva', 'error', 'Saldo: importe inválido (hasta 2 decimales)'],
    ]);
    const done = await service.run('customers', { csv, mapping, dryRun: false }, now);
    expect(done.totals).toEqual({ create: 1, update: 0, unchanged: 0, error: 4 });
    expect(await db.selectFrom('customers').select(['name', 'credit_limit', 'margin', 'balance']).execute()).toEqual([
      { name: 'Dora', credit_limit: 100.1, margin: 5.5, balance: 10 },
    ]);
  });

  it('dos filas distintas que dan con el mismo cliente (id y documento): la segunda ve lo que dejó la primera', async () => {
    await service.run('customers', { csv: EXCEL, dryRun: false }, now);
    const juan = await db.selectFrom('customers').select('id').where('document', '=', '20.123.456').executeTakeFirstOrThrow();
    const csv = `id;DNI;Saldo\n${juan.id};;10000\n;20123456;10000\n`;
    const p = await service.run('customers', { csv, dryRun: false }, now);
    expect(p.rows.map((r) => r.action)).toEqual(['update', 'unchanged']);
    expect(await count(db, 'account_movements')).toBe(2);
  });

  it('un error de la base en una fila (un id que otro cargó a la vez) queda en esa fila y las demás se importan', async () => {
    // Otra transacción crea a `c-carrera` y no confirma hasta que la importación queda esperándola
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const other = db.transaction().execute(async (trx) => {
      await trx.insertInto('customers').values({ id: 'c-carrera', name: 'Otro', created_at: now, updated_at: now }).execute();
      ready();
      await gate;
    });
    await inserted;
    const running = service.run('customers', { csv: 'id;Nombre\nc-antes;Ana\nc-carrera;Beto\nc-despues;Carla\n', dryRun: false }, now);
    await waitForBlockedQuery(pgDb());
    release();
    await other;
    const p = await running;
    expect(p.rows.map((r) => [r.key, r.action, r.messages[0]])).toEqual([
      ['Ana', 'create', undefined],
      ['Beto', 'error', 'Ya existe: se cargó mientras se importaba. Volvé a importar el archivo'],
      ['Carla', 'create', undefined],
    ]);
    expect(await db.selectFrom('customers').select(['id', 'name']).orderBy('id').execute()).toEqual([
      { id: 'c-antes', name: 'Ana' },
      { id: 'c-carrera', name: 'Otro' },
      { id: 'c-despues', name: 'Carla' },
    ]);
  });
});
