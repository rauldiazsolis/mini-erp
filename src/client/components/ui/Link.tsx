import type { JSX, TargetedMouseEvent } from 'preact';
import { navigate } from '../../state/route-state.ts';

type ClickLike = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean };

/** Solo el clic izquierdo sin teclas navega dentro del SPA; con Ctrl, Cmd o la rueda se abre otra pestaña. */
export function isPlainLeftClick(e: ClickLike): boolean {
  return !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
}

type LinkProps = Omit<JSX.IntrinsicElements['a'], 'href' | 'onClick'> & { href: string; onNavigate?: (() => void) | undefined };

/** Un link del SPA (#59): un `<a>` de verdad, que navega sin recargar. */
export function Link({ href, onNavigate, ...rest }: LinkProps) {
  const handleClick = (e: TargetedMouseEvent<HTMLAnchorElement>) => {
    if (!isPlainLeftClick(e)) return;
    e.preventDefault();
    navigate(href);
    onNavigate?.();
  };
  return <a {...rest} href={href} onClick={handleClick} />;
}
