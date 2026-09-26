import type { ComponentChildren, JSX } from 'preact';

export function FilterToolbar(props: JSX.HTMLAttributes<HTMLDivElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <div
      class={`bg-white dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm dark:shadow-xl space-y-4 transition-colors ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}
