import { expect, test, type Browser, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { E2E_DATA_DIR } from '../playwright.config.ts';

/**
 * Criterio de aceptación de M8 (#24): dos visitantes en dos navegadores ven las ventas del otro en el
 * comercio demo; el reinicio parcial deshace un precio cambiado sin cortarles la demo; el total revoca
 * sus cajas y el POS ofrece una demo nueva. Usa la copia local del POS y el root del seed de desarrollo.
 * Va con el Almacén: los e2e corren en paralelo y el del alta usa el Kiosco, cuyas cajas no hay que revocar.
 */

function lechePrice(): number {
  // timeout: si el servidor está escribiendo, espera en lugar de fallar con "database is locked"
  const db = new DatabaseSync(join(E2E_DATA_DIR, 'tenants/demo-almacen.sqlite'), { readOnly: true, timeout: 5000 });
  try {
    return (db.prepare("SELECT price FROM products WHERE id = 'demo_ALM-001'").get() as { price: number }).price;
  } finally {
    db.close();
  }
}

async function openDemo(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  // El link de "Probar la demo" del landing, con la plantilla del Almacén
  await page.goto('/');
  const href = (await page.getByRole('link', { name: 'Probar la demo' }).getAttribute('href')) ?? '';
  await page.goto(`${href}&template=almacen`);
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  return page;
}

async function command(page: Page, text: string): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(text);
  await bar.press('Enter');
}

async function sell(page: Page, search: string): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(search);
  await bar.press('Enter');
  await bar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
  await page.keyboard.press('Control+Enter'); // el efectivo viene con el total
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
  await page.keyboard.press('Escape');
  await command(page, '/SINCRONIZAR');
}

async function openMini(pos: Page): Promise<Page> {
  const popup = pos.context().waitForEvent('page');
  await command(pos, '/MINI');
  const admin = await popup;
  await expect(admin.getByText(/Demo de mini contax/)).toBeVisible();
  return admin;
}

async function resetFromPlatform(plat: Page, button: 'Reinicio parcial' | 'Reinicio total'): Promise<void> {
  await plat.goto('/plataforma/demos');
  await plat.getByRole('row', { name: /Almacén Demo/ }).getByRole('button', { name: button }).click();
  await plat.getByRole('dialog').getByRole('button', { name: 'Reiniciar' }).click();
  await expect(plat.getByText('Demo reiniciada').first()).toBeVisible();
}

test('dos visitantes comparten el comercio demo; parcial y total desde la plataforma', async ({ browser, request }) => {
  const a = await openDemo(browser);
  const b = await openDemo(browser);
  await sell(a, 'leche');
  await sell(b, 'arroz');

  // A abre mini desde su POS: Ventas en su caja; sin el filtro ve también la venta de B
  const adminA = await openMini(a);
  await expect(adminA).toHaveURL(/\/admin\/demo-almacen\/ventas\?sucursal=CENTRAL&caja=Demo/);
  await adminA.goto('/admin/demo-almacen/ventas');
  const bPos = (await b.title()).split(' - ')[0] ?? '';
  expect(bPos).toMatch(/^Demo [0-9A-F]{4}$/);
  await expect(adminA.getByRole('cell', { name: `CENTRAL · ${bPos}` }).first()).toBeVisible();

  // A cambia el precio de la leche desde el catálogo
  await adminA.goto('/admin/demo-almacen/catalogo');
  await adminA.getByPlaceholder('Buscar por nombre, SKU o código de barra...').fill('leche');
  await adminA.getByTitle('Editar detalles completos').first().click();
  await adminA.getByPlaceholder('0.00').fill('1');
  await adminA.getByRole('button', { name: 'Guardar Cambios' }).click();
  await expect.poll(lechePrice).toBe(1);

  // Root: reinicio parcial del Almacén; el precio vuelve y A sigue vendiendo y sincronizando
  const login = await request.post('/api/auth/login', { data: { email: 'root@local.test', password: 'admin123' } });
  const token = ((await login.json()) as { token: string }).token;
  const rootCtx = await browser.newContext();
  await rootCtx.addInitScript((t) => {
    window.localStorage.setItem('mini_erp_token', t);
  }, token);
  const plat = await rootCtx.newPage();
  await resetFromPlatform(plat, 'Reinicio parcial');
  expect(lechePrice()).toBe(1400);
  await sell(a, 'leche');
  await expect(a.getByText('La demo terminó')).toHaveCount(0);

  // Root: reinicio total; el próximo sync de A da 401 y el POS ofrece una demo nueva
  await resetFromPlatform(plat, 'Reinicio total');
  await command(a, '/SINCRONIZAR');
  await expect(a.getByText(/Empezar una demo nueva/).first()).toBeVisible();
  // El admin anónimo de A también terminó: el próximo pedido da 401
  await adminA.reload();
  await expect(adminA.getByText('Esta demo terminó')).toBeVisible();
});
