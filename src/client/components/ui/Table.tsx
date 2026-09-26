import type { ComponentChildren, HTMLAttributes } from 'preact';

type BaseProps<T extends HTMLElement> = Omit<HTMLAttributes<T>, 'class' | 'className'> & {
  class?: string;
  className?: string;
  children?: ComponentChildren;
};

export function TableContainer(props: BaseProps<HTMLDivElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <div
      class={`w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-sm dark:shadow-xl overflow-hidden transition-colors${extraClass}`}
      {...rest}
    >
      {children}
    </div>
  );
}

export function Table(props: BaseProps<HTMLTableElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <div class="overflow-x-auto">
      <table class={`w-full text-left border-collapse${extraClass}`} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function Thead(props: BaseProps<HTMLTableSectionElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <thead
      class={`bg-slate-50 dark:bg-slate-950/80 text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-200 dark:border-slate-800${extraClass}`}
      {...rest}
    >
      {children}
    </thead>
  );
}

export function Tbody(props: BaseProps<HTMLTableSectionElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <tbody class={`divide-y divide-slate-200 dark:divide-slate-800/60${extraClass}`} {...rest}>
      {children}
    </tbody>
  );
}

export function Tr(props: BaseProps<HTMLTableRowElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <tr class={`hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors${extraClass}`} {...rest}>
      {children}
    </tr>
  );
}

export function Th(props: BaseProps<HTMLTableCellElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <th class={`px-4 py-3 font-semibold${extraClass}`} {...rest}>
      {children}
    </th>
  );
}

export function Td(props: BaseProps<HTMLTableCellElement>) {
  const { class: className = '', children, ...rest } = props;
  const extraClass = className ? ` ${className}` : '';
  return (
    <td class={`px-4 py-3.5 text-xs text-slate-700 dark:text-slate-300${extraClass}`} {...rest}>
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
