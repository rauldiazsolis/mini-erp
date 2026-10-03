import { describe, it, expect } from 'vitest';
import { navItems } from '../src/client/components/shell/Sidebar.tsx';

describe('Orden del menú lateral', () => {
  it('Créditos va después de Configuración & POS y antes de Plataforma', () => {
    expect(navItems.map((item) => item.id)).toEqual([
      'dashboard',
      'sales',
      'catalog',
      'stock',
      'customers',
      'bulk',
      'users',
      'settings',
      'credits',
      'platform',
    ]);
  });
});
