import { signal } from '@preact/signals';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export type ToastItem = {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  durationMs?: number;
};

export const toastsSignal = signal<ToastItem[]>([]);

export function showToast(toast: Omit<ToastItem, 'id'>): string {
  const id = `toast_${String(Date.now())}_${Math.random().toString(36).substring(2, 7)}`;
  const item: ToastItem = {
    ...toast,
    id,
  };

  toastsSignal.value = [...toastsSignal.value, item];

  const duration = toast.durationMs ?? 4000;
  if (duration > 0) {
    setTimeout(() => {
      dismissToast(id);
    }, duration);
  }

  return id;
}

export function dismissToast(id: string): void {
  toastsSignal.value = toastsSignal.value.filter((t) => t.id !== id);
}
