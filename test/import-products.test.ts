import { describe, it, expect, beforeEach } from 'vitest';
import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../src/server/db/pg/tenant-schema.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ImportService } from '../src/server/io/import-service.ts';
import { setupTestDb } from './helpers/test-db.ts';
import { waitForBlockedQuery } from './helpers/blocked-query.ts';

const pgDb = setupTestDb();

const now = '2026-10-03T12:00:00.000Z';
const EXCEL =
  'Código;Cód. Barras;Descripción;P. Venta;IVA;Stock Central\r\n' +
  'YER1;7790001;Yerba 1kg;3.500,50;21%;12\r\n' +
  ';7790002|7790003;Azúcar 1kg;1.200;10,5;4\r\n' +
  ';;Fideos 500g;900;;\r\n';

describe('importación de productos y stock (#22)', () => {
  let db: Kysely<TenantDatabase>;

  const count = async (table: 'products' | 'stock_movements'): Promise<number> => {
    const row = await db
      .selectFrom(table)
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    return row.n;
  };
  let service: ImportService;

  beforeEach(async () => {
    const tm = new TenantManager(pgDb(), { inMemory: true });
    await tm.createTenant({ id: 't1', slug: 't1', name: 'T1', seedDemoData: false });
    db = pgDb().forTenant('t1');
    await db.insertInto('branches').values({ id: 'branch-norte', name: 'Norte', code: 'NORTE', created_at: now }).execute();
    service = new ImportService(db);
  });

  it('crea con SKU propio, del código de barras o correlativo, IVA normalizado y stock en la sucursal mapeada', async () => {
    const p = await service.run('products', { csv: EXCEL, dryRun: false }, now);
    expect(p.totals).toEqual({ create: 3, update: 0, unchanged: 0, error: 0 });
    expect(await db.selectFrom('products').select(['sku', 'barcodes', 'name', 'price', 'tax_rate']).orderBy('name').execute()).toEqual([
      { sku: '7790002', barcodes: ['7790002', '7790003'], name: 'Azúcar 1kg', price: 1200, tax_rate: 0.105 },
      { sku: 'IMP-000001', barcodes: [], name: 'Fideos 500g', price: 900, tax_rate: 0.21 },
      { sku: 'YER1', barcodes: ['7790001'], name: 'Yerba 1kg', price: 3500.5, tax_rate: 0.21 },
    ]);
    const stock = await db
      .selectFrom('stock as s')
      .innerJoin('products as p', 'p.id', 's.product_id')
      .select(['p.sku', 's.branch_id', 's.quantity'])
      .where('s.quantity', '!=', 0)
      .orderBy('p.sku')
      .execute();
    expect(stock).toEqual([
      { sku: '7790002', branch_id: 'branch-central', quantity: 4 },
      { sku: 'YER1', branch_id: 'branch-central', quantity: 12 },
    ]);
    expect(await db.selectFrom('stock_movements').select(['reason', 'notes', 'delta']).orderBy('delta').execute()).toEqual([
      { reason: 'inventory_count', notes: 'Importación', delta: 4 },
      { reason: 'inventory_count', notes: 'Importación', delta: 12 },
    ]);
  });

  it('la vista previa no escribe nada', async () => {
    expect((await service.run('products', { csv: EXCEL, dryRun: true }, now)).totals.create).toBe(3);
    expect(await count('products')).toBe(0);
    expect(await count('stock_movements')).toBe(0);
  });

  it('reimportar el mismo archivo da "sin cambios" y no genera movimientos', async () => {
    await service.run('products', { csv: EXCEL, dryRun: false }, now);
    const again = await service.run('products', { csv: EXCEL, dryRun: false }, now);
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 3, error: 0 });
    expect(await count('products')).toBe(3);
    expect(await count('stock_movements')).toBe(2);
  });

  it('un archivo de código + stock solo actualiza, y no toca lo que no está mapeado', async () => {
    await service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = await service.run('products', { csv: 'EAN;Stock Norte\n7790003;7\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    const azucar = await db.selectFrom('products').select(['id', 'name', 'price']).where('sku', '=', '7790002').executeTakeFirstOrThrow();
    expect(azucar).toMatchObject({ name: 'Azúcar 1kg', price: 1200 });
    expect(
      await db.selectFrom('stock').select('quantity').where('branch_id', '=', 'branch-norte').where('product_id', '=', azucar.id).executeTakeFirstOrThrow(),
    ).toEqual({ quantity: 7 });
  });

  it('una columna "Stock" genérica con dos sucursales pide elegir y no deja confirmar', async () => {
    const csv = 'Nombre;Precio;Stock\nPan;100;3\n';
    expect((await service.run('products', { csv, dryRun: true }, now)).needsBranch).toEqual([2]);
    await expect(service.run('products', { csv, dryRun: false }, now)).rejects.toThrow(/Asigná/);
    const ok = await service.run('products', { csv, dryRun: false, mapping: { '0': 'name', '1': 'price', '2': 'stock:branch-norte' } }, now);
    expect(ok.totals.create).toBe(1);
  });

  it('errores: sin precio para crear, precio negativo, IVA fuera de rango, SKU y código de productos distintos', async () => {
    await service.run('products', { csv: EXCEL, dryRun: false }, now);
    const csv =
      'SKU;Código de barras;Nombre;Precio;IVA\n' +
      ';;Nuevo;;\n' +
      ';;Otro;-5;\n' +
      ';;Otro2;10;150\n' +
      'YER1;7790002;Choque;10;\n' +
      'YER1;7790003;Azúcar;;\n';
    expect((await service.run('products', { csv, dryRun: true }, now)).rows.map((r) => r.messages[0])).toEqual([
      'Falta el precio para crearlo',
      'Precio: no puede ser negativo',
      'IVA: tiene que estar entre 0 y 100 %',
      'El SKU y el código de barras son de productos distintos',
      'El SKU y el código de barras son de productos distintos',
    ]);
  });

  it('sin códigos se reconoce por nombre normalizado', async () => {
    await service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = await service.run('products', { csv: 'Nombre;Precio\nfideos 500G;950\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(await db.selectFrom('products').select('price').where('sku', '=', 'IMP-000001').executeTakeFirstOrThrow()).toEqual({ price: 950 });
  });

  it('reconocido por el código de barras, toma el SKU nuevo del archivo', async () => {
    await service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = await service.run('products', { csv: 'Cód. Barras;SKU\n7790001;YER-NUEVO\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(await db.selectFrom('products').select('name').where('sku', '=', 'YER-NUEVO').executeTakeFirstOrThrow()).toEqual({ name: 'Yerba 1kg' });
  });

  // Decisión 2 de la fase 4: un importe que no entra tal cual en la columna es un error de la fila
  it('un precio con más de 2 decimales o fuera del tope da el error en la fila y el resto se importa', async () => {
    const csv = 'Nombre;Precio\nPan;100,125\nLeche;9999999999999\nQueso;100,12\n';
    const preview = await service.run('products', { csv, dryRun: true }, now);
    expect(preview.rows.map((r) => [r.key, r.action, r.messages[0]])).toEqual([
      ['Pan', 'error', 'Precio: importe inválido (hasta 2 decimales)'],
      ['Leche', 'error', 'Precio: importe inválido (hasta 2 decimales)'],
      ['Queso', 'create', undefined],
    ]);
    const done = await service.run('products', { csv, dryRun: false }, now);
    expect(done.totals).toEqual({ create: 1, update: 0, unchanged: 0, error: 2 });
    expect(await db.selectFrom('products').select(['name', 'price']).execute()).toEqual([{ name: 'Queso', price: 100.12 }]);
  });

  it('el stock se guarda con 4 decimales (reimportarlo no lo cambia) y una cantidad que no entra es un error de la fila', async () => {
    const csv = 'Nombre;Precio;Stock Central\nJamón;100;1,23456\nQueso;100;99999999999\n';
    const p = await service.run('products', { csv, dryRun: false }, now);
    expect(p.rows.map((r) => [r.key, r.action, r.messages[0]])).toEqual([
      ['Jamón', 'create', undefined],
      ['Queso', 'error', 'Stock · Sucursal Central: cantidad inválida'],
    ]);
    expect(await db.selectFrom('stock').select(['branch_id', 'quantity']).where('quantity', '!=', 0).execute()).toEqual([
      { branch_id: 'branch-central', quantity: 1.2346 },
    ]);
    const again = await service.run('products', { csv, dryRun: false }, now);
    expect(again.rows[0]).toMatchObject({ action: 'unchanged' });
    expect(await count('stock_movements')).toBe(1);
  });

  it('una fila corregida más abajo en el mismo archivo entra, y la que repite una ya aplicada no', async () => {
    const csv = 'SKU;Nombre;Precio\nA1;Pan;abc\nA1;Pan;100\nA1;Pan;200\n';
    const p = await service.run('products', { csv, dryRun: false }, now);
    expect(p.rows.map((r) => [r.action, r.messages[0]])).toEqual([
      ['error', 'Precio: no es un número'],
      ['create', undefined],
      ['error', 'Repetida: ver la línea 3'],
    ]);
  });

  it('un error de la base en una fila (un SKU que otro cargó a la vez) queda en esa fila y las demás se importan', async () => {
    // Otra transacción crea el SKU `B2` y no confirma hasta que la importación queda esperándola
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let ready: () => void = () => undefined;
    const inserted = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const other = db.transaction().execute(async (trx) => {
      await trx.insertInto('products').values({ id: 'p-otro', sku: 'B2', name: 'De otro', price: 1, created_at: now, updated_at: now }).execute();
      ready();
      await gate;
    });
    await inserted;
    const running = service.run('products', { csv: 'SKU;Nombre;Precio;Stock Central\nB1;Uno;10;5\nB2;Dos;20;5\nB3;Tres;30;5\n', dryRun: false }, now);
    await waitForBlockedQuery(pgDb());
    release();
    await other;
    const p = await running;
    expect(p.rows.map((r) => [r.key, r.action, r.messages[0]])).toEqual([
      ['B1', 'create', undefined],
      ['B2', 'error', 'Ya existe: se cargó mientras se importaba. Volvé a importar el archivo'],
      ['B3', 'create', undefined],
    ]);
    expect(await db.selectFrom('products').select(['sku', 'name']).orderBy('sku').execute()).toEqual([
      { sku: 'B1', name: 'Uno' },
      { sku: 'B2', name: 'De otro' },
      { sku: 'B3', name: 'Tres' },
    ]);
    // Lo de la fila que falló se deshizo entero: ni stock ni kardex de un producto que no se creó
    expect(await count('stock_movements')).toBe(2);
  });
});
