import type { ComponentChildren, HTMLAttributes } from 'preact';

export type FilterToolbarProps = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'className'> & {
  class?: string;
  className?: string;
  children: ComponentChildren;
};

export function FilterToolbar(props: FilterToolbarProps) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <div
      class={`bg-white dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-2xl p-4 sm:p-5 shadow-sm dark:shadow-xl space-y-4 transition-colors${extraClass}`}
      {...rest}
    >
      {children}
    </div>
  );
}
