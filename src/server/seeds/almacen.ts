import type { SeedProduct } from './types.ts';

export const ALMACEN_PRODUCTS: SeedProduct[] = [
  { sku: 'ALM-001', name: 'Leche Entera Larga Vida 1L', price: 1400, category: 'Lácteos', barcodes: ['779333001'], stock: 60 },
  { sku: 'ALM-002', name: 'Queso Cremoso Fraccionado 1kg', price: 7800, category: 'Fiambrería', barcodes: ['779333002'], stock: 20 },
  { sku: 'ALM-003', name: 'Arroz Blanco Largo Fino 1kg', price: 1900, category: 'Almacén', barcodes: ['779333003'], stock: 45 },
  { sku: 'ALM-004', name: 'Fideos Tallarines 500g', price: 1200, category: 'Almacén', barcodes: ['779333004'], stock: 50 },
  { sku: 'ALM-005', name: 'Aceite de Girasol 900ml', price: 2300, category: 'Almacén', barcodes: ['779333005'], stock: 36 },
  { sku: 'ALM-006', name: 'Lavandina Clásica 1L', price: 1100, category: 'Limpieza', barcodes: ['779333006'], stock: 40 },
  { sku: 'ALM-007', name: 'Jabón Líquido para Ropa 800ml', price: 3400, category: 'Limpieza', barcodes: ['779333007'], stock: 24 },
];
