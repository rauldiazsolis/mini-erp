import { describe, it, expect } from 'vitest';
import type { VNode } from 'preact';
import { PlatformActionsBar } from '../src/client/components/credits/PlatformActionsBar.tsx';
import { Card } from '../src/client/components/ui/Card.tsx';

type AnyNode = VNode<{ children?: unknown }>;

function isNode(x: unknown): x is AnyNode {
  return typeof x === 'object' && x !== null && 'type' in x && 'props' in x;
}

function children(node: AnyNode): AnyNode[] {
  const c = node.props.children;
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter(isNode);
}

function typeName(node: AnyNode): string {
  return typeof node.type === 'function' ? node.type.name : node.type;
}

/** Dice si hay un nodo `name` debajo de algÃºn `Card` del Ã¡rbol. */
function insideCard(node: AnyNode, name: string, underCard = false): boolean {
  if (typeName(node) === name) return underCard;
  const nowUnder = underCard || node.type === Card;
  return children(node).some((child) => insideCard(child, name, nowUnder));
}

function contains(node: AnyNode, name: string): boolean {
  return typeName(node) === name || children(node).some((child) => contains(child, name));
}

describe('Acciones de plataforma', () => {
  // El Card tiene backdrop-blur: un `fixed` adentro se mide contra la tarjeta, no contra la ventana
  it('el modal de las acciones queda fuera del Card', () => {
    const tree = PlatformActionsBar();
    if (!isNode(tree)) throw new Error('PlatformActionsBar no devolviÃ³ un VNode');
    expect(contains(tree, 'ActionModal')).toBe(true);
    expect(insideCard(tree, 'ActionModal')).toBe(false);
  });
});
