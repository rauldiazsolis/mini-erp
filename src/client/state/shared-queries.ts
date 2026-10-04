import { apiFetch } from '../api/client.ts';
import { inSection } from './route-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { showToast } from './toast-state.ts';
import type { BranchItem, StockMatrixItem } from './stock-state.ts';

/** Lo que piden varias pantallas (#59): una sola caché y un solo pedido. */

export const categoriesQuery = createTenantQuery<string[]>({
  domain: 'categories',
  enabled: () => inSection('catalog', 'stock', 'bulk'),
  fn: ({ tenantId, token }) => apiFetch<string[]>(`tenants/${tenantId}/categories`, { token }).catch(() => []),
});

export const stockMatrixQuery = createTenantQuery<StockMatrixItem[]>({
  domain: 'stock',
  enabled: () => inSection('catalog', 'stock'),
  onError: (err) => {
    showToast({ type: 'error', title: 'Error de stock', message: err.message });
  },
  fn: ({ tenantId, token }) => apiFetch<StockMatrixItem[]>(`tenants/${tenantId}/stock`, { token }),
});

export const branchesQuery = createTenantQuery<BranchItem[]>({
  domain: 'branches',
  enabled: () => inSection('dashboard', 'stock', 'settings'),
  fn: ({ tenantId, token }) => apiFetch<BranchItem[]>(`tenants/${tenantId}/branches`, { token }),
});
