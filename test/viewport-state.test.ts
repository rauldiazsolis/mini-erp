import { describe, it, expect } from 'vitest';
import { createPhoneSignal } from '../src/client/state/viewport-state.ts';

type Listener = (e: { matches: boolean }) => void;

describe('Teléfono o escritorio (#89)', () => {
  it('sigue a la media query y cambia al rotar o achicar la ventana', () => {
    let listener: Listener = () => undefined;
    const mql = { matches: true, addEventListener: (_: 'change', l: Listener) => { listener = l; } };
    const phone = createPhoneSignal(() => mql);
    expect(phone.value).toBe(true);
    listener({ matches: false });
    expect(phone.value).toBe(false);
  });

  it('sin matchMedia (tests, servidor) es escritorio', () => {
    expect(createPhoneSignal(() => null).value).toBe(false);
  });
});
