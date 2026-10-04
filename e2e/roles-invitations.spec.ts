import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Criterio de aceptación de #19: el owner invita a un empleado por link; el empleado entra y no ve
 * usuarios ni operaciones masivas.
 */
test('el owner invita a un empleado; el empleado entra y no ve usuarios ni operaciones masivas', async ({ page, request, browser }) => {
  // Un reintento reusa el servidor y la base: correos propios por corrida
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner E2E', email: `owner-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Roles ${id}`, businessType: 'kiosco', whatsapp: '1155550000' },
  });
  expect(alta.status()).toBe(201);
  const { token, tenant } = (await alta.json()) as { token: string; tenant: { id: string } };

  // El owner entra, invita desde Usuarios y copia el link
  await page.addInitScript(
    ([t, tenantId]) => {
      window.localStorage.setItem('mini_erp_token', t);
      window.localStorage.setItem('mini_erp_tenant_id', tenantId);
    },
    [token, tenant.id] as const,
  );
  await page.goto('/admin');
  await page.getByRole('link', { name: 'Usuarios' }).click();
  await page.getByRole('button', { name: 'Invitar' }).click();
  await page.getByLabel('Correo').fill(`empleado-${id}@local.test`);
  await page.getByRole('button', { name: 'Crear link' }).click();
  const link = await page.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link).toContain('/invitacion#t=');

  // El empleado abre el link en otro navegador, sin la sesión del owner
  const other = await browser.newContext();
  const emp = await other.newPage();
  await emp.goto(link);
  await expect(emp.getByText('Empleado', { exact: true })).toBeVisible();
  expect(emp.url()).not.toContain('#t=');
  await emp.getByLabel('Tu nombre').fill('Empleado E2E');
  await emp.getByLabel('Contraseña', { exact: true }).fill('clave-emp-12');
  await emp.getByLabel('Repetir contraseña').fill('clave-emp-12');
  await emp.getByRole('button', { name: 'Aceptar invitación' }).click();

  await expect(emp.getByRole('link', { name: 'Catálogo & Precios' })).toBeVisible();
  await expect(emp.getByRole('link', { name: 'Usuarios' })).toHaveCount(0);
  await expect(emp.getByRole('link', { name: 'Operaciones Masivas' })).toHaveCount(0);
  await other.close();
});
