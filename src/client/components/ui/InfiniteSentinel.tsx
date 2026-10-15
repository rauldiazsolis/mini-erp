import { Component, createRef } from 'preact';
import { formatQty } from '../../format.ts';
import { Button } from './Button.tsx';

export type InfiniteSentinelProps = {
  /** Las filas que ya se ven. */
  shown: number;
  /** El total del filtro, si se sabe. */
  total?: number | undefined;
  hasMore: boolean;
  loading?: boolean | undefined;
  onMore: () => void | Promise<void>;
};

/** Cuánto antes del final se pide el tramo siguiente: así casi nunca se ve el "Cargando". */
const AHEAD = '400px';

/**
 * El final de una lista por tramos (#87): al acercarse a la vista pide el tramo siguiente solo. Es
 * también un botón "Cargar más", para el teclado, un lector de pantalla o un navegador sin
 * `IntersectionObserver`. De clase, sin hooks.
 */
export class InfiniteSentinel extends Component<InfiniteSentinelProps> {
  private ref = createRef<HTMLDivElement>();
  private observer: IntersectionObserver | null = null;

  override componentDidMount(): void {
    const el = this.ref.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && this.props.hasMore && this.props.loading !== true) void this.props.onMore();
      },
      { rootMargin: AHEAD },
    );
    this.observer.observe(el);
  }

  override componentDidUpdate(previous: InfiniteSentinelProps): void {
    // Un tramo corto puede dejar el final todavía a la vista: el observer no avisa dos veces, se vuelve a mirar
    const el = this.ref.current;
    if (this.observer !== null && el !== null && previous.loading === true && this.props.loading !== true) {
      this.observer.unobserve(el);
      this.observer.observe(el);
    }
  }

  override componentWillUnmount(): void {
    this.observer?.disconnect();
    this.observer = null;
  }

  override render() {
    const { shown, total, hasMore, loading } = this.props;
    if (shown === 0) return null;
    return (
      <div ref={this.ref} class="flex items-center justify-between gap-3 px-4 py-3 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400">
        <span>{total === undefined ? `${formatQty(shown)} filas` : `Mostrando ${formatQty(shown)} de ${formatQty(total)}`}</span>
        {hasMore && (
          <Button size="sm" variant="secondary" loading={loading === true} onClick={() => { void this.props.onMore(); }}>
            Cargar más
          </Button>
        )}
      </div>
    );
  }
}
