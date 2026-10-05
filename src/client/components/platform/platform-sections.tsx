import type { ComponentChildren } from 'preact';
import type { PlatformSectionId } from '../../routing/admin-routes.ts';
import { isPlatformSectionAllowed } from '../../state/permissions-state.ts';

export type PlatformNavItem = {
  id: PlatformSectionId;
  label: string;
  /** El subtítulo del `PageHeader` de la sección. */
  subtitle: string;
  icon: (active: boolean) => ComponentChildren;
};

function icon(paths: string[]): (active: boolean) => ComponentChildren {
  return (active) => (
    <svg
      class={`w-5 h-5 ${active ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
    >
      {paths.map((d) => (
        <path key={d} stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d={d} />
      ))}
    </svg>
  );
}

/**
 * Las secciones de la plataforma (#23) en el menú lateral de root y soporte (#81), en el orden de
 * `PLATFORM_SECTIONS`. Quién ve cuál lo dice `isPlatformSectionAllowed`.
 */
export const platformNavItems: PlatformNavItem[] = [
  {
    id: 'tenants',
    label: 'Comercios',
    subtitle: 'Los comercios reales, con su titular, estado y cobro',
    icon: icon(['M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4']),
  },
  {
    id: 'users',
    label: 'Usuarios',
    subtitle: 'Todas las cuentas, con sus comercios',
    icon: icon(['M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z']),
  },
  {
    id: 'requests',
    label: 'Pedidos',
    subtitle: 'Los pedidos de ayuda de las últimas 48 horas',
    icon: icon(['M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z']),
  },
  {
    id: 'demos',
    label: 'Demos',
    subtitle: 'Los comercios demo de cada rubro y sus reinicios',
    icon: icon([
      'M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z',
      'M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
    ]),
  },
  {
    id: 'payments',
    label: 'Cobranzas',
    subtitle: 'La planilla de cobranzas y los pagos registrados',
    icon: icon(['M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z']),
  },
  {
    id: 'staff',
    label: 'Soporte',
    subtitle: 'El equipo de soporte y sus invitaciones',
    icon: icon(['M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z']),
  },
  {
    id: 'audit',
    label: 'Registro',
    subtitle: 'Todo lo auditado, con filtro por comercio',
    icon: icon(['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01']),
  },
  {
    id: 'settings',
    label: 'Configuración',
    subtitle: 'El cobro de mini contax: precio, bono, gracia y cómo pagar',
    icon: icon(['M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4']),
  },
];

/** Las secciones que ve quien está logueado: ocho para root, seis para soporte, ninguna para el resto. */
export function visiblePlatformNavItems(): PlatformNavItem[] {
  return platformNavItems.filter((item) => isPlatformSectionAllowed(item.id));
}
