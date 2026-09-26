import type { ComponentChildren, JSX } from 'preact';

export type SelectProps = Omit<JSX.IntrinsicElements['select'], 'class' | 'className'> & {
  class?: string;
  className?: string;
  label?: string;
  error?: string | null;
  helperText?: string;
  children: ComponentChildren;
};

export function Select(props: SelectProps) {
  const { label, error, helperText, class: className = '', id, children, ...rest } = props;
  const selectId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);
  const extraClass = className ? ` ${className}` : '';

  return (
    <div class="w-full space-y-1.5 text-left">
      {label && (
        <label for={selectId} class="block text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <select
        id={selectId}
        class={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border ${
          error
            ? 'border-rose-500 focus:ring-rose-500'
            : 'border-slate-300 dark:border-slate-800 focus:border-indigo-500 focus:ring-indigo-500'
        } rounded-xl text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-slate-950 transition-all cursor-pointer${extraClass}`}
        {...rest}
      >
        {children}
      </select>
      {error && <p class="text-xs text-rose-500 dark:text-rose-400 font-medium">{error}</p>}
      {!error && helperText && <p class="text-xs text-slate-500 dark:text-slate-400">{helperText}</p>}
    </div>
  );
}
