import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_DATA_DIR, E2E_PORT } from '../playwright.config.ts';

/**
 * Demo y alta de punta a punta (#9), con el POS publicado (copia local, mismo JS) contra este
 * mini-erp: landing → demo → venta → /ALTA → alta → el POS vuelve al comercio nuevo.
 */

function query<T>(file: string, sql: string, ...params: string[]): T[] {
  // timeout: si el servidor está escribiendo un lote, espera en lugar de fallar con "database is locked"
  const db = new DatabaseSync(join(E2E_DATA_DIR, file), { readOnly: true, timeout: 5000 });
  try {
    return db.prepare(sql).all(...params) as T[];
  } finally {
    db.close();
  }
}

function salesOf(tenantId: string, pointOfSale?: string): number {
  const file = `tenants/${tenantId}.sqlite`;
  const rows =
    pointOfSale === undefined
      ? query<{ n: number }>(file, 'SELECT COUNT(*) AS n FROM sales')
      : query<{ n: number }>(file, 'SELECT COUNT(*) AS n FROM sales WHERE point_of_sale = ?', pointOfSale);
  return rows[0]?.n ?? 0;
}

async function sellOneAndSync(page: Page, search: string): Promise<void> {
  const commandBar = page.getByLabel('Barra de comandos');
  await commandBar.fill(search);
  await commandBar.press('Enter');
  await commandBar.press('Control+Enter');
  await expect(page.getByRole('heading', { name: 'Cobrar venta' })).toBeVisible();
  await page.keyboard.press('Control+Enter'); // el efectivo viene con el total
  await expect(page.getByRole('heading', { name: 'Comprobante' })).toBeVisible();
  await page.keyboard.press('Escape');
  await commandBar.fill('/SINCRONIZAR');
  await commandBar.press('Enter');
}

test('landing → demo → venta → /ALTA → alta → el POS vuelve conectado al comercio nuevo', async ({ page }) => {
  // Un reintento reusa el servidor y la base: email propio por corrida
  const email = `e2e-alta-${randomUUID().slice(0, 8)}@local.test`;

  // Landing: abre la copia local del POS publicado en demo contra este Connector API
  await page.goto('/');
  const demoLink = page.getByRole('link', { name: 'Probar la demo' });
  await expect(demoLink).toHaveAttribute(
    'href',
    `http://localhost:${String(E2E_PORT)}/pos/v4/?demo=true&backend=${encodeURIComponent(`http://localhost:${String(E2E_PORT)}/connector`)}`,
  );
  await demoLink.click();

  // Demo: marca DEMO y el botón del alta
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(commandBar).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Crear mi comercio (/ALTA)' })).toBeVisible();

  // La demo es una caja de visitante en el comercio demo del rubro (#24)
  const [demo] = query<{ tenant_id: string; template: string; pos: string }>(
    'system.sqlite',
    `SELECT s.tenant_id, s.template, r.point_of_sale AS pos FROM demo_sessions s JOIN registers r ON r.id = s.register_id
     ORDER BY s.created_at DESC LIMIT 1`,
  );
  expect(demo?.template).toBe('kiosco');
  expect(demo?.tenant_id).toBe('demo-kiosco');
  const demoTenant = demo?.tenant_id ?? '';
  const demoPos = demo?.pos ?? '';

  // Venta de práctica, que llega a la caja de la demo
  await sellOneAndSync(page, 'alfajor');
  await expect.poll(() => salesOf(demoTenant, demoPos)).toBe(1);

  // /ALTA → alta del mini-erp, con el rubro de la demo
  await commandBar.fill('/ALTA');
  await commandBar.press('Enter');
  await expect(page).toHaveURL(/\/alta\?template=kiosco&return_url=.*&wipe_key=/);

  await page.getByPlaceholder('Ej: Martín Rodríguez').fill('Alta E2E');
  await page.getByPlaceholder('ejemplo@comercio.com').fill(email);
  await page.getByPlaceholder('Mínimo 8 caracteres').fill('prueba-e2e');
  await page.getByPlaceholder('Ej: 11 5555-1234').fill('1155550000');
  await page.getByRole('button', { name: 'Continuar →' }).click();
  await page.getByPlaceholder(/Ej: Kiosco San Martín/).fill('Kiosco E2E');
  await page.getByRole('button', { name: 'Crear mi comercio' }).click();
  // Cargá tus datos (#22): el catálogo de ejemplo del rubro de la demo
  await page.getByRole('button', { name: /catálogo de ejemplo de Kiosco/ }).click();
  await expect(page.getByText(`Vas a volver a localhost:${String(E2E_PORT)}`)).toBeVisible();
  await page.getByRole('button', { name: 'Volver al POS' }).click();

  // De vuelta en el POS: conectado, sin DEMO y sin la conexión en la URL
  await expect(commandBar).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);
  expect(page.url()).not.toContain('connect=');

  const [alta] = query<{ tenant_id: string }>(
    'system.sqlite',
    'SELECT m.tenant_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email = ?',
    email,
  );
  const newTenant = alta?.tenant_id ?? '';
  expect(newTenant).not.toBe('');
  expect(newTenant).not.toBe(demoTenant);
  expect(salesOf(newTenant)).toBe(0); // la venta de práctica no pasa al comercio nuevo

  // Una venta real llega al comercio nuevo; la demo sigue con la suya
  await sellOneAndSync(page, 'alfajor');
  await expect.poll(() => salesOf(newTenant)).toBe(1);
  expect(salesOf(demoTenant, demoPos)).toBe(1);
});
