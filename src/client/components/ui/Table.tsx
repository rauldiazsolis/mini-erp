import type { ComponentChildren, JSX } from 'preact';

export function TableContainer(props: JSX.HTMLAttributes<HTMLDivElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <div
      class={`w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm dark:shadow-xl overflow-hidden transition-colors ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Table(props: JSX.HTMLAttributes<HTMLTableElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <div class="overflow-x-auto">
      <table class={`w-full text-left border-collapse ${className}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Thead(props: JSX.HTMLAttributes<HTMLTableSectionElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <thead
      class={`bg-slate-50 dark:bg-slate-950/80 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-slate-800 ${className}`}
      {...rest}
    >
      {children}
    </thead>
  );
}

export function Tbody(props: JSX.HTMLAttributes<HTMLTableSectionElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <tbody class={`divide-y divide-slate-200 dark:divide-slate-800/60 ${className}`} {...rest}>
      {children}
    </tbody>
  );
}

export function Tr(props: JSX.HTMLAttributes<HTMLTableRowElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <tr class={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors ${className}`} {...rest}>
      {children}
    </tr>
  );
}

export function Th(props: JSX.HTMLAttributes<HTMLTableCellElement> & { children?: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <th class={`px-4 py-3 font-semibold ${className}`} {...rest}>
      {children}
    </th>
  );
}

export function Td(props: JSX.HTMLAttributes<HTMLTableCellElement> & { children?: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <td class={`px-4 py-3.5 text-xs text-slate-700 dark:text-slate-300 ${className}`} {...rest}>
      {children}
    </td>
  );
}

export function TableEmptyState(props: { icon?: string; message: string; submessage?: string }) {
  return (
    <div class="py-16 text-center text-slate-500 dark:text-slate-400 space-y-2">
      <div class="text-3xl">{props.icon ?? '🔍'}</div>
      <div class="text-sm font-semibold text-slate-700 dark:text-slate-300">{props.message}</div>
      {props.submessage && <div class="text-xs text-slate-400">{props.submessage}</div>}
    </div>
  );
}
