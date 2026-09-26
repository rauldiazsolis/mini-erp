import { signal, computed } from '@preact/signals';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'mini_erp_theme_mode';

function getStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined') {
      return window.localStorage;
    }
  } catch {
    // Entorno sin acceso a localStorage
  }
  return null;
}

export function getStoredThemeMode(): ThemeMode | null {
  const val = getStorage()?.getItem(THEME_STORAGE_KEY);
  if (val === 'light' || val === 'dark' || val === 'system') {
    return val;
  }
  return null;
}

export function setStoredThemeMode(mode: ThemeMode): void {
  const s = getStorage();
  if (s) {
    s.setItem(THEME_STORAGE_KEY, mode);
  }
}

export function getSystemDarkPreference(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }
  return false;
}

// Signals de estado
export const themeModeSignal = signal<ThemeMode>(getStoredThemeMode() ?? 'system');
export const systemPrefersDarkSignal = signal<boolean>(getSystemDarkPreference());

export const resolvedThemeSignal = computed<ResolvedTheme>(() => {
  const mode = themeModeSignal.value;
  if (mode === 'system') {
    return systemPrefersDarkSignal.value ? 'dark' : 'light';
  }
  return mode;
});

export function applyThemeToDocument(theme: ResolvedTheme): void {
  if (typeof document === 'undefined') {
    return;
  }

  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
    root.classList.remove('light');
    root.style.colorScheme = 'dark';
  } else {
    root.classList.remove('dark');
    root.classList.add('light');
    root.style.colorScheme = 'light';
  }
}

export function setThemeMode(mode: ThemeMode): void {
  themeModeSignal.value = mode;
  setStoredThemeMode(mode);
  applyThemeToDocument(resolvedThemeSignal.value);
}

export function initThemeState(): () => void {
  // Aplicar tema inicial inmediatamente
  applyThemeToDocument(resolvedThemeSignal.value);

  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  systemPrefersDarkSignal.value = mediaQuery.matches;

  const handleChange = (e: { matches: boolean }) => {
    systemPrefersDarkSignal.value = e.matches;
    if (themeModeSignal.value === 'system') {
      applyThemeToDocument(e.matches ? 'dark' : 'light');
    }
  };

  mediaQuery.addEventListener('change', handleChange);

  return () => {
    mediaQuery.removeEventListener('change', handleChange);
  };
}

// Auto-inicializar si estamos en entorno navegador
if (typeof window !== 'undefined') {
  initThemeState();
}
