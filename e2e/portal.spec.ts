import { expect, test, type Page } from '@playwright/test';
import { E2E_PORT } from '../playwright.config.ts';

/**
 * Criterio de aceptación de M10 (#26): desde el POS, /MINI abre mini en la caja correcta sin pedir
 * contraseña; el link no sirve dos veces ni después de 60 s; rotar la key corta la sesión. Usa la copia
 * local del POS y la Caja 1 de la Ferretería del seed de desarrollo: los e2e corren en paralelo, el del
 * alta usa el Kiosco y el de las demos, el Almacén.
 */
const KEY = 'mpos_dev_ferreteria_caja1';
const TENANT = 'ferreteria-el-tornillo';
const BAR = 'Caja 1 · Ferretería El Tornillo';
const V = { 'X-POS-Contract-Version': '4.6.0' };

async function command(page: Page, text: string): Promise<void> {
  const bar = page.getByLabel('Barra de comandos');
  await bar.fill(text);
  await bar.press('Enter');
}

/** Conecta el POS vacío a la caja con la vuelta del onboarding: sin `wipeKey`, un POS sin datos la aplica directo. */
async function connectPos(page: Page): Promise<void> {
  const connection = { baseUrl: `http://localhost:${String(E2E_PORT)}/connector`, apiKey: KEY, branch: 'CENTRAL', pointOfSale: 'Caja 1' };
  await page.goto(`/pos/v4/#connect=${Buffer.from(JSON.stringify(connection)).toString('base64url')}`);
  await expect(page).toHaveTitle(/^Caja 1 - CENTRAL/);
}

test('desde el POS, /MINI abre la caja sin contraseña; un uso, 60 s y la key rotada', async ({ page, context, request }) => {
  test.setTimeout(180_000); // espera 61 s a propósito
  await connectPos(page);

  // /MINI abre mini en una pestaña nueva, en el resumen de la caja, sin login
  const popup = context.waitForEvent('page');
  await command(page, '/MINI');
  const mini = await popup;
  await expect(mini.getByText(BAR)).toBeVisible();
  await expect(mini).toHaveURL(new RegExp(`/admin/${TENANT}/ventas/resumen\\?.*caja=Caja\\+1`));
  await expect(mini.getByRole('heading', { name: 'Iniciar Sesión' })).toHaveCount(0);
  // Solo consulta: sin dashboard ni botones de edición
  await expect(mini.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await mini.getByRole('link', { name: /Cat[aá]logo/ }).click();
  await expect(mini.getByPlaceholder('Buscar por nombre, SKU o código de barra...')).toBeVisible();
  await expect(mini.getByRole('button', { name: 'Nuevo Producto' })).toHaveCount(0);

  // El mismo link no sirve dos veces (se pide como lo pide el POS)
  const portalLink = async (): Promise<string> => {
    const res = await request.post('/connector/portal-links', { headers: { Authorization: `Bearer ${KEY}`, ...V } });
    expect(res.status()).toBe(201);
    return ((await res.json()) as { url: string }).url;
  };
  const url = await portalLink();
  const first = await context.newPage();
  await first.goto(url);
  await expect(first.getByText(BAR)).toBeVisible();
  const again = await context.newPage();
  await again.goto(url);
  await expect(again.getByText('Este link venció')).toBeVisible();

  // Ni después de 60 s
  const lateUrl = await portalLink();
  await new Promise((resolve) => setTimeout(resolve, 61_000));
  const late = await context.newPage();
  await late.goto(lateUrl);
  await expect(late.getByText('Este link venció')).toBeVisible();

  // El dueño rota la key: la pestaña de la caja se corta
  const login = await request.post('/api/auth/login', { data: { email: 'dueno-b@local.test', password: 'admin123' } });
  const owner = ((await login.json()) as { token: string }).token;
  const rotated = await request.post(`/api/tenants/${TENANT}/pos-registers/reg_dev_ferreteria_1/rotate-key`, {
    headers: { Authorization: `Bearer ${owner}` },
  });
  expect(rotated.status()).toBe(200);
  await mini.reload();
  await expect(mini.getByText('Este acceso terminó')).toBeVisible();
});
