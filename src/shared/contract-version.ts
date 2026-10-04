/**
 * Versión del contrato que implementa el mini-erp (#2, #58) y el canal del POS publicado que la habla.
 * TS puro: la usan el servidor, el cliente y los scripts. El canal es el major (`/v4/`): al
 * implementar el contrato 5, los links, el espejo y `contract:update` pasan a `/v5/` solos.
 */
export const CONTRACT_VERSION = '4.4.0';

/** El major de una versión x.y.z, como texto (`'4'`). */
export function majorOf(version: string): string {
  return version.split('.')[0] ?? '';
}

/** El canal del POS publicado para una versión del contrato (`'v4'`). */
export function channelOf(version: string): string {
  return `v${majorOf(version)}`;
}

export const CONTRACT_MAJOR = majorOf(CONTRACT_VERSION);
export const POS_CHANNEL = channelOf(CONTRACT_VERSION);
