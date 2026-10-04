import { signal, computed } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { canDo } from './permissions-state.ts';
import { inSection } from './route-state.ts';
import { createTenantQuery } from './query-keys.ts';
import { invalidateAfter } from './invalidation.ts';
import { showToast } from './toast-state.ts';
import { settingsBranchesSignal } from './settings-state.ts';
import type { RegisterItem } from '../../shared/register-types.ts';

/**
 * Cajas del POS (#21): cada una con su equipo ligado y su key. Las ven owner y admin
 * (`settings.manage`); la key se muestra una sola vez, al crear la caja o al rotarla.
 */

type RegisterForm = { name: string; branch: string; pointOfSale: string };
type KeyResponse = { rawKey: string; keyPrefix: string };

const registersQuery = createTenantQuery<RegisterItem[]>({
  domain: 'pos-registers',
  enabled: () => inSection('settings') && canDo('settings.manage'),
  onError: (err) => {
    showToast({ type: 'error', title: 'No se pudieron cargar las cajas', message: err.message });
  },
  fn: ({ tenantId, token }) => apiFetch<RegisterItem[]>(`tenants/${tenantId}/pos-registers`, { token }),
});

export const registersSignal = computed<RegisterItem[]>(() => registersQuery.data.value ?? []);
export const registersLoadingSignal = registersQuery.isLoading;
export const createRegisterModalOpenSignal = signal<boolean>(false);
export const createRegisterFormSignal = signal<RegisterForm>({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
export const createRegisterErrorSignal = signal<string | null>(null);
export const isCreatingRegisterSignal = signal<boolean>(false);
/** La key recién creada o rotada: se muestra una vez. */
export const revealedKeySignal = signal<{ registerName: string; rawKey: string } | null>(null);

function context(): { base: string; token: string } | null {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  return tenantId && token ? { base: `tenants/${tenantId}/pos-registers`, token } : null;
}

/** Confirma con el navegador; sin `confirm` (tests sin DOM), sigue. */
function confirmed(message: string): boolean {
  return typeof globalThis.confirm === 'function' ? globalThis.confirm(message) : true;
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export async function fetchRegisters(): Promise<void> {
  await registersQuery.refetch();
}

export function openCreateRegisterModal(): void {
  const next = `Caja ${String(registersSignal.value.length + 1)}`;
  createRegisterFormSignal.value = { name: next, branch: settingsBranchesSignal.value[0]?.code ?? 'CENTRAL', pointOfSale: next };
  createRegisterErrorSignal.value = null;
  createRegisterModalOpenSignal.value = true;
}

export function closeCreateRegisterModal(): void {
  createRegisterModalOpenSignal.value = false;
  createRegisterErrorSignal.value = null;
}

export async function submitCreateRegister(): Promise<void> {
  const ctx = context();
  if (ctx === null) return;
  const form = createRegisterFormSignal.value;
  if (!form.name.trim() || !form.branch.trim() || !form.pointOfSale.trim()) {
    createRegisterErrorSignal.value = 'Completá todos los campos';
    return;
  }
  try {
    isCreatingRegisterSignal.value = true;
    createRegisterErrorSignal.value = null;
    const name = form.name.trim();
    const res = await apiFetch<KeyResponse>(ctx.base, {
      method: 'POST',
      token: ctx.token,
      body: { name, branch: form.branch.trim().toUpperCase(), pointOfSale: form.pointOfSale.trim() },
    });
    revealedKeySignal.value = { registerName: name, rawKey: res.rawKey };
    closeCreateRegisterModal();
    await invalidateAfter('register-changed');
  } catch (err: unknown) {
    createRegisterErrorSignal.value = errorText(err, 'No se pudo crear la caja');
  } finally {
    isCreatingRegisterSignal.value = false;
  }
}

/** Corre una acción sobre una caja si el usuario confirma, avisa y deja viejas las cajas y el cobro. */
async function act(item: RegisterItem, message: string, done: string, run: (ctx: { base: string; token: string }) => Promise<void>): Promise<void> {
  const ctx = context();
  if (ctx === null || !confirmed(message)) return;
  try {
    await run(ctx);
    showToast({ type: 'success', title: item.name, message: done });
    await invalidateAfter('register-changed');
  } catch (err: unknown) {
    showToast({ type: 'error', title: item.name, message: errorText(err, 'No se pudo completar la acción') });
  }
}

export async function rotateRegisterKey(item: RegisterItem): Promise<void> {
  await act(
    item,
    `¿Generar una key nueva para «${item.name}»? La actual deja de funcionar: hay que cargar la nueva en el POS.`,
    'Key nueva generada',
    async (ctx) => {
      const res = await apiFetch<KeyResponse>(`${ctx.base}/${item.id}/rotate-key`, { method: 'POST', token: ctx.token });
      revealedKeySignal.value = { registerName: item.name, rawKey: res.rawKey };
    },
  );
}

export async function transferRegister(item: RegisterItem, deviceId: string): Promise<void> {
  await act(
    item,
    `¿Pasar «${item.name}» a este equipo? Sus ventas se cobran desde ahora como las de la caja.`,
    'La caja pasó al otro equipo',
    async (ctx) => {
      await apiFetch(`${ctx.base}/${item.id}/transfer`, { method: 'POST', token: ctx.token, body: { deviceId } });
    },
  );
}

export async function unbindRegister(item: RegisterItem): Promise<void> {
  await act(item, `¿Desligar el equipo de «${item.name}»? El próximo equipo que la use queda ligado.`, 'Equipo desligado', async (ctx) => {
    await apiFetch(`${ctx.base}/${item.id}/unbind`, { method: 'POST', token: ctx.token });
  });
}

export async function deactivateRegister(item: RegisterItem): Promise<void> {
  await act(item, `¿Desactivar «${item.name}»? Su key deja de funcionar.`, 'Caja desactivada', async (ctx) => {
    await apiFetch(`${ctx.base}/${item.id}`, { method: 'DELETE', token: ctx.token });
  });
}

export function dismissRevealedKey(): void {
  revealedKeySignal.value = null;
}
