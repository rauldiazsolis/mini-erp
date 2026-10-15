import { describe, it, expect, beforeEach, vi } from 'vitest';
import { signal } from '@preact/signals';
import type { QueryKey } from '@tanstack/query-core';
import { createSignalInfiniteQuery, createSignalQuery, queryClient, shouldRetry } from '../src/client/api/query-client.ts';
import { ApiError } from '../src/client/api/client.ts';

const sameTenant = (a: QueryKey, b: QueryKey): boolean => a[1] === b[1];

describe('createSignalQuery (#59)', () => {
  beforeEach(() => { queryClient.clear(); });

  it('no pide deshabilitada; pide al habilitarse', async () => {
    const on = signal(false);
    const fn = vi.fn(() => Promise.resolve(['a']));
    const q = createSignalQuery({ source: () => ({ key: ['x'], fn }), enabled: () => on.value });
    expect(fn).not.toHaveBeenCalled();
    expect(q.isLoading.value).toBe(false);
    on.value = true;
    expect(q.isLoading.value).toBe(true);
    await vi.waitFor(() => { expect(q.data.value).toEqual(['a']); });
    expect(fn).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it('al volver a la pantalla muestra la caché al toque y refresca', async () => {
    const on = signal(true);
    const fn = vi.fn(() => Promise.resolve(['a']));
    const q = createSignalQuery({ source: () => ({ key: ['x'], fn }), enabled: () => on.value });
    await vi.waitFor(() => { expect(q.data.value).toEqual(['a']); });
    on.value = false;
    fn.mockImplementation(() => Promise.resolve(['b']));
    on.value = true;
    expect(q.data.value).toEqual(['a']);
    expect(q.isLoading.value).toBe(false);
    await vi.waitFor(() => { expect(q.data.value).toEqual(['b']); });
    q.dispose();
  });

  it('entre filtros del mismo comercio ve el dato anterior; entre comercios, nunca', async () => {
    const key = signal<QueryKey>(['t', 'A', 'p', 1]);
    let release: (value: string) => void = () => undefined;
    const q = createSignalQuery<string>({
      source: () => ({ key: key.value, fn: () => new Promise<string>((resolve) => { release = resolve; }) }),
      keepPrevious: sameTenant,
    });
    release('A1');
    await vi.waitFor(() => { expect(q.data.value).toBe('A1'); });
    key.value = ['t', 'A', 'p', 2];
    expect(q.data.value).toBe('A1');
    release('A2');
    await vi.waitFor(() => { expect(q.data.value).toBe('A2'); });
    key.value = ['t', 'B', 'p', 1];
    expect(q.data.value).toBeUndefined();
    q.dispose();
  });

  it('después de clear() (otra sesión), la misma clave no muestra el dato anterior (#68)', async () => {
    const token = signal('tok-a');
    let release: (value: string) => void = () => undefined;
    const q = createSignalQuery<string>({
      source: () => {
        const t = token.value;
        return { key: ['t', 'A', 'billing-status'], fn: () => new Promise<string>((resolve) => { release = (v) => { resolve(`${v} (${t})`); }; }) };
      },
      keepPrevious: sameTenant,
    });
    release('dato');
    await vi.waitFor(() => { expect(q.data.value).toBe('dato (tok-a)'); });
    queryClient.clear();
    token.value = 'tok-b';
    expect(q.data.value).toBeUndefined();
    release('dato');
    await vi.waitFor(() => { expect(q.data.value).toBe('dato (tok-b)'); });
    q.dispose();
  });

  it('sin fuente no hay datos ni pedido', () => {
    const fn = vi.fn(() => Promise.resolve(1));
    const q = createSignalQuery({ source: () => null });
    expect(q.data.value).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
    q.dispose();
  });

  it('setData escribe en la clave actual, aunque esté deshabilitada', () => {
    const q = createSignalQuery<number[]>({ source: () => ({ key: ['x'], fn: () => Promise.resolve([]) }), enabled: () => false });
    q.setData(() => [1, 2]);
    expect(q.data.value).toEqual([1, 2]);
    expect(queryClient.getQueryData(['x'])).toEqual([1, 2]);
    q.dispose();
  });

  it('avisa cada error una vez', async () => {
    const onError = vi.fn();
    const q = createSignalQuery({ source: () => ({ key: ['x'], fn: () => Promise.reject(new ApiError(404, 'No está')) }), onError });
    await vi.waitFor(() => { expect(q.error.value?.message).toBe('No está'); });
    expect(onError).toHaveBeenCalledTimes(1);
    q.dispose();
  });

  it('no reintenta un 4xx; la red o un 5xx, una vez', () => {
    expect(shouldRetry(0, new ApiError(404, 'x'))).toBe(false);
    expect(shouldRetry(0, new ApiError(503, 'x'))).toBe(true);
    expect(shouldRetry(0, new TypeError('red'))).toBe(true);
    expect(shouldRetry(1, new TypeError('red'))).toBe(false);
  });
});

describe('createSignalInfiniteQuery (#87)', () => {
  beforeEach(() => { queryClient.clear(); });

  type Page = { items: string[]; next: string | null };
  const pages: Record<string, Page> = {
    '': { items: ['a', 'b'], next: 'c1' },
    c1: { items: ['c', 'd'], next: 'c2' },
    c2: { items: ['e'], next: null },
  };

  it('pide el primer tramo, suma los siguientes y sabe cuándo terminó', async () => {
    const fn = vi.fn((cursor: string | undefined) => Promise.resolve(pages[cursor ?? ''] ?? { items: [], next: null }));
    const q = createSignalInfiniteQuery<Page>({ source: () => ({ key: ['x'], fn }), nextCursor: (p) => p.next });
    await vi.waitFor(() => { expect(q.data.value?.map((p) => p.items).flat()).toEqual(['a', 'b']); });
    expect(q.hasMore.value).toBe(true);
    await q.loadMore();
    await q.loadMore();
    expect(q.data.value?.map((p) => p.items).flat()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(q.hasMore.value).toBe(false);
    expect(fn.mock.calls.map(([cursor]) => cursor)).toEqual([undefined, 'c1', 'c2']);
    // Sin más tramos, no pide nada
    await q.loadMore();
    expect(fn).toHaveBeenCalledTimes(3);
    q.dispose();
  });

  it('un cambio de clave vuelve al primer tramo', async () => {
    const key = signal<QueryKey>(['t', 'A', 1]);
    const fn = vi.fn((cursor: string | undefined) => Promise.resolve(pages[cursor ?? ''] ?? { items: [], next: null }));
    const q = createSignalInfiniteQuery<Page>({ source: () => ({ key: key.value, fn }), nextCursor: (p) => p.next });
    await vi.waitFor(() => { expect(q.data.value).toHaveLength(1); });
    await q.loadMore();
    expect(q.data.value).toHaveLength(2);
    key.value = ['t', 'A', 2];
    await vi.waitFor(() => { expect(q.data.value).toHaveLength(1); });
    q.dispose();
  });
});
