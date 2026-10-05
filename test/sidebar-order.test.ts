import { describe, it, expect } from 'vitest';
import { navItems } from '../src/client/components/shell/Sidebar.tsx';

describe('Orden del menú lateral', () => {
  it('Uso y pagos va al final, después de Configuración & POS (#81: Plataforma es su propio menú)', () => {
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
    ]);
  });

  it('la sección se llama Uso y pagos (#55)', () => {
    expect(navItems.find((i) => i.id === 'credits')?.label).toBe('Uso y pagos');
  });
});
