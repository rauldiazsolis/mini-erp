import { describe, it, expect, beforeEach } from 'vitest';
import { setHistoryForTests, locationSignal } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';
import { salesTabSignal, setTab } from '../src/client/state/sales-state.ts';
import { activeSettingsTabSignal } from '../src/client/state/settings-state.ts';
import { activeBulkTabSignal } from '../src/client/state/bulk-state.ts';
import { creditsTabSignal } from '../src/client/state/credits-state.ts';
import { registerPermissionEffects } from '../src/client/state/permissions-state.ts';

describe('Solapas en la URL (#59)', () => {
  beforeEach(() => { setHistoryForTests(null); });

  it('cada solapa sale de la URL', () => {
    atTenant('k', 'ventas/cobranzas');
    expect(salesTabSignal.value).toBe('payments');
    atTenant('k', 'configuracion/sucursales');
    expect(activeSettingsTabSignal.value).toBe('branches');
    atTenant('k', 'masivas/archivos');
    expect(activeBulkTabSignal.value).toBe('io');
    atTenant('k', 'uso-y-pagos/regalados');
    expect(creditsTabSignal.value).toBe('gifts');
    atTenant('k', 'dashboard');
    expect(salesTabSignal.value).toBe('sales');
  });

  it('cambiar de solapa en ventas cambia la URL', () => {
    atTenant('k', 'ventas');
    setTab('summary');
    expect(locationSignal.value.pathname).toBe('/admin/k/ventas/resumen');
  });

  it('una solapa de configuración no permitida va a Apariencia', () => {
    atTenant('k-member', 'configuracion/sucursales', 'member');
    const dispose = registerPermissionEffects();
    expect(locationSignal.value.pathname).toBe('/admin/k-member/configuracion/apariencia');
    dispose();
  });
});
