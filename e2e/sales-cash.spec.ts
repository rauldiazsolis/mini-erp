import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { argentinaToday } from '../src/shared/argentina-day.ts';

/**
 * Criterio de aceptación de #20: con ventas, una anulación y una cobranza hechas desde el POS, el owner
 * encuentra cada una con los filtros, ve el ticket completo y el resumen del día; un click en el
 * dashboard lleva a la lista.
 */
test('ventas, anulación y cobranza del POS en Ventas & Caja, con su resumen y el drill-down', async ({ page, request }) => {
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner E2E', email: `ventas-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Ventas ${id}`, businessType: 'kiosco', whatsapp: '1155550000' },
  });
  expect(alta.status()).toBe(201);
  const { token, tenant, posKey } = (await alta.json()) as {
    token: string; tenant: { id: string }; posKey: { key: string; branch: string; pointOfSale: string };
  };
  // El alta crea el comercio vacío (#22): el catálogo de ejemplo del rubro va aparte
  await request.post(`/api/tenants/${tenant.id}/catalog/example`, { headers: { Authorization: `Bearer ${token}` } });
  const products = await request.get(`/api/tenants/${tenant.id}/products`, { headers: { Authorization: `Bearer ${token}` } });
  const [product] = (await products.json()) as { id: string; name: string; price: number }[];
  if (product === undefined) throw new Error('No se cargó el catálogo de ejemplo');

  const today = argentinaToday(new Date());
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const origin = { branch: posKey.branch, pointOfSale: posKey.pointOfSale };
  const line = (qty: number) => ({ kind: 'product', productId: product.id, qty, unitPrice: 1000 });
  const events = [
    { id: 'e0', type: 'customer', createdAt: at(30), origin, customer: { id: `c-${id}`, name: 'Ana E2E' } },
    { id: 'e1', type: 'sale', createdAt: at(20), origin, sale: { id: `s1-${id}`, status: 'closed', createdAt: at(20), ticket: { date: today, number: 1 }, total: 1000, lines: [line(1)], payments: [{ method: 'cash', amount: 1000 }] } },
    { id: 'e2', type: 'sale', createdAt: at(15), origin, sale: { id: `s2-${id}`, status: 'closed', createdAt: at(15), ticket: { date: today, number: 2 }, total: -1000, voidsSaleId: `s1-${id}`, voidReason: 'Prueba', lines: [line(-1)], payments: [{ method: 'cash', amount: -1000 }] } },
    { id: 'e3', type: 'sale', createdAt: at(10), origin, sale: { id: `s3-${id}`, status: 'closed', createdAt: at(10), ticket: { date: today, number: 3 }, total: 2000, customerId: `c-${id}`, lines: [line(2)], payments: [{ method: 'debit', amount: 2000 }] } },
    { id: 'e4', type: 'customer-payment', createdAt: at(5), origin, payment: { id: `p1-${id}`, customerId: `c-${id}`, createdAt: at(5), receipt: { date: today, number: 1 }, total: 700, payments: [{ method: 'cash', amount: 700 }] } },
  ];
  const push = await request.post('/connector/sync/push', {
    headers: { Authorization: `Bearer ${posKey.key}`, 'X-POS-Contract-Version': '4.4.0', 'Idempotency-Key': `e2e-ventas-${id}` },
    data: { deviceId: `dev-${id}`, events },
  });
  expect(push.status()).toBe(200);

  await page.addInitScript(
    ([t, tenantId]) => {
      window.localStorage.setItem('mini_erp_token', t);
      window.localStorage.setItem('mini_erp_tenant_id', tenantId);
    },
    [token, tenant.id] as const,
  );
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Ventas & Caja' }).click();

  // Ventas de hoy: los tres tickets
  await expect(page.getByText(/^3 tickets/)).toBeVisible();
  // El ticket a Ana, completo
  await page.getByRole('row', { name: /Ana E2E/ }).click();
  await expect(page.getByText('Venta #3')).toBeVisible();
  await expect(page.getByText(product.name)).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar panel' }).click();

  // Filtro de anuladas: solo el ticket 1
  await page.getByLabel('Estado').selectOption('voided');
  await expect(page.getByText(/^1 ticket ·/)).toBeVisible();

  // Cobranzas: la de Ana
  await page.getByRole('tab', { name: 'Cobranzas' }).click();
  await expect(page.getByRole('row', { name: /Ana E2E/ })).toBeVisible();

  // Resumen del día de la caja: vendido neto 2000 (1000 − 1000 + 2000)
  await page.getByRole('tab', { name: 'Resumen' }).click();
  await page.getByRole('row', { name: new RegExp(posKey.pointOfSale) }).click();
  await expect(page.getByText('Resumen del día')).toBeVisible();
  await expect(page.getByText(/2[.,]000[.,]00/).first()).toBeVisible();

  // Drill-down: Facturación del dashboard lleva a la lista
  await page.getByRole('button', { name: 'Cerrar panel' }).click();
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await page.getByRole('button', { name: /Facturación Total/ }).click();
  await expect(page.getByText(/^3 tickets/)).toBeVisible();
});
