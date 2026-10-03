import type { ComponentChildren, HTMLAttributes } from 'preact';

export type StatCardProps = {
  title: string;
  value: string | number;
  subtitle?: ComponentChildren;
  icon?: ComponentChildren;
  variant?: 'default' | 'primary' | 'warning' | 'success' | 'danger';
  /** Drill-down (#20): con `onClick`, la tarjeta es un botón que lleva al detalle. */
  onClick?: (() => void) | undefined;
};

export function StatCard(props: StatCardProps) {
  const { title, value, subtitle, icon, variant = 'default', onClick } = props;
  const clickable: HTMLAttributes<HTMLDivElement> =
    onClick === undefined
      ? {}
      : {
          role: 'button',
          tabIndex: 0,
          title: 'Ver el detalle',
          onClick,
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onClick();
            }
          },
        };

  const variantBorder = {
    default: 'border-slate-200 dark:border-slate-800',
    primary: 'border-indigo-200 dark:border-indigo-900/60',
    warning: 'border-amber-200 dark:border-amber-900/60',
    success: 'border-emerald-200 dark:border-emerald-900/60',
    danger: 'border-rose-200 dark:border-rose-900/60',
  }[variant];

  return (
    <div
      class={`bg-white dark:bg-slate-900/80 backdrop-blur border ${variantBorder} rounded-2xl p-5 shadow-sm dark:shadow-xl transition-all flex flex-col justify-between${
        onClick === undefined ? '' : ' cursor-pointer hover:ring-2 hover:ring-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500'
      }`}
      {...clickable}
    >
      <div class="flex items-center justify-between gap-2 mb-3">
        <span class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
          {title}
        </span>
        {icon && (
          <div class="p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-100 dark:border-slate-700/60 text-slate-600 dark:text-slate-300 shrink-0">
            {icon}
          </div>
        )}
      </div>

      <div>
        <div class="text-2xl sm:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          {value}
        </div>
        {subtitle && (
          <div class="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {subtitle}
          </div>
        )}
      </div>
    </div>
  );
}
