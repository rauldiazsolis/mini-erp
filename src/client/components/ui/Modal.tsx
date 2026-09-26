import type { ComponentChildren } from 'preact';

export type ModalProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: ComponentChildren;
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl';
  footer?: ComponentChildren;
  children: ComponentChildren;
};

const maxWidthClasses = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
};

export function Modal(props: ModalProps) {
  if (!props.isOpen) return null;

  const maxWidthClass = maxWidthClasses[props.maxWidth ?? 'lg'];

  return (
    <div
      class="fixed inset-0 bg-slate-950/60 dark:bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          props.onClose();
        }
      }}
    >
      <div
        class={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 ${maxWidthClass} w-full shadow-2xl transition-all relative text-slate-900 dark:text-slate-100 my-auto`}
      >
        {/* Cabecera del Modal */}
        <div class="flex items-start justify-between gap-3 mb-6">
          <div class="flex items-center gap-3">
            {props.icon && (
              <div class="p-2.5 rounded-2xl bg-indigo-50 dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-slate-700/80 shrink-0">
                {props.icon}
              </div>
            )}
            <div>
              <h3 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight leading-snug">
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
            aria-label="Cerrar modal"
            class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Contenido */}
        {props.children}

        {/* Footer si existe */}
        {props.footer && (
          <div class="mt-6 pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
            {props.footer}
          </div>
        )}
      </div>
    </div>
  );
}
