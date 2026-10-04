import { effect, signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal } from './auth-state.ts';
import { invalidateAfter } from './invalidation.ts';
import type { ImportEntity, ImportField, ImportMapping, ImportPreview } from '../../shared/import-fields.ts';

/** Espera después de cambiar una columna antes de pedir la vista previa otra vez. */
export const PREVIEW_DELAY_MS = 300;

export type ImportStep = 'file' | 'mapping' | 'done';

export const importEntitySignal = signal<ImportEntity>('products');
export const importFileNameSignal = signal<string | null>(null);
export const importCsvSignal = signal<string>('');
export const importMappingSignal = signal<ImportMapping>({});
export const importPreviewSignal = signal<ImportPreview | null>(null);
export const importStepSignal = signal<ImportStep>('file');
export const importLoadingSignal = signal<boolean>(false);
export const importErrorSignal = signal<string | null>(null);
export const importOnlyIssuesSignal = signal<boolean>(false);

let previewTimer: ReturnType<typeof setTimeout> | undefined;

function cancelPendingPreview(): void {
  if (previewTimer !== undefined) clearTimeout(previewTimer);
  previewTimer = undefined;
}

/** Excel en Windows en castellano guarda el CSV en Windows-1252: si no es UTF-8 válido, se lee así (#22). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** El servidor parsea, sugiere y valida: cada pedido manda el CSV entero (sin estado). */
async function send(mapping: ImportMapping | undefined, dryRun: boolean): Promise<ImportPreview | null> {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  if (!tenantId || !token) return null;
  importLoadingSignal.value = true;
  importErrorSignal.value = null;
  try {
    return await apiFetch<ImportPreview>(`tenants/${tenantId}/import/${importEntitySignal.value}`, {
      method: 'POST',
      token,
      body: { csv: importCsvSignal.value, ...(mapping === undefined ? {} : { mapping }), dryRun },
    });
  } catch (err: unknown) {
    importErrorSignal.value = err instanceof Error ? err.message : 'No se pudo leer el archivo';
    return null;
  } finally {
    importLoadingSignal.value = false;
  }
}

/** Primera vista previa, sin mapeo: el servidor sugiere uno y el asistente lo adopta. */
export async function loadImportText(fileName: string, text: string): Promise<void> {
  cancelPendingPreview();
  importFileNameSignal.value = fileName;
  importCsvSignal.value = text;
  const res = await send(undefined, true);
  if (res === null) return;
  importPreviewSignal.value = res;
  importMappingSignal.value = res.mapping;
  importStepSignal.value = 'mapping';
}

export async function loadImportFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  await loadImportText(file.name, decodeCsvBytes(bytes));
}

export async function requestImportPreview(): Promise<void> {
  const res = await send(importMappingSignal.value, true);
  if (res !== null) importPreviewSignal.value = res;
}

export function setColumnField(index: number, field: ImportField | null): void {
  importMappingSignal.value = { ...importMappingSignal.value, [String(index)]: field };
  cancelPendingPreview();
  previewTimer = setTimeout(() => {
    previewTimer = undefined;
    void requestImportPreview();
  }, PREVIEW_DELAY_MS);
}

export async function confirmImport(): Promise<void> {
  cancelPendingPreview();
  const res = await send(importMappingSignal.value, false);
  if (res === null) return;
  importPreviewSignal.value = res;
  importStepSignal.value = 'done';
  void invalidateAfter(importEntitySignal.value === 'customers' ? 'customers-imported' : 'products-imported');
}

export function resetImport(): void {
  cancelPendingPreview();
  importFileNameSignal.value = null;
  importCsvSignal.value = '';
  importMappingSignal.value = {};
  importPreviewSignal.value = null;
  importStepSignal.value = 'file';
  importLoadingSignal.value = false;
  importErrorSignal.value = null;
  importOnlyIssuesSignal.value = false;
}

if (typeof window !== 'undefined') {
  // Otro comercio activo: el archivo y la vista previa eran del anterior
  let lastTenant = effectiveTenantIdSignal.peek();
  effect(() => {
    const tenant = effectiveTenantIdSignal.value;
    if (tenant !== lastTenant) {
      lastTenant = tenant;
      resetImport();
    }
  });
}
