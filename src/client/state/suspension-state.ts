import { computed } from '@preact/signals';
import { activeTenantSignal, currentUserSignal } from './auth-state.ts';
import { activeSectionSignal } from './route-state.ts';

/**
 * Si el admin muestra "Este comercio está suspendido" en lugar de la sección (#23): el comercio de la
 * URL está suspendido, quien mira es un usuario del comercio (no root ni soporte) y la sección no es
 * Uso y pagos, que sigue abierta. El servidor da 403 `tenant-suspended` a lo demás.
 */
export const suspendedNoticeSignal = computed<boolean>(
  () =>
    activeTenantSignal.value?.status === 'suspended' &&
    currentUserSignal.value?.globalRole === 'user' &&
    activeSectionSignal.value !== 'credits',
);
