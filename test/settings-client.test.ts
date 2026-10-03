import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  activeSettingsTabSignal,
  settingsBranchesSignal,
  branchModalOpenSignal,
  editingBranchSignal,
  branchFormSignal,
  openNewBranchModal,
  openEditBranchModal,
  closeBranchModal,
  submitBranchForm,
  checkConnectorStatus,
  connectorInfoSignal,
} from '../src/client/state/settings-state.ts';
import {
  tokenSignal,
  activeTenantIdSignal,
  userTenantsSignal,
} from '../src/client/state/auth-state.ts';

describe('Módulo de Configuración, Sucursales y API Keys POS (Etapa 4.5)', () => {
  beforeEach(() => {
    activeSettingsTabSignal.value = 'pos';
    settingsBranchesSignal.value = [
      { id: 'b-1', code: 'CENTRAL', name: 'Casa Central', createdAt: '2026-09-25T10:00:00Z', updatedAt: '2026-09-25T10:00:00Z' },
    ];
    branchModalOpenSignal.value = false;
    editingBranchSignal.value = null;
    connectorInfoSignal.value = null;

    tokenSignal.value = 'mock-token';
    activeTenantIdSignal.value = 'tienda-test';
    userTenantsSignal.value = [
      { tenantId: 'tienda-test', name: 'Tienda Test', slug: 'tienda-test', role: 'owner', status: 'active' },
    ];
    vi.restoreAllMocks();
  });

  describe('Navegación de Pestañas', () => {
    it('inicia en terminales pos y permite cambiar de solapa', () => {
      expect(activeSettingsTabSignal.value).toBe('pos');

      activeSettingsTabSignal.value = 'branches';
      expect(activeSettingsTabSignal.value).toBe('branches');

      activeSettingsTabSignal.value = 'connection';
      expect(activeSettingsTabSignal.value).toBe('connection');

      activeSettingsTabSignal.value = 'appearance';
      expect(activeSettingsTabSignal.value).toBe('appearance');
    });
  });

  describe('Administración de Sucursales', () => {
    it('openNewBranchModal y openEditBranchModal manejan el formulario', () => {
      openNewBranchModal();
      expect(branchModalOpenSignal.value).toBe(true);
      expect(editingBranchSignal.value).toBeNull();

      closeBranchModal();
      expect(branchModalOpenSignal.value).toBe(false);

      const branchItem = settingsBranchesSignal.value[0];
      if (!branchItem) throw new Error('Branch should exist');
      openEditBranchModal(branchItem);
      expect(branchModalOpenSignal.value).toBe(true);
      expect(editingBranchSignal.value?.id).toBe('b-1');
      expect(branchFormSignal.value.code).toBe('CENTRAL');
    });

    it('submitBranchForm crea una nueva sucursal y la añade a la lista', async () => {
      openNewBranchModal();
      branchFormSignal.value = {
        name: 'Sucursal Sur',
        code: 'SUC-SUR',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        return Promise.resolve(new Response(
          JSON.stringify({
            id: 'b-2',
            code: 'SUC-SUR',
            name: 'Sucursal Sur',
            createdAt: '2026-09-25T13:00:00Z',
            updatedAt: '2026-09-25T13:00:00Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        ));
      });

      try {
        await submitBranchForm();

        expect(branchModalOpenSignal.value).toBe(false);
        expect(settingsBranchesSignal.value.length).toBe(2);
        expect(settingsBranchesSignal.value[1]?.code).toBe('SUC-SUR');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Verificación del Connector POS', () => {
    it('checkConnectorStatus consulta el endpoint /connector/info con éxito', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/connector/info')) {
          return Promise.resolve(new Response(
            JSON.stringify({
              version: '4.2.0',
              status: 'ok',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          ));
        }
        return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } }));
      });

      try {
        await checkConnectorStatus();

        expect(connectorInfoSignal.value).not.toBeNull();
        expect(connectorInfoSignal.value?.version).toBe('4.2.0');
        expect(connectorInfoSignal.value?.status).toBe('ok');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
