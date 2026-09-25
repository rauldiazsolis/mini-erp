import type { SeedProduct } from './types.ts';

export const KIOSCO_PRODUCTS: SeedProduct[] = [
  { sku: 'KIO-001', name: 'Alfajor Triple Dulce de Leche', price: 950, category: 'Golosinas', barcodes: ['779111001'], stock: 48 },
  { sku: 'KIO-002', name: 'Chicles Menta Fuerte 5u', price: 500, category: 'Golosinas', barcodes: ['779111002'], stock: 60 },
  { sku: 'KIO-003', name: 'Caramelos Surtidos 100g', price: 750, category: 'Golosinas', barcodes: ['779111003'], stock: 35 },
  { sku: 'KIO-004', name: 'Gaseosa Cola 500ml', price: 1500, category: 'Bebidas', barcodes: ['779111004'], stock: 72 },
  { sku: 'KIO-005', name: 'Agua Mineral sin gas 500ml', price: 1000, category: 'Bebidas', barcodes: ['779111005'], stock: 80 },
  { sku: 'KIO-006', name: 'Papas Fritas Clásicas 85g', price: 1600, category: 'Snacks', barcodes: ['779111006'], stock: 25 },
  { sku: 'KIO-007', name: 'Cigarrillos Rubios 20u', price: 3200, category: 'Tabaquería', barcodes: ['779111007'], stock: 40 },
  { sku: 'KIO-008', name: 'Chocolate con Maní 80g', price: 1300, category: 'Golosinas', barcodes: ['779111008'], stock: 30 },
];
