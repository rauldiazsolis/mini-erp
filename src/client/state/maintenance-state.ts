import { signal } from '@preact/signals';

/** El servidor está en mantenimiento (#47): `App` muestra la pantalla de actualización. */
export const maintenanceSignal = signal(false);

const POLL_MS = 5_000;
let timer: ReturnType<typeof setInterval> | undefined;

/** Un `503` con `code: 'maintenance'`: lo que responde el mini-erp mientras migra. */
export function isMaintenanceResponse(status: number, data: unknown): boolean {
  return status === 503 && typeof data === 'object' && data !== null && 'code' in data && data.code === 'maintenance';
}

/**
 * Prende el aviso y consulta `/health` cada 5 s. Cuando vuelve, recarga: la versión cambió y los
 * assets también.
 */
export function enterMaintenance(deps?: {
  fetchHealth?: (() => Promise<number>) | undefined;
  reload?: (() => void) | undefined;
  intervalMs?: number | undefined;
}): void {
  maintenanceSignal.value = true;
  if (timer !== undefined) {
    return;
  }
  const fetchHealth = deps?.fetchHealth ?? (async () => (await fetch('/health', { cache: 'no-store' })).status);
  const reload = deps?.reload ?? (() => { window.location.reload(); });
  timer = setInterval(() => {
    fetchHealth()
      .then((status) => {
        if (status === 200) {
          clearInterval(timer);
          timer = undefined;
          reload();
        }
      })
      .catch(() => {
        // Sigue sin responder: se vuelve a probar en el próximo intervalo
      });
  }, deps?.intervalMs ?? POLL_MS);
}

/** Para un `fetch` suelto (fuera de `apiFetch`): mira si la respuesta es la del mantenimiento. */
export async function noteMaintenanceResponse(res: Response): Promise<void> {
  if (res.status !== 503) {
    return;
  }
  let data: unknown;
  try {
    data = await res.clone().json();
  } catch {
    return;
  }
  if (isMaintenanceResponse(res.status, data)) {
    enterMaintenance();
  }
}

/** Solo para tests: apaga el aviso y el intervalo. */
export function resetMaintenance(): void {
  clearInterval(timer);
  timer = undefined;
  maintenanceSignal.value = false;
}
