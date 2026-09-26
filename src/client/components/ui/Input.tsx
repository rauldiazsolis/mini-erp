import type { JSX } from 'preact';

export type InputProps = JSX.IntrinsicElements['input'] & {
  label?: string;
  error?: string | null;
  helperText?: string;
};

export function Input(props: InputProps) {
  const { label, error, helperText, class: className = '', id, ...rest } = props;
  const inputId = id ?? (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

  return (
    <div class="w-full space-y-1.5 text-left">
      {label && (
        <label for={inputId} class="block text-xs font-medium text-slate-700 dark:text-slate-300">
          {label}
        </label>
      )}
      <input
        id={inputId}
        class={`w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border ${
          error
            ? 'border-rose-500 focus:ring-rose-500'
            : 'border-slate-300 dark:border-slate-800 focus:border-indigo-500 focus:ring-indigo-500'
        } rounded-xl text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-offset-white dark:focus:ring-offset-slate-950 transition-all ${className}`}
        {...rest}
      />
      {error && <p class="text-xs text-rose-500 dark:text-rose-400 font-medium">{error}</p>}
      {!error && helperText && <p class="text-xs text-slate-500 dark:text-slate-400">{helperText}</p>}
    </div>
  );
}
