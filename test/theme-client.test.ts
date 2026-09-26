import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  themeModeSignal,
  systemPrefersDarkSignal,
  resolvedThemeSignal,
  setThemeMode,
  initThemeState,
  getStoredThemeMode,
  setStoredThemeMode,
  type ThemeMode,
} from '../src/client/state/theme-state.ts';

describe('Tema UI (Claro / Oscuro / Heredado) - Client State & Signals', () => {
  let mockStorage: Record<string, string> = {};
  let mockClassList: Set<string> = new Set();
  let mediaQueryListeners: Array<(e: { matches: boolean }) => void> = [];
  let currentSystemMatches = false;

  beforeEach(() => {
    mockStorage = {};
    mockClassList = new Set();
    mediaQueryListeners = [];
    currentSystemMatches = false;

    // Simular localStorage
    const storageMock = {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, val: string) => {
        mockStorage[key] = val;
      },
      removeItem: (key: string) => {
        delete mockStorage[key];
      },
      clear: () => {
        mockStorage = {};
      },
      length: 0,
      key: () => null,
    };

    // Simular document.documentElement
    const docElementMock = {
      classList: {
        add: (cls: string) => mockClassList.add(cls),
        remove: (cls: string) => mockClassList.delete(cls),
        contains: (cls: string) => mockClassList.has(cls),
      },
      style: {
        colorScheme: '',
      },
    };

    // Simular matchMedia
    const matchMediaMock = vi.fn().mockImplementation((query: string) => ({
      matches: currentSystemMatches,
      media: query,
      onchange: null,
      addListener: (fn: (e: { matches: boolean }) => void) => mediaQueryListeners.push(fn),
      removeListener: vi.fn(),
      addEventListener: (type: string, fn: (e: { matches: boolean }) => void) => {
        if (type === 'change') mediaQueryListeners.push(fn);
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    vi.stubGlobal('localStorage', storageMock);
    vi.stubGlobal('window', {
      localStorage: storageMock,
      matchMedia: matchMediaMock,
    });
    vi.stubGlobal('document', {
      documentElement: docElementMock,
    });

    // Reset state
    themeModeSignal.value = 'system';
    systemPrefersDarkSignal.value = false;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('permite persistir y recuperar el modo de tema en localStorage', () => {
    expect(getStoredThemeMode()).toBeNull();
    setStoredThemeMode('dark');
    expect(getStoredThemeMode()).toBe('dark');
    setStoredThemeMode('light');
    expect(getStoredThemeMode()).toBe('light');
    setStoredThemeMode('system');
    expect(getStoredThemeMode()).toBe('system');
  });

  it('resuelve el tema basado en preferencia de sistema cuando el modo es "system"', () => {
    themeModeSignal.value = 'system';

    systemPrefersDarkSignal.value = false;
    expect(resolvedThemeSignal.value).toBe('light');

    systemPrefersDarkSignal.value = true;
    expect(resolvedThemeSignal.value).toBe('dark');
  });

  it('setThemeMode("light") fija modo explícito claro, persiste y actualiza DOM', () => {
    setThemeMode('light');
    expect(themeModeSignal.value).toBe('light');
    expect(resolvedThemeSignal.value).toBe('light');
    expect(getStoredThemeMode()).toBe('light');
    expect(mockClassList.has('dark')).toBe(false);
    expect(mockClassList.has('light')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('light');
  });

  it('setThemeMode("dark") fija modo explícito oscuro, persiste y actualiza DOM', () => {
    setThemeMode('dark');
    expect(themeModeSignal.value).toBe('dark');
    expect(resolvedThemeSignal.value).toBe('dark');
    expect(getStoredThemeMode()).toBe('dark');
    expect(mockClassList.has('dark')).toBe(true);
    expect(mockClassList.has('light')).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('setThemeMode("system") sincroniza con el sistema operativo y reacciona a cambios', () => {
    currentSystemMatches = true; // Sistema en modo oscuro
    const cleanup = initThemeState();

    setThemeMode('system');
    expect(themeModeSignal.value).toBe('system');
    expect(resolvedThemeSignal.value).toBe('dark');
    expect(mockClassList.has('dark')).toBe(true);

    // Simular que el sistema operativo cambia a modo claro
    mediaQueryListeners.forEach((fn) => fn({ matches: false }));
    expect(systemPrefersDarkSignal.value).toBe(false);
    expect(resolvedThemeSignal.value).toBe('light');
    expect(mockClassList.has('dark')).toBe(false);
    expect(mockClassList.has('light')).toBe(true);

    cleanup();
  });
});
