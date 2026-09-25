import { describe, it, expect, beforeEach } from 'vitest';
import { signal, computed, effect } from '@preact/signals';
import { QueryClient } from '@tanstack/query-core';
import { counterSignal, doubleCounterSignal, appTitleSignal } from '../src/client/App.tsx';

describe('Frontend Client Scaffolding & Signal Reactivity', () => {
  beforeEach(() => {
    counterSignal.value = 0;
  });

  it('debe tener título de app configurado', () => {
    expect(appTitleSignal.value).toBe('Mini-ERP Admin');
  });

  it('debe actualizar señales y computados sin React hooks', () => {
    expect(counterSignal.value).toBe(0);
    expect(doubleCounterSignal.value).toBe(0);

    counterSignal.value = 5;
    expect(counterSignal.value).toBe(5);
    expect(doubleCounterSignal.value).toBe(10);

    counterSignal.value = 12;
    expect(doubleCounterSignal.value).toBe(24);
  });

  it('debe registrar efectos reactivos ante mutaciones de señales', () => {
    const history: number[] = [];
    const dispose = effect(() => {
      history.push(counterSignal.value);
    });

    counterSignal.value = 1;
    counterSignal.value = 2;
    counterSignal.value = 3;

    dispose();
    counterSignal.value = 4;

    expect(history).toEqual([0, 1, 2, 3]);
  });

  it('debe integrar TanStack Query Core con signals reactivas', async () => {
    const queryClient = new QueryClient();
    const dataSignal = signal<string | null>(null);
    const loadingSignal = signal(true);

    const fetchData = async () => {
      loadingSignal.value = true;
      const res = await queryClient.fetchQuery({
        queryKey: ['test-key'],
        queryFn: async () => 'test-payload',
      });
      dataSignal.value = res;
      loadingSignal.value = false;
    };

    await fetchData();

    expect(loadingSignal.value).toBe(false);
    expect(dataSignal.value).toBe('test-payload');
  });
});
