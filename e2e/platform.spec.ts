import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Plataforma (#23, M7a): root invita a soporte por link; soporte entra, suspende un comercio (su owner
 * ve el aviso), lo reactiva y desactiva al owner, que ya no puede entrar.
 */
test('root invita a soporte; soporte suspende y reactiva un comercio y desactiva a su owner', async ({ page, request, browser }) => {
  // Un reintento reusa el servidor y la base: correos y comercio propios por corrida
  const id = randomUUID().slice(0, 8);
  const ownerEmail = `owner-plat-${id}@local.test`;
  const businessName = `Kiosco Plat ${id}`;
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner Plat', email: ownerEmail, password: 'clave-owner-1', businessName, businessType: 'kiosco', whatsapp: '1155550000' },
  });
  expect(alta.status()).toBe(201);
  const { token: ownerToken } = (await alta.json()) as { token: string };

  // Root (del seed de desarrollo) invita a soporte desde el panel y copia el link
  const rootLogin = await request.post('/api/auth/login', { data: { email: 'root@local.test', password: 'admin123' } });
  const { token: rootToken } = (await rootLogin.json()) as { token: string };
  await page.addInitScript((t) => {
    window.localStorage.setItem('mini_erp_token', t);
  }, rootToken);
  await page.goto('/plataforma/soporte');
  await page.getByRole('button', { name: 'Invitar a soporte' }).click();
  await page.getByLabel('Correo').fill(`soporte-${id}@local.test`);
  await page.getByRole('button', { name: 'Crear link' }).click();
  const link = await page.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link).toContain('/invitacion#t=');
  expect(link).toContain('tipo=soporte');

  // Soporte acepta en otro navegador y cae en la plataforma
  const supportContext = await browser.newContext();
  const sup = await supportContext.newPage();
  await sup.goto(link);
  await expect(sup.getByText('Te invitaron al equipo de soporte de mini contax')).toBeVisible();
  await sup.getByLabel('Tu nombre').fill('Soporte E2E');
  await sup.getByLabel('Contraseña', { exact: true }).fill('clave-sop-12');
  await sup.getByLabel('Repetir contraseña').fill('clave-sop-12');
  await sup.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(sup).toHaveURL(/\/plataforma$/);

  // Busca el comercio y lo suspende desde su detalle
  await sup.getByPlaceholder('Buscar comercio').fill(`Plat ${id}`);
  await sup.getByRole('link', { name: businessName }).click();
  await sup.getByRole('button', { name: 'Suspender', exact: true }).click();
  await sup.getByLabel('Motivo').fill('Prueba e2e');
  await sup.getByRole('button', { name: 'Suspender comercio' }).click();
  await expect(sup.getByText('Suspendido', { exact: true })).toBeVisible();
  await expect(sup.getByText(/Prueba e2e/)).toBeVisible();

  // El owner ve el aviso en lugar de su admin
  const ownerContext = await browser.newContext();
  const own = await ownerContext.newPage();
  await own.addInitScript((t) => {
    window.localStorage.setItem('mini_erp_token', t);
  }, ownerToken);
  await own.goto('/admin');
  await expect(own.getByText('Este comercio está suspendido')).toBeVisible();

  // Soporte reactiva y el owner vuelve a su admin
  await sup.getByRole('button', { name: 'Reactivar' }).click();
  await expect(sup.getByText('Activo', { exact: true })).toBeVisible();
  await own.reload();
  await expect(own.getByRole('link', { name: 'Catálogo & Precios' })).toBeVisible();
  await expect(own.getByText('Este comercio está suspendido')).toHaveCount(0);

  // Soporte desactiva al owner: su sesión se corta y no puede volver a entrar
  await sup.goto(`/plataforma/usuarios?q=${ownerEmail}`);
  await sup.getByRole('button', { name: 'Desactivar', exact: true }).click();
  await sup.getByRole('button', { name: 'Desactivar cuenta' }).click();
  await expect(sup.getByText('Desactivada', { exact: true })).toBeVisible();
  const me = await request.get('/api/auth/me', { headers: { Authorization: `Bearer ${ownerToken}` } });
  expect(me.status()).toBe(401);
  const relogin = await request.post('/api/auth/login', { data: { email: ownerEmail, password: 'clave-owner-1' } });
  expect(relogin.status()).toBe(401);

  await supportContext.close();
  await ownerContext.close();
});

/** Las secciones de la plataforma en el menú lateral (#81): root ve ocho, soporte seis, sin solapas ni selector. */
test('root y soporte recorren la plataforma desde el menú lateral', async ({ browser, request }) => {
  const openAs = async (email: string) => {
    const login = await request.post('/api/auth/login', { data: { email, password: 'admin123' } });
    const { token } = (await login.json()) as { token: string };
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.addInitScript((t) => {
      window.localStorage.setItem('mini_erp_token', t);
    }, token);
    return { context, page };
  };
  // Visitantes puede llevar el contador de contactos sin atender (#25): otros e2e dejan contactos
  const all = ['Comercios', 'Usuarios', 'Pedidos', 'Demos', 'Embudo', /^Visitantes\d*$/, 'Cobranzas', 'Soporte', 'Registro', 'Configuración'];

  const { context: rootContext, page: root } = await openAs('root@local.test');
  await root.goto('/admin');
  await expect(root).toHaveURL(/\/plataforma$/);
  const menu = root.getByRole('navigation');
  await expect(menu.getByRole('link')).toHaveText(all);
  await expect(menu.getByRole('link', { name: 'Comercios' })).toHaveAttribute('aria-current', 'page');
  await expect(root.getByRole('tab')).toHaveCount(0);
  await expect(root.getByText('Seleccionar Comercio')).toHaveCount(0);

  // Cada ítem lleva a su URL de siempre, con su título
  await menu.getByRole('link', { name: 'Registro' }).click();
  await expect(root).toHaveURL(/\/plataforma\/registro$/);
  await expect(root.getByRole('heading', { name: 'Registro', level: 1 })).toBeVisible();
  await expect(menu.getByRole('link', { name: 'Registro' })).toHaveAttribute('aria-current', 'page');
  await menu.getByRole('link', { name: 'Configuración' }).click();
  await expect(root).toHaveURL(/\/plataforma\/configuracion$/);
  await root.goBack();
  await expect(root).toHaveURL(/\/plataforma\/registro$/);

  // El detalle de un comercio marca Comercios
  await menu.getByRole('link', { name: 'Comercios' }).click();
  await root.getByRole('main').getByRole('link', { name: 'Kiosco Don Pepe' }).first().click();
  await expect(root).toHaveURL(/\/plataforma\/comercios\/[^/]+$/);
  await expect(menu.getByRole('link', { name: 'Comercios' })).toHaveAttribute('aria-current', 'page');
  await rootContext.close();

  // Soporte: seis secciones; Soporte y Configuración, por URL, vuelven a Comercios
  const { context: supContext, page: sup } = await openAs('soporte@local.test');
  await sup.goto('/plataforma/configuracion');
  await expect(sup).toHaveURL(/\/plataforma$/);
  await expect(sup.getByRole('navigation').getByRole('link')).toHaveText(all.filter((l) => l !== 'Soporte' && l !== 'Configuración'));
  await expect(sup.getByText('Seleccionar Comercio')).toHaveCount(0);
  await supContext.close();
});
