import { Logo } from '../ui/Logo.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';

/** Pantalla de actualización (#47): el servidor está migrando; vuelve sola (`maintenance-state.ts`). */
export function MaintenanceView() {
  return (
    <div class="relative min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950 px-4">
      <div class="absolute top-4 right-4">
        <ThemeToggle compact />
      </div>
      <main class="max-w-md text-center space-y-3">
        <Logo class="w-14 h-14 mx-auto" />
        <h1 class="text-2xl font-semibold text-slate-900 dark:text-slate-100">Estamos actualizando mini contax</h1>
        <p class="text-slate-600 dark:text-slate-400">Vuelve sola en cuanto termine; no hace falta recargar.</p>
      </main>
    </div>
  );
}
