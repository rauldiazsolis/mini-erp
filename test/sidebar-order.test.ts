import { describe, it, expect } from 'vitest';
import { navItems } from '../src/client/components/shell/Sidebar.tsx';

describe('Orden del menú lateral', () => {
  it('Uso y pagos va después de Configuración & POS y antes de Plataforma', () => {
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

  it('la sección se llama Uso y pagos (#55)', () => {
    expect(navItems.find((i) => i.id === 'credits')?.label).toBe('Uso y pagos');
  });
});
