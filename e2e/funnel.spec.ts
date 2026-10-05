import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { E2E_DATA_DIR } from '../playwright.config.ts';
import { FUNNEL_STAGES, type FunnelReport, type FunnelStage } from '../src/shared/funnel-types.ts';

/**
 * Criterio de aceptación de M9 (#25): un recorrido demo → contacto → alta → venta real aparece como
 * una sola historia en el panel, y el embudo cuenta cada etapa. Otros e2e crean demos y comercios en
 * paralelo: el embudo se compara antes y después (cada etapa sube al menos 1).
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

async function rootToken(request: APIRequestContext): Promise<string> {
  const res = await request.post('/api/auth/login', { data: { email: 'root@local.test', password: 'admin123' } });
  return ((await res.json()) as { token: string }).token;
}

async function stageTotals(request: APIRequestContext, token: string): Promise<Record<FunnelStage, number>> {
  const res = await request.get('/api/platform/funnel', { headers: { Authorization: `Bearer ${token}` } });
  expect(res.status()).toBe(200);
  const report = (await res.json()) as FunnelReport;
  const totals: Record<FunnelStage, number> = { demo: 0, 'demo-sale': 0, portal: 0, contact: 0, alta: 0, commerce: 0, load: 0, 'real-sale': 0, payment: 0 };
  for (const s of report.stages) totals[s.stage] = s.total;
  return totals;
}

test('demo → contacto → alta → venta real: una sola historia y cada etapa contada', async ({ page, context, browser, request }) => {
  test.setTimeout(120_000);
  const token = await rootToken(request);
  const before = await stageTotals(request, token);
  // Un reintento reusa el servidor y la base: correo, nombre y comercio propios por corrida
  const id = randomUUID().slice(0, 8);
  const email = `e2e-embudo-${id}@local.test`;
  const contactName = `Embudo ${id}`;

  // 1. Landing → demo del kiosco → venta de práctica
  await page.goto('/');
  await page.getByRole('link', { name: 'Probar la demo' }).click();
  const commandBar = page.getByLabel('Barra de comandos');
  await expect(page).toHaveTitle(/^Demo [0-9A-F]{4} - /);
  const pos = (await page.title()).split(' - ')[0] ?? '';
  const [demo] = query<{ id: string }>(
    'system.sqlite',
    'SELECT s.id FROM demo_sessions s JOIN registers r ON r.id = s.register_id WHERE r.point_of_sale = ? ORDER BY s.created_at DESC',
    pos,
  );
  const demoId = demo?.id ?? '';
  expect(demoId).not.toBe('');
  await sellOneAndSync(page, 'alfajor');
  await expect.poll(() => salesOf('demo-kiosco', pos)).toBe(1);

  // 2. /MINI → la franja de la demo → contacto
  const popup = context.waitForEvent('page');
  await commandBar.fill('/MINI');
  await commandBar.press('Enter');
  const mini = await popup;
  await mini.getByRole('button', { name: '¿Querés que te ayudemos a empezar?' }).click();
  await mini.getByLabel('Tu nombre').fill(contactName);
  await mini.getByLabel('WhatsApp').fill('11 5555-0000');
  await mini.getByRole('button', { name: 'Enviar' }).click();
  await expect(mini.getByText('Listo, te escribimos por WhatsApp')).toBeVisible();
  await mini.close();

  // 3. /ALTA desde el POS (con la demo en la URL) → alta con el catálogo de ejemplo → vuelta con #connect
  await commandBar.fill('/ALTA');
  await commandBar.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/alta\\?template=kiosco&demo=${demoId}&return_url=`));
  await page.getByPlaceholder('Ej: Martín Rodríguez').fill('Embudo E2E');
  await page.getByPlaceholder('ejemplo@comercio.com').fill(email);
  await page.getByPlaceholder('Mínimo 8 caracteres').fill('prueba-e2e');
  await page.getByPlaceholder('Ej: 11 5555-1234').fill('1155550000');
  await page.getByRole('button', { name: 'Continuar →' }).click();
  await page.getByPlaceholder(/Ej: Kiosco San Martín/).fill(`Kiosco Embudo ${id}`);
  await page.getByRole('button', { name: 'Crear mi comercio' }).click();
  await page.getByRole('button', { name: /catálogo de ejemplo de Kiosco/ }).click();
  await page.getByRole('button', { name: 'Volver al POS' }).click();
  await expect(commandBar).toBeVisible();
  await expect(page.getByText('DEMO', { exact: true })).toHaveCount(0);

  // 4. Venta real en el comercio nuevo, que quedó ligado a la demo
  const [alta] = query<{ id: string; demo: string | null }>(
    'system.sqlite',
    'SELECT t.id, t.demo_session_id AS demo FROM memberships m JOIN users u ON u.id = m.user_id JOIN tenants t ON t.id = m.tenant_id WHERE u.email = ?',
    email,
  );
  const tenantId = alta?.id ?? '';
  expect(alta?.demo).toBe(demoId);
  await sellOneAndSync(page, 'alfajor');
  await expect.poll(() => salesOf(tenantId)).toBe(1);

  // 5. El embudo contó cada etapa del recorrido (Pago no)
  const reached: FunnelStage[] = ['demo', 'demo-sale', 'portal', 'contact', 'alta', 'commerce', 'load', 'real-sale'];
  await expect
    .poll(async () => {
      const after = await stageTotals(request, token);
      return FUNNEL_STAGES.filter((s) => reached.includes(s) && after[s] < before[s] + 1);
    })
    .toEqual([]);

  // 6. Root ve una sola historia en Visitantes
  const panelContext = await browser.newContext();
  const panel = await panelContext.newPage();
  await panel.addInitScript((t) => {
    window.localStorage.setItem('mini_erp_token', t);
  }, token);
  await panel.goto('/plataforma/visitantes');
  await panel.getByLabel('Buscar').fill(contactName);
  const rows = panel.locator('tbody tr');
  await expect(rows).toHaveCount(1);
  await rows.locator(`a[href="/plataforma/visitantes/${demoId}"]`).click();
  await expect(panel).toHaveURL(new RegExp(`/plataforma/visitantes/${demoId}$`));
  await expect(panel.getByRole('heading', { name: contactName })).toBeVisible();
  for (const label of ['Demo', 'Venta demo', 'Mini desde el POS', 'Contacto', 'Alta', 'Comercio', 'Carga', 'Venta real']) {
    await expect(panel.getByRole('listitem').filter({ hasText: new RegExp(`^✓${label}`) })).toHaveCount(1);
  }
  await expect(panel.getByRole('listitem').filter({ hasText: /^○Pago/ })).toHaveCount(1);
  await expect(panel.getByRole('link', { name: 'Escribir por WhatsApp' })).toHaveAttribute('href', /^https:\/\/wa\.me\/1155550000\?text=/);
  await expect(panel.getByRole('link', { name: 'Ver comercio' })).toHaveAttribute('href', `/plataforma/comercios/${tenantId}`);
  await panel.getByRole('button', { name: 'Marcar atendido' }).click();
  await expect(panel.getByText(/^Atendido por/)).toBeVisible();

  // 7. En Embudo, la tabla muestra cada etapa
  await panel.getByRole('navigation').getByRole('link', { name: 'Embudo' }).click();
  await expect(panel).toHaveURL(/\/plataforma\/embudo$/);
  await expect(panel.getByRole('cell', { name: 'Venta real' })).toBeVisible();
  await panelContext.close();
});
