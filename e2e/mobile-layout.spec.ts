import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

/**
 * #88: en un teléfono (390 px) ninguna pantalla del admin ni de la plataforma es más ancha que la
 * pantalla. Las tablas pueden deslizarse adentro de su caja; la página, no.
 */

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

const TENANT_PATHS = [
  'dashboard',
  'ventas',
  'ventas/cobranzas',
  'ventas/movimientos',
  'ventas/resumen',
  'catalogo',
  'stock',
  'clientes',
  'masivas',
  'masivas/intereses',
  'masivas/archivos',
  'usuarios',
  'configuracion',
  'configuracion/sucursales',
  'configuracion/conexion',
  'configuracion/cuenta',
  'configuracion/apariencia',
  'uso-y-pagos',
  'uso-y-pagos/movimientos',
  'uso-y-pagos/bonos',
];

const PLATFORM_PATHS = ['', 'usuarios', 'pedidos', 'demos', 'embudo', 'visitantes', 'cobranzas', 'soporte', 'registro', 'configuracion'];

async function enterAs(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const login = await request.post('/api/auth/login', { data: { email, password: 'admin123' } });
  expect(login.status()).toBe(200);
  const { token } = (await login.json()) as { token: string };
  await page.addInitScript((t) => {
    window.localStorage.setItem('mini_erp_token', t);
  }, token);
}

async function expectNoSideScroll(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState('networkidle');
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect.soft(scrollWidth, `${path} mide ${String(scrollWidth)} px en una pantalla de ${String(clientWidth)}`).toBeLessThanOrEqual(clientWidth);
}

test('el admin de un comercio entra en un teléfono', async ({ page, request }) => {
  await enterAs(page, request, 'dueno-a@local.test');
  for (const path of TENANT_PATHS) await expectNoSideScroll(page, `/admin/kiosco-don-pepe/${path}`);
});

test('la plataforma entra en un teléfono', async ({ page, request }) => {
  await enterAs(page, request, 'root@local.test');
  for (const path of PLATFORM_PATHS) await expectNoSideScroll(page, `/plataforma/${path}`);
});
