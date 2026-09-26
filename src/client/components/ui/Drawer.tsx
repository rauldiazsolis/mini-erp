import type { ComponentChildren } from 'preact';

export type DrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ComponentChildren;
  maxWidth?: string;
  children: ComponentChildren;
};

export function Drawer(props: DrawerProps) {
  if (!props.isOpen) return null;

  return (
    <div
      class="fixed inset-0 bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm z-50 flex justify-end animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div
        class={`w-full ${props.maxWidth ?? 'max-w-2xl'} bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-800 shadow-2xl flex flex-col h-full animate-in slide-in-from-right duration-200 text-slate-900 dark:text-slate-100`}
      >
        {/* Cabecera del Drawer */}
        <div class="p-6 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div class="flex items-center gap-3">
            {props.icon && (
              <div class="p-2.5 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-slate-700 shrink-0">
                {props.icon}
              </div>
            )}
            <div>
              <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                {props.title}
              </h3>
              {props.subtitle && (
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {props.subtitle}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={props.onClose}
            aria-label="Cerrar panel"
            class="p-2 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Cuerpo con scroll independiente */}
        <div class="flex-1 overflow-y-auto p-6 space-y-6">
          {props.children}
        </div>
      </div>
    </div>
  );
}
