import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  decodeCsvBytes,
  loadImportText,
  setColumnField,
  confirmImport,
  resetImport,
  importEntitySignal,
  importMappingSignal,
  importPreviewSignal,
  importStepSignal,
  importErrorSignal,
  PREVIEW_DELAY_MS,
} from '../src/client/state/import-state.ts';
import { tokenSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import type { ImportPreview } from '../src/shared/import-fields.ts';
import { atTenant } from './helpers/client-route.ts';

const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
  entity: 'customers',
  separator: ';',
  columns: [
    { index: 0, header: 'Nombre', samples: ['Ana'] },
    { index: 1, header: 'Deuda', samples: ['10'] },
  ],
  mapping: { '0': 'name', '1': 'balance' },
  branches: [],
  missing: [],
  needsBranch: [],
  rows: [{ line: 2, key: 'Ana', action: 'create', messages: [] }],
  totals: { create: 1, update: 0, unchanged: 0, error: 0 },
  dryRun: true,
  ...over,
});

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

/** Responde en orden y guarda los cuerpos que mandó el store. */
function mockFetch(responses: ImportPreview[]): { url: string; body: unknown }[] {
  const calls: { url: string; body: unknown }[] = [];
  globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : null });
    return json(responses.shift() ?? preview());
  });
  return calls;
}

describe('asistente de importación (#22)', () => {
  beforeEach(() => {
    resetImport();
    tokenSignal.value = 'tok';
    userTenantsSignal.value = [{ tenantId: 't1', name: 'T1', slug: 't1', role: 'owner', status: 'active' }];
    atTenant('t1');
    importEntitySignal.value = 'customers';
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('decodifica UTF-8 y, si no es válido, Windows-1252 (Excel en castellano)', () => {
    expect(decodeCsvBytes(new TextEncoder().encode('Muñoz;Pérez'))).toBe('Muñoz;Pérez');
    expect(decodeCsvBytes(new Uint8Array([0x4d, 0x75, 0xf1, 0x6f, 0x7a]))).toBe('Muñoz');
  });

  it('al cargar el archivo pide la vista previa sin mapeo y adopta el sugerido', async () => {
    const calls = mockFetch([preview()]);
    await loadImportText('clientes.csv', 'Nombre;Deuda\nAna;10\n');
    expect(calls).toEqual([{ url: '/api/tenants/t1/import/customers', body: { csv: 'Nombre;Deuda\nAna;10\n', dryRun: true } }]);
    expect(importMappingSignal.value).toEqual({ '0': 'name', '1': 'balance' });
    expect(importStepSignal.value).toBe('mapping');
  });

  it('cambiar una columna vuelve a pedir la vista previa con el mapeo, después de un retardo', async () => {
    vi.useFakeTimers();
    const calls = mockFetch([preview(), preview({ mapping: { '0': 'name', '1': null } })]);
    await loadImportText('c.csv', 'Nombre;Deuda\nAna;10\n');
    setColumnField(1, null);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(PREVIEW_DELAY_MS);
    expect(calls[1]?.body).toEqual({ csv: 'Nombre;Deuda\nAna;10\n', mapping: { '0': 'name', '1': null }, dryRun: true });
    expect(importPreviewSignal.value?.mapping).toEqual({ '0': 'name', '1': null });
  });

  it('confirmar manda dryRun false con el mapeo y pasa al resultado', async () => {
    const calls = mockFetch([preview(), preview({ dryRun: false })]);
    await loadImportText('c.csv', 'Nombre;Deuda\nAna;10\n');
    await confirmImport();
    expect(calls[1]?.body).toEqual({ csv: 'Nombre;Deuda\nAna;10\n', mapping: { '0': 'name', '1': 'balance' }, dryRun: false });
    expect(importStepSignal.value).toBe('done');
    expect(importPreviewSignal.value?.dryRun).toBe(false);
  });

  it('un error del servidor queda a la vista y no avanza', async () => {
    mockFetch([preview()]);
    await loadImportText('c.csv', 'Nombre;Deuda\nAna;10\n');
    globalThis.fetch = vi.fn().mockImplementation(() => json({ error: 'Asigná las columnas que faltan antes de importar' }, 400));
    await confirmImport();
    expect(importErrorSignal.value).toBe('Asigná las columnas que faltan antes de importar');
    expect(importStepSignal.value).toBe('mapping');
  });

  it('resetImport vuelve al primer paso', async () => {
    mockFetch([preview()]);
    await loadImportText('c.csv', 'Nombre;Deuda\nAna;10\n');
    resetImport();
    expect(importStepSignal.value).toBe('file');
    expect(importPreviewSignal.value).toBeNull();
    expect(importMappingSignal.value).toEqual({});
  });
});
