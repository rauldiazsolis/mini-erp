import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { funnelContactSchema } from '../../shared/funnel-contact.ts';
import type { FunnelContactSource, FunnelDailyKind } from '../../shared/funnel-types.ts';

/**
 * Lo público del embudo (#25): los beacons del landing y del alta y el contacto "¿Querés que te
 * ayudemos a empezar?". "Una vez" y "ya lo dejó" viven en memoria de la carga: el almacenamiento de
 * la pestaña es solo de `auth-state` (#23).
 */

const sent = new Set<string>();

export function sendFunnelBeacon(kind: FunnelDailyKind, demoSessionId?: string): void {
  const body = JSON.stringify(demoSessionId === undefined ? { kind } : { kind, demoSessionId });
  try {
    void fetch('/api/funnel/beacon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Un beacon nunca rompe la página
  }
}

export function beaconOnce(kind: FunnelDailyKind, demoSessionId?: string): void {
  const key = `${kind}:${demoSessionId ?? ''}`;
  if (sent.has(key)) return;
  sent.add(key);
  sendFunnelBeacon(kind, demoSessionId);
}

export type ContactDialog = { source: FunnelContactSource; demoSessionId?: string | undefined };
export const contactDialogSignal = signal<ContactDialog | null>(null);
export const contactSentSignal = signal<boolean>(false);

export function openContact(source: FunnelContactSource, demoSessionId?: string): void {
  contactDialogSignal.value = demoSessionId === undefined ? { source } : { source, demoSessionId };
}

export function closeContact(): void {
  contactDialogSignal.value = null;
}

/** Valida y manda el contacto; devuelve el mensaje de error o `null` si quedó guardado. */
export async function submitContact(form: { name: string; whatsapp: string }): Promise<string | null> {
  const dialog = contactDialogSignal.peek();
  if (dialog === null) return null;
  const input = { ...form, ...dialog };
  const parsed = funnelContactSchema.safeParse(input);
  if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Revisá los datos';
  try {
    await apiFetch<{ id: string }>('/api/funnel/contacts', { method: 'POST', body: input });
  } catch (err: unknown) {
    return err instanceof Error ? err.message : 'No se pudo enviar';
  }
  contactSentSignal.value = true;
  contactDialogSignal.value = null;
  return null;
}

export function resetFunnelPublicForTests(): void {
  sent.clear();
  contactDialogSignal.value = null;
  contactSentSignal.value = false;
}
