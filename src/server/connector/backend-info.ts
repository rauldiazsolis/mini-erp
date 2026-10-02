import { APP_VERSION } from '../app-version.ts';

/** Versión del contrato que implementa el mini-erp (4.2.0 más la capacidad demo-sessions de 4.4.0). */
export const CONTRACT_VERSION = '4.2.0';

export const MAINTENANCE_MESSAGE = 'mini contax se está actualizando, vuelve en unos minutos';

export type BackendInfo = {
  contractVersion: string;
  status: 'ok' | 'maintenance';
  message?: string;
  backend: { name: string; version: string };
  capabilities?: string[];
};

/** Respuesta de `GET /connector/info`: la misma en el app real y en el de mantenimiento (#47). */
export function backendInfo(params: { status: 'ok' | 'maintenance'; demos: boolean }): BackendInfo {
  return {
    contractVersion: CONTRACT_VERSION,
    status: params.status,
    ...(params.status === 'maintenance' ? { message: MAINTENANCE_MESSAGE } : {}),
    backend: { name: 'mini-erp', version: APP_VERSION },
    ...(params.demos ? { capabilities: ['demo-sessions'] } : {}),
  };
}
