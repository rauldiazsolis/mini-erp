import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  registerPayment,
  grantCredits,
  voidCredit,
  extendGrace,
  registerRefund,
  changeHolder,
  fetchOwners,
  ownersSignal,
  sheetTextSignal,
  sheetRowsSignal,
  sheetAppliedSignal,
  previewSheet,
  applySheet,
  fetchPlatformPayments,
  platformPaymentsSignal,
  fetchPlatformSettings,
  savePlatformSettings,
  platformSettingsSignal,
  sheetSummary,
  settingsToDraft,
  draftToSettings,
} from '../src/client/state/platform-state.ts';
import { isViewAllowed } from '../src/client/state/permissions-state.ts';
import { userTenantsSignal, currentUserSignal } from '../src/client/state/auth-state.ts';
import { navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import { queryClient } from '../src/client/api/query-client.ts';
import { tenantKey } from '../src/client/state/query-keys.ts';
import { atTenant, freshSession } from './helpers/client-route.ts';

type Call = { url: string; method: string; body: unknown };

describe('estado de la plataforma de cobro (#21)', () => {
  let calls: Call[];
  let reply: { status: number; body: unknown };

  beforeEach(async () => {
    setHistoryForTests(null);
    calls = [];
    reply = { status: 200, body: {} };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const ok = (body: unknown, status = 200): Promise<Response> =>
        Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
      // El estado de cobro lo pide el shell con cualquier comercio: no es parte de lo que se prueba
      if (url.endsWith('/billing-status')) return ok({ state: 'ok', debt: 0, deadline: null });
      calls.push({ url, method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined });
      return ok(reply.body, reply.status);
    });
    freshSession('mock-token');
    userTenantsSignal.value = [{ tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'root_impersonator', status: 'active' }];
    atTenant('tienda-test');
    currentUserSignal.value = { id: 'root', email: 'root@x.com', name: 'Root', globalRole: 'root' };
    sheetRowsSignal.value = null;
    sheetAppliedSignal.value = false;
    // Lo que pide el dashboard al entrar no es parte de lo que se prueba
    await vi.waitFor(() => { expect(queryClient.isFetching()).toBe(0); });
    calls = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const writes = () => calls.filter((c) => c.method !== 'GET');

  it('registrar un pago pega a la plataforma con el comercio activo y deja viejo Uso y pagos', async () => {
    reply.body = { movementId: 'pm-1', settled: 0 };
    queryClient.setQueryData(tenantKey('tienda-test', 'credits', 'summary'), {});
    expect(await registerPayment({ day: '2026-10-05', amount: 5000, info: 'op 1' })).toBe(true);
    expect(writes()).toEqual([{ url: '/api/platform/tenants/tienda-test/payments', method: 'POST', body: { day: '2026-10-05', amount: 5000, info: 'op 1' } }]);
    expect(queryClient.getQueryState(tenantKey('tienda-test', 'credits', 'summary'))?.isInvalidated).toBe(true);
  });

  it('un error devuelve false', async () => {
    reply = { status: 400, body: { error: 'El importe tiene que ser mayor que 0' } };
    expect(await registerPayment({ day: '2026-10-05', amount: 0 })).toBe(false);
  });

  it('otorgar, anular, gracia, devolución y titular', async () => {
    reply.body = { id: 'g-1', success: true };
    await grantCredits({ amount: 1000, expiresOn: '2026-12-31', reason: 'Cortesía' });
    await voidCredit('g-1', 'Error');
    await extendGrace('2026-10-20');
    await registerRefund({ amount: 100, info: 'Baja' });
    await changeHolder('u-2');
    expect(writes()).toEqual([
      { url: '/api/platform/tenants/tienda-test/gift-credits', method: 'POST', body: { amount: 1000, expiresOn: '2026-12-31', reason: 'Cortesía' } },
      { url: '/api/platform/tenants/tienda-test/gift-credits/g-1', method: 'DELETE', body: { reason: 'Error' } },
      { url: '/api/platform/tenants/tienda-test/grace', method: 'POST', body: { until: '2026-10-20' } },
      { url: '/api/platform/tenants/tienda-test/refunds', method: 'POST', body: { amount: 100, info: 'Baja' } },
      { url: '/api/platform/tenants/tienda-test/holder', method: 'PUT', body: { userId: 'u-2' } },
    ]);
  });

  it('los owners activos para elegir el titular', async () => {
    reply.body = {
      members: [
        { userId: 'u-1', name: 'Ana', email: 'a@x.com', role: 'owner', status: 'active' },
        { userId: 'u-2', name: 'Beto', email: 'b@x.com', role: 'admin', status: 'active' },
        { userId: 'u-3', name: 'Caro', email: 'c@x.com', role: 'owner', status: 'disabled' },
      ],
      invitations: [],
    };
    await fetchOwners();
    expect(calls[0]?.url).toBe('/api/tenants/tienda-test/users');
    expect(ownersSignal.value.map((o) => o.userId)).toEqual(['u-1']);
  });

  it('la planilla: vista previa y después aplicar', async () => {
    sheetTextSignal.value = 'fecha;comercio;importe\n05/10/2026;kiosco;100';
    reply.body = { rows: [{ line: 2, status: 'ok' }], applied: false };
    await previewSheet();
    expect(calls[0]).toEqual({ url: '/api/platform/payments/import?dryRun=1', method: 'POST', body: { csv: sheetTextSignal.value } });
    expect(sheetRowsSignal.value).toEqual([{ line: 2, status: 'ok' }]);
    expect(sheetAppliedSignal.value).toBe(false);
    reply.body = { rows: [{ line: 2, status: 'ok' }], applied: true };
    await applySheet();
    expect(calls.find((c) => c.url === '/api/platform/payments/import')?.method).toBe('POST');
    expect(sheetAppliedSignal.value).toBe(true);
  });

  it('en /plataforma pide pagos y configuración (#59)', async () => {
    navigate('/plataforma');
    await vi.waitFor(() => {
      expect(calls.map((c) => c.url)).toEqual(expect.arrayContaining(['/api/platform/payments', '/api/platform/settings']));
    });
  });

  it('aplicar la planilla deja viejos los pagos y el estado de cobro (#59)', async () => {
    queryClient.setQueryData(['platform', 'payments'], []);
    sheetTextSignal.value = 'fecha;comercio;importe\n05/10/2026;kiosco;100';
    reply.body = { rows: [{ line: 2, status: 'ok' }], applied: true };
    await applySheet();
    expect(queryClient.getQueryState(['platform', 'payments'])?.isInvalidated).toBe(true);
  });

  it('pagos registrados y configuración', async () => {
    reply.body = [{ id: 'pm-1' }];
    await fetchPlatformPayments();
    expect(platformPaymentsSignal.value).toEqual([{ id: 'pm-1' }]);
    reply.body = { pricePerRegisterDay: 1000 };
    await fetchPlatformSettings();
    expect(platformSettingsSignal.value).toEqual({ pricePerRegisterDay: 1000 });
    reply.body = { pricePerRegisterDay: 1200 };
    expect(await savePlatformSettings({ pricePerRegisterDay: 1200 })).toBe(true);
    expect(calls.at(-1)).toEqual({ url: '/api/platform/settings', method: 'PUT', body: { pricePerRegisterDay: 1200 } });
    expect(platformSettingsSignal.value).toEqual({ pricePerRegisterDay: 1200 });
  });

  it('la vista Plataforma es de root y soporte', () => {
    expect(isViewAllowed('platform')).toBe(true);
    currentUserSignal.value = { id: 's', email: 's@x.com', name: 'S', globalRole: 'support' };
    expect(isViewAllowed('platform')).toBe(true);
    currentUserSignal.value = { id: 'u', email: 'u@x.com', name: 'U', globalRole: 'user' };
    expect(isViewAllowed('platform')).toBe(false);
  });

  it('el resumen de la planilla', () => {
    const rows = [
      { line: 2, status: 'ok' as const },
      { line: 3, status: 'ok' as const },
      { line: 4, status: 'duplicate' as const },
      { line: 5, status: 'error' as const, message: 'Comercio desconocido' },
    ];
    expect(sheetSummary(rows, false)).toBe('2 para registrar, 1 ya registrado, 1 con error');
    expect(sheetSummary(rows.slice(0, 1), true)).toBe('1 registrado');
    expect(sheetSummary([], false)).toBe('0 para registrar');
  });

  it('el formulario de configuración: el porcentaje pagado va de 0 a 100', () => {
    const settings = {
      pricePerRegisterDay: 1000,
      signupBonus: 50000,
      signupBonusDays: 90,
      paidShare: 0.5,
      graceDays: 10,
      lowBalanceDays: 7,
      paymentAlias: 'mini.contax',
      paymentCbu: '',
      paymentHolder: 'Contax',
      supportWhatsapp: '+54 9 11 5555-1234',
    };
    const draft = settingsToDraft(settings);
    expect(draft.paidShare).toBe('50');
    expect(draft.pricePerRegisterDay).toBe('1000');
    expect(draftToSettings(draft)).toEqual(settings);
    expect(draftToSettings({ ...draft, paidShare: '75', pricePerRegisterDay: '1200' })).toEqual({ ...settings, paidShare: 0.75, pricePerRegisterDay: 1200 });
    expect(draftToSettings({ ...draft, graceDays: 'diez' })).toBe('Días de gracia tiene que ser un número');
  });
});
