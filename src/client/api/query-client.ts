import { QueryClient, QueryObserver, notifyManager, type QueryKey, type QueryObserverResult } from '@tanstack/query-core';
import { effect, signal, type ReadonlySignal } from '@preact/signals';
import { ApiError } from './client.ts';

// Las novedades de la caché llegan en el momento: los signals se actualizan sin esperar un tick (#59)
notifyManager.setScheduler((callback) => {
  callback();
});

/** Un 4xx no se arregla reintentando; un error de red o un 5xx, una vez. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status < 500) return false;
  return failureCount < 1;
}

/** Caché al toque y refresco en segundo plano: al entrar a una pantalla y al volver a la pestaña (#59). */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 0, refetchOnWindowFocus: true, retry: shouldRetry },
  },
});

export type QuerySource<T> = { key: QueryKey; fn: () => Promise<T> };

export type SignalQueryOptions<T> = {
  /** La clave y el pedido; `null` sin sesión o sin comercio. Reactiva. */
  source: () => QuerySource<T> | null;
  /** Si la pantalla que la usa está activa. Reactiva. Deshabilitada, igual ve la caché de su clave. */
  enabled?: (() => boolean) | undefined;
  refetchInterval?: number | undefined;
  /** Si al cambiar de clave se sigue viendo el dato anterior mientras llega el nuevo. */
  keepPrevious?: ((previousKey: QueryKey, nextKey: QueryKey) => boolean) | undefined;
  onError?: ((error: Error) => void) | undefined;
};

export type SignalQuery<T> = {
  data: ReadonlySignal<T | undefined>;
  /** La primera carga, sin datos: el "Cargando" de las pantallas. */
  isLoading: ReadonlySignal<boolean>;
  error: ReadonlySignal<Error | null>;
  refetch: () => Promise<void>;
  setData: (update: (previous: T | undefined) => T | undefined) => void;
  dispose: () => void;
};

const IDLE_KEY: QueryKey = ['idle'];

/** Una consulta de TanStack Query expuesta como signals, sin hooks (#59). */
export function createSignalQuery<T>(options: SignalQueryOptions<T>): SignalQuery<T> {
  const data = signal<T | undefined>(undefined);
  const isLoading = signal(false);
  const error = signal<Error | null>(null);
  let key: QueryKey | null = null;
  let lastError: Error | null = null;

  const observer = new QueryObserver<T, Error>(queryClient, { queryKey: IDLE_KEY, enabled: false });

  const publish = (result: QueryObserverResult<T>): void => {
    data.value = key === null ? undefined : result.data;
    isLoading.value = key !== null && result.isLoading;
    error.value = key === null ? null : result.error;
    if (key !== null && result.error !== null && result.error !== lastError) {
      lastError = result.error;
      options.onError?.(result.error);
    }
  };

  const unsubscribe = observer.subscribe(publish);

  const stop = effect(() => {
    const source = options.source();
    const enabled = source !== null && (options.enabled?.() ?? true);
    key = source?.key ?? null;
    observer.setOptions({
      queryKey: source?.key ?? IDLE_KEY,
      queryFn: source?.fn ?? (() => Promise.reject(new Error('Consulta deshabilitada'))),
      enabled,
      refetchInterval: options.refetchInterval ?? false,
      placeholderData: (previous, previousQuery) =>
        source !== null && previousQuery !== undefined && options.keepPrevious?.(previousQuery.queryKey, source.key) === true ? previous : undefined,
    });
    publish(observer.getCurrentResult());
  });

  return {
    data,
    isLoading,
    error,
    refetch: async () => {
      if (key !== null) await observer.refetch();
    },
    setData: (update) => {
      if (key !== null) queryClient.setQueryData<T>(key, update);
    },
    dispose: () => {
      stop();
      unsubscribe();
    },
  };
}
