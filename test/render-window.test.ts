import { describe, it, expect } from 'vitest';
import { signal } from '@preact/signals';
import { createRenderWindow } from '../src/client/state/render-window.ts';

describe('Render por tramos de las listas limitadas (#87)', () => {
  const items = signal(Array.from({ length: 250 }, (_, i) => i));

  it('dibuja de a 100 y suma 100 por vez', () => {
    const filters = signal({ q: '' });
    const w = createRenderWindow(items, filters, 100);
    expect(w.visible.value).toHaveLength(100);
    expect(w.hasMore.value).toBe(true);
    w.showMore();
    expect(w.visible.value).toHaveLength(200);
    w.showMore();
    expect(w.visible.value).toHaveLength(250);
    expect(w.hasMore.value).toBe(false);
  });

  it('un cambio de filtros vuelve a los primeros 100', () => {
    const filters = signal({ q: '' });
    const w = createRenderWindow(items, filters, 100);
    w.showMore();
    expect(w.visible.value).toHaveLength(200);
    filters.value = { q: 'coca' };
    expect(w.visible.value).toHaveLength(100);
    w.showMore();
    expect(w.visible.value).toHaveLength(200);
  });
});
