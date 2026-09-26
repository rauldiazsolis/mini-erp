import { toastsSignal, dismissToast, type ToastType } from '../../state/toast-state.ts';

export function ToastContainer() {
  const toasts = toastsSignal.value;
  if (toasts.length === 0) return null;

  const typeStyles: Record<ToastType, { border: string; bg: string; iconBg: string; text: string }> = {
    success: {
      border: 'border-emerald-500/30',
      bg: 'bg-emerald-950/90',
      iconBg: 'text-emerald-400',
      text: 'text-emerald-200',
    },
    error: {
      border: 'border-rose-500/30',
      bg: 'bg-rose-950/90',
      iconBg: 'text-rose-400',
      text: 'text-rose-200',
    },
    warning: {
      border: 'border-amber-500/30',
      bg: 'bg-amber-950/90',
      iconBg: 'text-amber-400',
      text: 'text-amber-200',
    },
    info: {
      border: 'border-indigo-500/30',
      bg: 'bg-indigo-950/90',
      iconBg: 'text-indigo-400',
      text: 'text-indigo-200',
    },
  };

  return (
    <div class="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none p-2">
      {toasts.map((toast) => {
        const style = typeStyles[toast.type];
        return (
          <div
            key={toast.id}
            class={`pointer-events-auto flex items-start gap-3 p-4 rounded-xl border ${style.border} ${style.bg} backdrop-blur shadow-2xl transition-all duration-200`}
          >
            <div class={`mt-0.5 ${style.iconBg}`}>
              {toast.type === 'success' && (
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
                </svg>
              )}
              {toast.type === 'error' && (
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              )}
              {toast.type === 'warning' && (
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
              )}
              {toast.type === 'info' && (
                <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              )}
            </div>

            <div class="flex-1">
              <h4 class="text-sm font-semibold text-white">{toast.title}</h4>
              {toast.message && <p class={`text-xs mt-0.5 ${style.text}`}>{toast.message}</p>}
            </div>

            <button
              type="button"
              onClick={() => { dismissToast(toast.id); }}
              class="text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
