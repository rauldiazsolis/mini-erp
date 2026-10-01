import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { Logo } from '../ui/Logo.tsx';
import { versionLabel } from '../../state/app-version.ts';
import { POS_VERSION, buildDemoUrl, posBaseUrl, publishedPosOrigin } from '../../state/demo-link.ts';

/**
 * Landing en la raíz (#9, #18): le habla al comerciante y abre el POS en demo contra este backend. En
 * desarrollo, la copia local del POS publicado que sirve este backend; en producción, el POS
 * publicado (`VITE_POS_URL`, #11).
 */
export function LandingView() {
  const origin = typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
  const useLocalCopy = import.meta.env.DEV;
  const posOrigin = publishedPosOrigin(import.meta.env.VITE_POS_URL);
  const demoUrl = buildDemoUrl(posBaseUrl(POS_VERSION, origin, useLocalCopy, posOrigin), origin);

  return (
    <div class="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header class="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div class="flex items-center gap-2.5">
          <Logo class="w-8 h-8" />
          <span class="font-bold tracking-tight">mini contax</span>
        </div>
        <div class="flex items-center gap-3">
          <ThemeToggle compact />
          <a href="/admin" class="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            Entrar
          </a>
        </div>
      </header>
      <main class="flex-1 flex items-center justify-center px-4 py-12">
        <div class="max-w-xl text-center space-y-6">
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">
            Tu comercio, con un POS que vende aunque se corte internet
          </h1>
          <p class="text-slate-600 dark:text-slate-400">
            Caja, catálogo, stock, clientes y cuentas corrientes en un solo lugar. El punto de venta sigue
            vendiendo sin internet y mini contax ordena todo cuando vuelve la conexión. Probalo con un
            comercio de ejemplo, sin registrarte.
          </p>
          <a
            href={demoUrl}
            class="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/25"
          >
            Probar la demo
          </a>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {useLocalCopy
              ? `Abre una copia local del POS ${POS_VERSION} publicado, servida por este backend.`
              : 'Se abre el punto de venta con un comercio de ejemplo.'}
          </p>
        </div>
      </main>
      <footer class="px-4 py-6 text-center text-xs text-slate-500 dark:text-slate-400">
        {versionLabel()} · powered by{' '}
        <a
          href="https://github.com/rauldiazsolis/offline-pos"
          class="hover:text-slate-700 dark:hover:text-slate-200 underline-offset-2 hover:underline"
        >
          offline-pos
        </a>
      </footer>
    </div>
  );
}
