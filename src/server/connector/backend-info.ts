import { APP_VERSION } from '../app-version.ts';
import { CONTRACT_VERSION } from '../../shared/contract-version.ts';

/** La capacidad portal (4.6.0, adelantada de M10 en #24): el comando y el botón del POS. */
export const PORTAL = { command: 'MINI', label: 'Abrir mini' } as const;

export const MAINTENANCE_MESSAGE = 'mini contax se está actualizando, vuelve en unos minutos';

export type BackendInfo = {
  contractVersion: string;
  status: 'ok' | 'maintenance';
  message?: string;
  backend: { name: string; version: string };
  /** 4.5.0 (#58): el comercio de la key; no va sin key (mantenimiento) ni con el nombre vacío. */
  company?: { name: string };
  capabilities: string[];
  /** 4.6.0: el comando y el botón del portal, junto con la capacidad. */
  portal?: { command: string; label: string };
};

/** Respuesta de `GET /connector/info`: la misma en el app real y en el de mantenimiento (#47). */
export function backendInfo(params: {
  status: 'ok' | 'maintenance';
  demos: boolean;
  /** El portal se declara con una key (#24); sin key (mantenimiento), no. */
  portal: boolean;
  companyName?: string | undefined;
}): BackendInfo {
  const companyName = params.companyName?.trim() ?? '';
  return {
    contractVersion: CONTRACT_VERSION,
    status: params.status,
    ...(params.status === 'maintenance' ? { message: MAINTENANCE_MESSAGE } : {}),
    backend: { name: 'mini-erp', version: APP_VERSION },
    ...(companyName === '' ? {} : { company: { name: companyName } }),
    // Más allá del piso 4.0.0: anulación de cobranzas siempre, demos si están prendidas y el portal con una key
    capabilities: ['customer-payment-void', ...(params.demos ? ['demo-sessions'] : []), ...(params.portal ? ['portal'] : [])],
    ...(params.portal ? { portal: { ...PORTAL } } : {}),
  };
}
