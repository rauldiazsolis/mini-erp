import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ImportService } from '../src/server/io/import-service.ts';

const now = '2026-10-03T12:00:00.000Z';
const EXCEL =
  'Código;Cód. Barras;Descripción;P. Venta;IVA;Stock Central\r\n' +
  'YER1;7790001;Yerba 1kg;3.500,50;21%;12\r\n' +
  ';7790002|7790003;Azúcar 1kg;1.200;10,5;4\r\n' +
  ';;Fideos 500g;900;;\r\n';

describe('importación de productos y stock (#22)', () => {
  let db: DatabaseSync;
  let service: ImportService;

  beforeEach(() => {
    const tm = new TenantManager(openSystemDb(':memory:'), { inMemory: true });
    tm.createTenant({ id: 't1', slug: 't1', name: 'T1', seedDemoData: false });
    db = tm.getTenantDb('t1');
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('branch-norte', 'Norte', 'NORTE', ?)").run(now);
    service = new ImportService(db);
  });

  it('crea con SKU propio, del código de barras o correlativo, IVA normalizado y stock en la sucursal mapeada', () => {
    const p = service.run('products', { csv: EXCEL, dryRun: false }, now);
    expect(p.totals).toEqual({ create: 3, update: 0, unchanged: 0, error: 0 });
    expect(db.prepare('SELECT sku, barcodes, name, price, tax_rate FROM products ORDER BY name').all()).toEqual([
      { sku: '7790002', barcodes: '["7790002","7790003"]', name: 'Azúcar 1kg', price: 1200, tax_rate: 0.105 },
      { sku: 'IMP-000001', barcodes: '[]', name: 'Fideos 500g', price: 900, tax_rate: 0.21 },
      { sku: 'YER1', barcodes: '["7790001"]', name: 'Yerba 1kg', price: 3500.5, tax_rate: 0.21 },
    ]);
    const stock = db
      .prepare('SELECT p.sku, s.branch_id, s.quantity FROM stock s JOIN products p ON p.id = s.product_id WHERE s.quantity != 0 ORDER BY p.sku')
      .all();
    expect(stock).toEqual([
      { sku: '7790002', branch_id: 'branch-central', quantity: 4 },
      { sku: 'YER1', branch_id: 'branch-central', quantity: 12 },
    ]);
    expect(db.prepare('SELECT reason, notes, delta FROM stock_movements ORDER BY delta').all()).toEqual([
      { reason: 'inventory_count', notes: 'Importación', delta: 4 },
      { reason: 'inventory_count', notes: 'Importación', delta: 12 },
    ]);
  });

  it('la vista previa no escribe nada', () => {
    expect(service.run('products', { csv: EXCEL, dryRun: true }, now).totals.create).toBe(3);
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual({ n: 0 });
  });

  it('reimportar el mismo archivo da "sin cambios" y no genera movimientos', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const again = service.run('products', { csv: EXCEL, dryRun: false }, now);
    expect(again.totals).toEqual({ create: 0, update: 0, unchanged: 3, error: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 3 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM stock_movements').get()).toEqual({ n: 2 });
  });

  it('un archivo de código + stock solo actualiza, y no toca lo que no está mapeado', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('products', { csv: 'EAN;Stock Norte\n7790003;7\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(db.prepare("SELECT name, price FROM products WHERE sku = '7790002'").get()).toEqual({ name: 'Azúcar 1kg', price: 1200 });
    expect(
      db.prepare("SELECT quantity FROM stock WHERE branch_id = 'branch-norte' AND product_id = (SELECT id FROM products WHERE sku = '7790002')").get(),
    ).toEqual({ quantity: 7 });
  });

  it('una columna "Stock" genérica con dos sucursales pide elegir y no deja confirmar', () => {
    const csv = 'Nombre;Precio;Stock\nPan;100;3\n';
    expect(service.run('products', { csv, dryRun: true }, now).needsBranch).toEqual([2]);
    expect(() => service.run('products', { csv, dryRun: false }, now)).toThrow(/Asigná/);
    const ok = service.run('products', { csv, dryRun: false, mapping: { '0': 'name', '1': 'price', '2': 'stock:branch-norte' } }, now);
    expect(ok.totals.create).toBe(1);
  });

  it('errores: sin precio para crear, precio negativo, IVA fuera de rango, SKU y código de productos distintos', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const csv =
      'SKU;Código de barras;Nombre;Precio;IVA\n' +
      ';;Nuevo;;\n' +
      ';;Otro;-5;\n' +
      ';;Otro2;10;150\n' +
      'YER1;7790002;Choque;10;\n' +
      'YER1;7790003;Azúcar;;\n';
    expect(service.run('products', { csv, dryRun: true }, now).rows.map((r) => r.messages[0])).toEqual([
      'Falta el precio para crearlo',
      'Precio: no puede ser negativo',
      'IVA: tiene que estar entre 0 y 100 %',
      'El SKU y el código de barras son de productos distintos',
      'El SKU y el código de barras son de productos distintos',
    ]);
  });

  it('sin códigos se reconoce por nombre normalizado', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('products', { csv: 'Nombre;Precio\nfideos 500G;950\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(db.prepare("SELECT price FROM products WHERE sku = 'IMP-000001'").get()).toEqual({ price: 950 });
  });

  it('reconocido por el código de barras, toma el SKU nuevo del archivo', () => {
    service.run('products', { csv: EXCEL, dryRun: false }, now);
    const p = service.run('products', { csv: 'Cód. Barras;SKU\n7790001;YER-NUEVO\n', dryRun: false }, now);
    expect(p.rows[0]).toMatchObject({ action: 'update' });
    expect(db.prepare("SELECT name FROM products WHERE sku = 'YER-NUEVO'").get()).toEqual({ name: 'Yerba 1kg' });
  });
});
