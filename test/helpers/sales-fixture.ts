import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';

export const D1 = '2026-10-01';
export const D2 = '2026-10-02';
const caja1 = { branch: 'CENTRAL', pointOfSale: 'Caja 1' };
const caja2 = { branch: 'CENTRAL', pointOfSale: 'Caja 2' };

function ev(id: string, type: string, createdAt: string, origin: { branch: string; pointOfSale: string }, body: Record<string, unknown>) {
  return { id, type, createdAt, origin, ...body };
}

const sale = (id: string, createdAt: string, day: string, number: number, rest: Record<string, unknown>) => ({
  sale: { id, status: 'closed', createdAt, ticket: { date: day, number }, ...rest },
});

/**
 * Datos de Ventas & Caja (#20), por el Connector API (con una key de `CENTRAL · Caja 1`):
 * - D1, Caja 1: s1 (efectivo 1000, anulada en D2), s2 (débito 450, Ana, descuento de línea), cobranza
 *   cp1 (Ana, efectivo 700, anulada en D2), ingreso 2000, egreso 500 y arqueo −150.
 * - D1, Caja 2: s3 (medio desconocido 300, línea libre y un producto borrado).
 * - D2, Caja 1: s4 (anulación de s1), s5 (devolución −200 en efectivo), cp2 (anulación de cp1).
 */
export async function seedSalesFixture(app: Express, token: string, tenantId: string, tenantDb: DatabaseSync): Promise<void> {
  // El producto va directo a la base: el detalle del ticket busca su nombre por id
  const at = `${D1}T09:00:00.000Z`;
  tenantDb
    .prepare("INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES ('p1', 'ALF-1', 'Alfajor', 500, ?, ?)")
    .run(at, at);
  const key = await request(app)
    .post(`/api/tenants/${tenantId}/api-keys`)
    .set('Authorization', `Bearer ${token}`)
    .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
  const apiKey = (key.body as { rawKey: string }).rawKey;

  const events = [
    ev('e0', 'customer', `${D1}T10:00:00.000Z`, caja1, { customer: { id: 'c1', name: 'Ana' } }),
    ev('e1', 'sale', `${D1}T13:00:00.000Z`, caja1, sale('s1', `${D1}T13:00:00.000Z`, D1, 1, {
      total: 1000, lines: [{ kind: 'product', productId: 'p1', qty: 2, unitPrice: 500 }], payments: [{ method: 'cash', amount: 1000 }],
    })),
    ev('e2', 'sale', `${D1}T14:00:00.000Z`, caja1, sale('s2', `${D1}T14:00:00.000Z`, D1, 2, {
      total: 450, customerId: 'c1',
      lines: [{ kind: 'product', productId: 'p1', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 50 } }],
      payments: [{ method: 'debit', amount: 450 }],
    })),
    ev('e3', 'sale', `${D1}T13:30:00.000Z`, caja2, sale('s3', `${D1}T13:30:00.000Z`, D1, 1, {
      total: 300,
      lines: [{ kind: 'freeform', description: 'Fotocopias', qty: 3, unitPrice: 100 }, { kind: 'product', productId: 'p-borrado', qty: 1, unitPrice: 0 }],
      payments: [{ method: 'crypto', amount: 300 }],
    })),
    ev('e4', 'sale', `${D2}T12:00:00.000Z`, caja1, sale('s4', `${D2}T12:00:00.000Z`, D2, 1, {
      total: -1000, voidsSaleId: 's1', voidReason: 'Error',
      lines: [{ kind: 'product', productId: 'p1', qty: -2, unitPrice: 500 }], payments: [{ method: 'cash', amount: -1000 }],
    })),
    ev('e5', 'sale', `${D2}T13:00:00.000Z`, caja1, sale('s5', `${D2}T13:00:00.000Z`, D2, 2, {
      total: -200, lines: [{ kind: 'freeform', description: 'Devolución', qty: -1, unitPrice: 200 }], payments: [{ method: 'cash', amount: -200 }],
    })),
    ev('e6', 'customer-payment', `${D1}T15:00:00.000Z`, caja1, {
      payment: { id: 'cp1', customerId: 'c1', total: 700, createdAt: `${D1}T15:00:00.000Z`, receipt: { date: D1, number: 1 }, payments: [{ method: 'cash', amount: 700 }] },
    }),
    ev('e7', 'customer-payment', `${D2}T14:00:00.000Z`, caja1, {
      payment: { id: 'cp2', customerId: 'c1', total: -700, voidsPaymentId: 'cp1', createdAt: `${D2}T14:00:00.000Z`, receipt: { date: D2, number: 1 }, payments: [{ method: 'cash', amount: -700 }] },
    }),
    ev('e8', 'cash-movement', `${D1}T11:00:00.000Z`, caja1, {
      movement: { id: 'm1', direction: 'in', amount: 2000, concept: 'Fondo', source: 'manual', createdAt: `${D1}T11:00:00.000Z` },
    }),
    ev('e9', 'cash-movement', `${D1}T16:00:00.000Z`, caja1, {
      movement: { id: 'm2', direction: 'out', amount: 500, concept: 'Proveedor', description: 'Pan', source: 'manual', createdAt: `${D1}T16:00:00.000Z` },
    }),
    ev('e10', 'cash-movement', `${D1}T21:00:00.000Z`, caja1, {
      movement: { id: 'm3', direction: 'out', amount: 150, concept: 'Ajuste por arqueo', source: 'count-adjustment', count: { expected: 3200, counted: 3050 }, createdAt: `${D1}T21:00:00.000Z` },
    }),
  ];
  const res = await request(app)
    .post('/connector/sync/push')
    .set('Authorization', `Bearer ${apiKey}`)
    .set('X-POS-Contract-Version', '4.4.0')
    .set('Idempotency-Key', 'fixture-ventas')
    .send({ deviceId: 'dev-1', events });
  if (res.status !== 200) {
    throw new Error(`El push del fixture falló: ${String(res.status)}`);
  }
}
