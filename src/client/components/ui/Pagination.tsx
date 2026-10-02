import { Button } from './Button.tsx';

export type PaginationProps = { page: number; pageSize: number; count: number; onPage: (page: number) => void };

export function Pagination(props: PaginationProps) {
  const first = props.count === 0 ? 0 : (props.page - 1) * props.pageSize + 1;
  const last = Math.min(props.page * props.pageSize, props.count);
  return (
    <div class="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
      <span>
        {first}–{last} de {props.count}
      </span>
      <div class="flex gap-2">
        <Button size="sm" variant="secondary" disabled={props.page <= 1} onClick={() => { props.onPage(props.page - 1); }}>
          Anterior
        </Button>
        <Button size="sm" variant="secondary" disabled={last >= props.count} onClick={() => { props.onPage(props.page + 1); }}>
          Siguiente
        </Button>
      </div>
    </div>
  );
}
