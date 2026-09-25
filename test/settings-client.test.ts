import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  activeSettingsTabSignal,
  apiKeysSignal,
  createKeyModalOpenSignal,
  createKeyFormSignal,
  createdSecretKeySignal,
  openCreateKeyModal,
  closeCreateKeyModal,
  submitCreateApiKey,
  dismissSecretKeyModal,
  revokeApiKey,
  fetchApiKeys,
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
    apiKeysSignal.value = [
      {
        id: 'key-1',
        tenantId: 'tienda-test',
        name: 'Caja Mostrador 1',
        keyPrefix: 'mpos_live_ab12',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
        active: true,
        createdAt: '2026-09-25T10:00:00Z',
      },
    ];
    createKeyModalOpenSignal.value = false;
    createdSecretKeySignal.value = null;

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
    });
  });

  describe('Gestión de API Keys para Terminales POS', () => {
    it('openCreateKeyModal inicializa el formulario con sucursal por defecto', () => {
      openCreateKeyModal();
      expect(createKeyModalOpenSignal.value).toBe(true);
      expect(createKeyFormSignal.value.branch).toBe('CENTRAL');

      closeCreateKeyModal();
      expect(createKeyModalOpenSignal.value).toBe(false);
    });

    it('submitCreateApiKey emite una nueva llave y expone la clave secreta para copia única', async () => {
      openCreateKeyModal();
      createKeyFormSignal.value = {
        name: 'Terminal Tablet Patio',
        branch: 'CENTRAL',
        pointOfSale: 'Tablet 1',
      };

      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        if (init?.method === 'POST') {
          return new Response(
            JSON.stringify({
              id: 'key-2',
              rawKey: 'mpos_live_secret_full_key_998877',
              keyPrefix: 'mpos_live_se99',
            }),
            { status: 201, headers: { 'content-type': 'application/json' } },
          );
        }

        if (String(url).includes('/api-keys')) {
          return new Response(
            JSON.stringify([
              ...apiKeysSignal.value,
              {
                id: 'key-2',
                tenantId: 'tienda-test',
                name: 'Terminal Tablet Patio',
                keyPrefix: 'mpos_live_se99',
                branch: 'CENTRAL',
                pointOfSale: 'Tablet 1',
                active: true,
                createdAt: '2026-09-25T12:00:00Z',
              },
            ]),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }

        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;

      try {
        await submitCreateApiKey();

        expect(createKeyModalOpenSignal.value).toBe(false);
        expect(createdSecretKeySignal.value).not.toBeNull();
        expect(createdSecretKeySignal.value?.rawKey).toBe('mpos_live_secret_full_key_998877');
        expect(apiKeysSignal.value.length).toBe(2);

        dismissSecretKeyModal();
        expect(createdSecretKeySignal.value).toBeNull();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it('revokeApiKey desactiva la llave seleccionada', async () => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch;

      try {
        await revokeApiKey('key-1', 'Caja Mostrador 1');
        expect(apiKeysSignal.value.length).toBe(0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('Administración de Sucursales', () => {
    it('openNewBranchModal y openEditBranchModal manejan el formulario', () => {
      openNewBranchModal();
      expect(branchModalOpenSignal.value).toBe(true);
      expect(editingBranchSignal.value).toBeNull();

      closeBranchModal();
      expect(branchModalOpenSignal.value).toBe(false);

      openEditBranchModal(settingsBranchesSignal.value[0]!);
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
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            id: 'b-2',
            code: 'SUC-SUR',
            name: 'Sucursal Sur',
            createdAt: '2026-09-25T13:00:00Z',
            updatedAt: '2026-09-25T13:00:00Z',
          }),
          { status: 201, headers: { 'content-type': 'application/json' } },
        );
      }) as unknown as typeof fetch;

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
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (String(url).includes('/connector/info')) {
          return new Response(
            JSON.stringify({
              version: '4.0.0',
              status: 'ok',
            }),
            { status: 200, headers: { 'content-type': 'application/json' } },
          );
        }
        return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
      }) as unknown as typeof fetch;

      try {
        await checkConnectorStatus();

        expect(connectorInfoSignal.value).not.toBeNull();
        expect(connectorInfoSignal.value?.version).toBe('4.0.0');
        expect(connectorInfoSignal.value?.status).toBe('ok');
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});
