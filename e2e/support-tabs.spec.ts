import { expect, test, type Page } from '@playwright/test';

/**
 * Criterio de aceptación de M7 (#23): soporte atiende dos pedidos a la vez en dos pestañas, cada una
 * como un usuario distinto, sin que se pisen; el usuario ve que soporte entró; el registro muestra
 * "soporte como usuario"; root ya no ve comercios ajenos como propios (#16). Usa el seed de desarrollo.
 */
const KIOSCO = 'kiosco-don-pepe';
const FERRETERIA = 'ferreteria-el-tornillo';

test('soporte atiende dos pedidos en dos pestañas sin que se pisen', async ({ browser, request }) => {
  const login = async (email: string): Promise<string> =>
    ((await (await request.post('/api/auth/login', { data: { email, password: 'admin123' } })).json()) as { token: string }).token;
  const withToken = async (page: Page, token: string): Promise<void> => {
    await page.addInitScript((t) => {
      window.localStorage.setItem('mini_erp_token', t);
    }, token);
  };

  // Dueño A pide ayuda desde Clientes del Kiosco, por la UI (WhatsApp no se abre de verdad)
  const ownerA = await browser.newContext();
  await ownerA.route('https://wa.me/**', (route) => route.fulfill({ body: 'WhatsApp' }));
  const pa = await ownerA.newPage();
  await withToken(pa, await login('dueno-a@local.test'));
  await pa.goto(`/admin/${KIOSCO}/clientes`);
  await pa.getByRole('button', { name: 'Pedir ayuda' }).click();
  await pa.getByLabel(/En qué te ayudamos/).fill('No veo un cliente');
  const waPage = ownerA.waitForEvent('page');
  await pa.getByRole('button', { name: 'Escribir a soporte por WhatsApp' }).click();
  const text = new URL((await waPage).url()).searchParams.get('text') ?? '';
  expect(text).toContain('Hola, soy Dueño A de Kiosco Don Pepe. No veo un cliente');
  const linkA = /\/ayuda\/[\w-]+/.exec(text)?.[0] ?? '';
  expect(linkA).not.toBe('');

  // Dueño B pide ayuda desde Catálogo de la Ferretería, por la API
  const tokenB = await login('dueno-b@local.test');
  const askB = await request.post(`/api/tenants/${FERRETERIA}/help-requests`, {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: { path: `/admin/${FERRETERIA}/catalogo`, message: 'Precios' },
  });
  expect(askB.status()).toBe(201);
  const linkB = new URL(((await askB.json()) as { url: string }).url).pathname;

  // Soporte abre los dos links en dos pestañas del mismo navegador (comparten localStorage)
  const sup = await browser.newContext();
  const supportToken = await login('soporte@local.test');
  const p1 = await sup.newPage();
  await withToken(p1, supportToken);
  const p2 = await sup.newPage();
  await withToken(p2, supportToken);
  await p1.goto(linkA);
  await p2.goto(linkB);
  await expect(p1).toHaveURL(new RegExp(`/admin/${KIOSCO}/clientes`));
  await expect(p2).toHaveURL(new RegExp(`/admin/${FERRETERIA}/catalogo`));
  await expect(p1.getByText(/Estás viendo como Dueño A/)).toBeVisible();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();

  // Se recargan y se navega intercalado sin que se pisen
  await p1.reload();
  await p2.reload();
  await expect(p1.getByText(/Estás viendo como Dueño A/)).toBeVisible();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();
  await p1.getByRole('link', { name: 'Catálogo & Precios' }).click();
  await p2.getByRole('link', { name: 'Clientes & CC' }).click();
  await expect(p1).toHaveURL(new RegExp(`/admin/${KIOSCO}/catalogo`));
  await expect(p2).toHaveURL(new RegExp(`/admin/${FERRETERIA}/clientes`));
  await expect(p1.getByText(/Estás viendo como Dueño A/)).toBeVisible();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();

  // Mientras soporte está adentro, el dueño A lo ve
  await pa.reload();
  await expect(pa.getByText('Soporte está viendo tu cuenta')).toBeVisible();

  // Una acción como Dueño A queda con los dos nombres
  const impA = await p1.evaluate(
    () => (JSON.parse(window.sessionStorage.getItem('mini_erp_impersonation') ?? '{}') as { token: string }).token,
  );
  const invite = await request.post(`/api/tenants/${KIOSCO}/invitations`, {
    headers: { Authorization: `Bearer ${impA}` },
    data: { email: `e2e-${String(Date.now())}@local.test`, role: 'member' },
  });
  expect(invite.status()).toBe(201);

  // Una sale y la otra sigue
  await p1.getByRole('button', { name: 'Salir' }).click();
  await p2.reload();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();
  await expect(p2).toHaveURL(new RegExp(`/admin/${FERRETERIA}/clientes`));

  // Dueño A ve que soporte entró y su Actividad muestra "soporte como Dueño A"
  await pa.reload();
  await pa.getByRole('button', { name: 'Pedir ayuda' }).click();
  await expect(pa.getByText(/Soporte \(Soporte Dev\) entró .* por tu pedido/).first()).toBeVisible();
  await pa.keyboard.press('Escape');
  await pa.goto(`/admin/${KIOSCO}/usuarios`);
  await expect(pa.getByText('Soporte Dev (soporte) como Dueño A').first()).toBeVisible();

  // Root en /admin no ve comercios ajenos y cae en la plataforma
  const rootCtx = await browser.newContext();
  const pr = await rootCtx.newPage();
  await withToken(pr, await login('root@local.test'));
  await pr.goto('/admin');
  await expect(pr).toHaveURL(/\/plataforma$/);

  await ownerA.close();
  await sup.close();
  await rootCtx.close();
});
