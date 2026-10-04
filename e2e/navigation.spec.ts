import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Criterio de aceptación de #59: cada pantalla con su URL, atrás y adelante, un link directo a otro
 * comercio, y una cobranza que se ve en Ventas y en Clientes sin recargar.
 */

async function enterAs(page: Page, token: string): Promise<void> {
  await page.addInitScript((t) => {
    window.localStorage.setItem('mini_erp_token', t);
  }, token);
}

test('URLs, atrás y adelante, link directo y datos al día después de cobrar', async ({ page, request }) => {
  // Un reintento reusa el servidor y la base: correos y nombres propios por corrida
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner Nav', email: `nav-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Nav ${id}`, businessType: 'kiosco', whatsapp: '1155550000' },
  });
  expect(alta.status()).toBe(201);
  const { token, tenant } = (await alta.json()) as { token: string; tenant: { id: string } };
  const auth = { Authorization: `Bearer ${token}` };
  const second = await request.post('/api/alta', { headers: auth, data: { businessName: `Almacén Nav ${id}`, businessType: 'almacen' } });
  expect(second.status()).toBe(201);
  const other = ((await second.json()) as { tenant: { id: string } }).tenant.id;
  const customer = await request.post(`/api/tenants/${other}/customers`, {
    headers: auth,
    data: { name: `Ana Nav ${id}`, creditLimit: 50000, margin: 0, unrestricted: false, initialBalance: 5000 },
  });
  expect(customer.status()).toBe(201);

  await enterAs(page, token);

  // Link directo a una pantalla con filtro de otro comercio
  await page.goto(`/admin/${other}/clientes?q=Ana`);
  await expect(page.getByText(`Almacén Nav ${id}`).first()).toBeVisible();
  await expect(page.getByPlaceholder('Buscar por nombre, DNI/CUIT o teléfono...')).toHaveValue('Ana');
  await expect(page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) })).toBeVisible();

  // Pantallas y solapas con su URL; atrás y adelante
  await page.getByRole('link', { name: 'Catálogo & Precios' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/catalogo$`));
  await page.getByRole('link', { name: 'Ventas & Caja' }).click();
  await page.getByRole('tab', { name: 'Cobranzas' }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/ventas/cobranzas$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/ventas$`));
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/catalogo$`));
  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`/admin/${other}/ventas$`));

  // Cobrar en Clientes y verlo en el saldo y en Ventas → Cobranzas, sin recargar
  await page.getByRole('link', { name: 'Clientes & CC' }).click();
  await page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) }).getByTitle('Registrar pago / cobranza').click();
  await page.locator('input[type="number"]').fill('1000');
  await page.getByRole('button', { name: /Confirmar Cobro/ }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) })).toContainText(/4[.,]000/);
  await page.getByRole('link', { name: 'Ventas & Caja' }).click();
  await page.getByRole('tab', { name: 'Cobranzas' }).click();
  await expect(page.getByRole('row', { name: new RegExp(`Ana Nav ${id}`) })).toBeVisible();

  // Cambiar de comercio mantiene la pantalla
  await page.getByRole('button', { name: new RegExp(`Almacén Nav ${id}`) }).click();
  await page.getByRole('button', { name: new RegExp(`Kiosco Nav ${id}`) }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${tenant.id}/ventas/cobranzas$`));
});

test('un empleado cae en el dashboard sin permiso, y en "sin acceso" con un comercio ajeno', async ({ page, request }) => {
  const login = await request.post('/api/auth/login', { data: { email: 'empleado-k@local.test', password: 'admin123' } });
  expect(login.status()).toBe(200);
  const { token } = (await login.json()) as { token: string };
  await enterAs(page, token);

  await page.goto('/admin/kiosco-don-pepe/usuarios');
  await expect(page).toHaveURL(/\/admin\/kiosco-don-pepe\/dashboard$/);

  await page.goto('/admin/ferreteria-el-tornillo/dashboard');
  await expect(page.getByText('No tenés acceso a este comercio o no existe')).toBeVisible();
});
