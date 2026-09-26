import type { ComponentChildren } from 'preact';

export type PageHeaderProps = {
  title: string;
  badge?: string;
  description?: ComponentChildren;
  subtitle?: ComponentChildren;
  children?: ComponentChildren;
};

export function PageHeader(props: PageHeaderProps) {
  const desc = props.subtitle ?? props.description;
  return (
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
      <div>
        <h1 class="text-2xl font-black text-slate-900 dark:text-white tracking-tight flex items-center gap-2.5">
          <span>{props.title}</span>
          {props.badge && (
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider">
              {props.badge}
            </span>
          )}
        </h1>
        {desc && (
          <div class="text-xs text-slate-500 dark:text-slate-400 mt-1 leading-relaxed">
            {desc}
          </div>
        )}
      </div>
      {props.children && (
        <div class="flex items-center gap-2.5 shrink-0">
          {props.children}
        </div>
      )}
    </div>
  );
}
