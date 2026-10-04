import { describe, it, expect, beforeEach } from 'vitest';
import {
  mobileMenuOpenSignal,
  toggleMobileMenu,
  impersonationModalOpenSignal,
  openImpersonationModal,
  closeImpersonationModal,
} from '../src/client/state/navigation-state.ts';
import {
  toastsSignal,
  showToast,
  dismissToast,
} from '../src/client/state/toast-state.ts';
import {
  currentUserSignal,
  tokenSignal,
  userTenantsSignal,
  impersonateTenant,
  stopImpersonation,
  activeTenantSignal,
  isImpersonatingSignal,
  effectiveTenantIdSignal,
  logout,
} from '../src/client/state/auth-state.ts';
import { activeSectionSignal, goTo, setHistoryForTests } from '../src/client/state/route-state.ts';
import { atTenant } from './helpers/client-route.ts';

describe('App Shell, Navegación y Toasts (Etapa 3.4)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
    atTenant('t1');
    mobileMenuOpenSignal.value = false;
    impersonationModalOpenSignal.value = false;
    toastsSignal.value = [];
  });

  describe('Navegación reactiva', () => {
    it('inicia en la vista dashboard', () => {
      expect(activeSectionSignal.value).toBe('dashboard');
    });

    it('permite cambiar entre vistas (#59: con la URL)', () => {
      goTo({ section: 'catalog' });
      expect(activeSectionSignal.value).toBe('catalog');

      goTo({ section: 'stock' });
      expect(activeSectionSignal.value).toBe('stock');

      goTo({ section: 'customers' });
      expect(activeSectionSignal.value).toBe('customers');

      goTo({ section: 'bulk' });
      expect(activeSectionSignal.value).toBe('bulk');

      goTo({ section: 'settings' });
      expect(activeSectionSignal.value).toBe('settings');
    });

    it('conmuta la apertura del menú móvil', () => {
      expect(mobileMenuOpenSignal.value).toBe(false);
      toggleMobileMenu();
      expect(mobileMenuOpenSignal.value).toBe(true);
      toggleMobileMenu();
      expect(mobileMenuOpenSignal.value).toBe(false);
    });

    it('controla la apertura y cierre de modales', () => {
      openImpersonationModal();
      expect(impersonationModalOpenSignal.value).toBe(true);
      closeImpersonationModal();
      expect(impersonationModalOpenSignal.value).toBe(false);
    });
  });

  describe('Sistema de Toasts Reactivo', () => {
    it('agrega y remueve notificaciones toast', () => {
      expect(toastsSignal.value).toHaveLength(0);

      const id = showToast({
        type: 'success',
        title: 'Operación Exitosa',
        message: 'Producto guardado correctamente',
        durationMs: 0, // No auto dismiss en test
      });

      expect(toastsSignal.value).toHaveLength(1);
      expect(toastsSignal.value[0]?.id).toBe(id);
      expect(toastsSignal.value[0]?.title).toBe('Operación Exitosa');

      dismissToast(id);
      expect(toastsSignal.value).toHaveLength(0);
    });
  });

  describe('Selector de Tenant e Impersonación en App Shell', () => {
    it('muestra el tenant activo y permite conmutar', () => {
      tokenSignal.value = 'fake-token';
      currentUserSignal.value = {
        id: 'usr-1',
        email: 'root@demo.test',
        name: 'Root User',
        globalRole: 'root',
      };
      userTenantsSignal.value = [
        { tenantId: 't-central', slug: 'central', name: 'Sucursal Central', status: 'active', role: 'owner' },
        { tenantId: 't-norte', slug: 'norte', name: 'Sucursal Norte', status: 'active', role: 'owner' },
      ];

      atTenant('t-central');
      expect(activeTenantSignal.value?.name).toBe('Sucursal Central');
      expect(effectiveTenantIdSignal.value).toBe('t-central');

      atTenant('t-norte');
      expect(activeTenantSignal.value?.name).toBe('Sucursal Norte');
      expect(effectiveTenantIdSignal.value).toBe('t-norte');
    });

    it('gestiona el flujo completo de impersonación y retorno', () => {
      currentUserSignal.value = {
        id: 'usr-root',
        email: 'root@demo.test',
        name: 'Root User',
        globalRole: 'root',
      };
      tokenSignal.value = 'token-root';
      userTenantsSignal.value = [
        { tenantId: 'propio', slug: 'propio', name: 'Mi Comercio', status: 'active', role: 'owner' },
        { tenantId: 'ajeno', slug: 'ajeno', name: 'Comercio Cliente', status: 'active', role: 'root_impersonator' },
      ];

      atTenant('propio');
      expect(isImpersonatingSignal.value).toBe(false);
      expect(effectiveTenantIdSignal.value).toBe('propio');

      impersonateTenant('ajeno');
      expect(isImpersonatingSignal.value).toBe(true);
      expect(effectiveTenantIdSignal.value).toBe('ajeno');
      expect(activeTenantSignal.value?.name).toBe('Comercio Cliente');

      stopImpersonation();
      expect(isImpersonatingSignal.value).toBe(false);
      expect(effectiveTenantIdSignal.value).toBe('propio');
      expect(activeTenantSignal.value?.name).toBe('Mi Comercio');
    });
  });
});
