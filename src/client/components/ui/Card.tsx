import type { ComponentChildren, HTMLAttributes } from 'preact';

export type CardProps = Omit<HTMLAttributes<HTMLDivElement>, 'class' | 'className'> & {
  class?: string;
  className?: string;
  children: ComponentChildren;
};

export function Card(props: CardProps) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <div
      class={`bg-white dark:bg-slate-900/80 backdrop-blur border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm dark:shadow-xl p-6 transition-colors${extraClass}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader(props: { title: string; description?: string; children?: ComponentChildren }) {
  return (
    <div class="mb-5">
      <div class="flex items-center justify-between">
        <h3 class="text-lg font-semibold text-slate-900 dark:text-slate-100 tracking-tight">{props.title}</h3>
        {props.children}
      </div>
      {props.description && <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">{props.description}</p>}
    </div>
  );
}
