import type { ComponentChildren, JSX } from 'preact';

export function Card(props: JSX.HTMLAttributes<HTMLDivElement> & { children: ComponentChildren }) {
  const { class: className = '', children, ...rest } = props;
  return (
    <div
      class={`bg-slate-900/80 backdrop-blur border border-slate-800 rounded-2xl shadow-xl p-6 ${className}`}
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
        <h3 class="text-lg font-semibold text-slate-100 tracking-tight">{props.title}</h3>
        {props.children}
      </div>
      {props.description && <p class="text-xs text-slate-400 mt-1">{props.description}</p>}
    </div>
  );
}
