import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { POS_VERSION, buildDemoUrl, posBaseUrl } from '../../state/demo-link.ts';

/**
 * Landing en la raíz (#9): abre el POS en demo contra este mini-erp. En desarrollo, la copia local del
 * POS publicado que sirve el mini-erp; en producción, el POS publicado.
 */
export function LandingView() {
  const origin = typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
  const useLocalCopy = import.meta.env.DEV;
  const demoUrl = buildDemoUrl(posBaseUrl(POS_VERSION, origin, useLocalCopy), origin);

  return (
    <div class="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header class="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div class="font-bold tracking-tight">Mini-ERP</div>
        <div class="flex items-center gap-3">
          <ThemeToggle compact />
          <a href="/admin" class="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            Entrar al admin
          </a>
        </div>
      </header>
      <main class="flex-1 flex items-center justify-center px-4 py-12">
        <div class="max-w-xl text-center space-y-6">
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">
            Tu comercio, con un POS que vende aunque se corte internet
          </h1>
          <p class="text-slate-600 dark:text-slate-400">
            Mini-ERP es el backend de ejemplo de offline-pos: catálogo, stock por sucursal, clientes y
            cuentas corrientes. Probá el POS con datos de ejemplo y, cuando quieras, creá tu comercio.
          </p>
          <a
            href={demoUrl}
            class="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/25"
          >
            Probar la demo
          </a>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            {useLocalCopy
              ? `Abre una copia local del POS ${POS_VERSION} publicado (la sirve este mini-erp en desarrollo), conectada a este mini-erp.`
              : `Abre el POS ${POS_VERSION} publicado en offline-pos.pages.dev, conectado a este mini-erp.`}
          </p>
        </div>
      </main>
    </div>
  );
}
