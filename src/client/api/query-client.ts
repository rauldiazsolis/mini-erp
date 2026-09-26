import { QueryClient, QueryObserver, type QueryKey } from '@tanstack/query-core';
import { signal, type Signal } from '@preact/signals';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      retry: 1,
    },
  },
});

export type SignalQueryResult<T> = {
  data: Signal<T | undefined>;
  isLoading: Signal<boolean>;
  isError: Signal<boolean>;
  error: Signal<Error | null>;
  refetch: () => Promise<void>;
  unsubscribe: () => void;
};

export type SignalQueryOptions<T> = {
  queryKey: QueryKey;
  queryFn: () => Promise<T>;
  enabled?: boolean;
};

export function createSignalQuery<T>(options: SignalQueryOptions<T>): SignalQueryResult<T> {
  const data = signal<T | undefined>(undefined);
  const isLoading = signal(options.enabled !== false);
  const isError = signal(false);
  const error = signal<Error | null>(null);

  const observer = new QueryObserver(queryClient, {
    queryKey: options.queryKey,
    queryFn: options.queryFn,
    enabled: options.enabled ?? true,
  });

  const unsubscribe = observer.subscribe((result) => {
    data.value = result.data;
    isLoading.value = result.isLoading;
    isError.value = result.isError;
    error.value = (result.error) ?? null;
  });

  const refetch = async (): Promise<void> => {
    isLoading.value = true;
    await observer.refetch();
  };

  return {
    data,
    isLoading,
    isError,
    error,
    refetch,
    unsubscribe,
  };
}
