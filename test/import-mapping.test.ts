import { describe, it, expect } from 'vitest';
import { suggestMapping } from '../src/server/io/suggest-mapping.ts';
import { fieldLabel, isImportFieldName, stockBranchOf, stockField, STOCK_UNASSIGNED } from '../src/shared/import-fields.ts';

const central = { id: 'branch-central', name: 'Central', code: 'CENTRAL' };
const norte = { id: 'branch-norte', name: 'Norte', code: 'NORTE' };

describe('mapeo sugerido (#22)', () => {
  it('productos de un Excel en castellano', () => {
    const headers = ['Descripción', 'P. Venta', 'Cód. Barras', 'Código', 'Rubro', 'Stock Central', 'Observaciones'];
    expect(suggestMapping('products', headers, [central, norte])).toEqual({
      '0': 'name', '1': 'price', '2': 'barcodes', '3': 'sku', '4': 'category', '5': 'stock:branch-central', '6': null,
    });
  });

  it('clientes de un Excel en castellano', () => {
    const headers = ['Razón Social', 'DNI', 'Celular', 'Deuda', 'Límite'];
    expect(suggestMapping('customers', headers, [central])).toEqual({
      '0': 'name', '1': 'document', '2': 'phone', '3': 'balance', '4': 'creditLimit',
    });
  });

  it('el export de mini (en inglés) se reconoce', () => {
    const headers = ['id', 'name', 'document', 'phone', 'creditLimit', 'margin', 'balance', 'unrestricted', 'blockedReason'];
    expect(Object.values(suggestMapping('customers', headers, [central]))).toEqual(headers);
    const products = ['id', 'sku', 'name', 'price', 'taxRate', 'category', 'barcodes', 'tracksStock', 'blockedReason'];
    expect(Object.values(suggestMapping('products', products, [central]))).toEqual([
      null, 'sku', 'name', 'price', 'taxRate', 'category', 'barcodes', 'tracksStock', null,
    ]);
  });

  it('nunca el mismo campo en dos columnas: gana la coincidencia exacta y, a igual calidad, la primera', () => {
    expect(suggestMapping('products', ['Nombre del producto', 'Nombre', 'Precio', 'Precio venta'], [central])).toEqual({
      '0': null, '1': 'name', '2': 'price', '3': null,
    });
  });

  it('stock genérico: a la única sucursal o sin elegir si hay varias', () => {
    expect(suggestMapping('products', ['Nombre', 'Stock'], [central])['1']).toBe('stock:branch-central');
    expect(suggestMapping('products', ['Nombre', 'Cantidad'], [central, norte])['1']).toBe(STOCK_UNASSIGNED);
  });

  it('una columna por sucursal, por nombre o por código', () => {
    expect(suggestMapping('products', ['Nombre', 'Stock Central', 'NORTE'], [central, norte])).toEqual({
      '0': 'name', '1': 'stock:branch-central', '2': 'stock:branch-norte',
    });
  });

  it('en clientes no se sugiere stock', () => {
    expect(suggestMapping('customers', ['Nombre', 'Stock'], [central])).toEqual({ '0': 'name', '1': null });
  });

  it('etiquetas y nombres de campo', () => {
    expect(stockField('branch-norte')).toBe('stock:branch-norte');
    expect(stockBranchOf('stock:branch-norte')).toBe('branch-norte');
    expect(stockBranchOf('name')).toBeUndefined();
    expect(fieldLabel('stock:branch-norte', [central, norte])).toBe('Stock · Norte');
    expect(fieldLabel(STOCK_UNASSIGNED, [central, norte])).toBe('Stock · ¿qué sucursal?');
    expect(fieldLabel('creditLimit', [])).toBe('Límite de crédito');
    expect(isImportFieldName('price')).toBe(true);
    expect(isImportFieldName('stock:branch-norte')).toBe(true);
    expect(isImportFieldName('precio')).toBe(false);
  });
});
