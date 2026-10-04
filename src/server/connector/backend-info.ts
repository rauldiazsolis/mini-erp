import { APP_VERSION } from '../app-version.ts';
import { CONTRACT_VERSION } from '../../shared/contract-version.ts';

export const MAINTENANCE_MESSAGE = 'mini contax se está actualizando, vuelve en unos minutos';

export type BackendInfo = {
  contractVersion: string;
  status: 'ok' | 'maintenance';
  message?: string;
  backend: { name: string; version: string };
  capabilities: string[];
};

/** Respuesta de `GET /connector/info`: la misma en el app real y en el de mantenimiento (#47). */
export function backendInfo(params: { status: 'ok' | 'maintenance'; demos: boolean }): BackendInfo {
  return {
    contractVersion: CONTRACT_VERSION,
    status: params.status,
    ...(params.status === 'maintenance' ? { message: MAINTENANCE_MESSAGE } : {}),
    backend: { name: 'mini-erp', version: APP_VERSION },
    // Más allá del piso 4.0.0: anulación de cobranzas siempre, demos si están prendidas
    capabilities: ['customer-payment-void', ...(params.demos ? ['demo-sessions'] : [])],
  };
}
