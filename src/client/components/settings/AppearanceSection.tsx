import { Card, CardHeader } from '../ui/Card.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { themeModeSignal, resolvedThemeSignal } from '../../state/theme-state.ts';

export function AppearanceSection() {
  const currentMode = themeModeSignal.value;
  const resolved = resolvedThemeSignal.value;

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      <Card>
        <CardHeader
          title="Modo de Visualización & Apariencia"
          description="Selecciona cómo deseas visualizar el panel de administración de Mini-ERP. Tu preferencia se guardará en tu navegador."
        />

        <div class="space-y-6">
          <ThemeToggle />

          {/* Tarjeta de Información y Preview */}
          <div class="p-5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-4">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span class="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Estado Actual de la Interfaz
                </span>
                <div class="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">
                  Modo configurado:{' '}
                  <span class="text-indigo-600 dark:text-indigo-400 font-bold uppercase">
                    {currentMode}
                  </span>{' '}
                  • Tema renderizado:{' '}
                  <span class="text-emerald-600 dark:text-emerald-400 font-bold uppercase">
                    {resolved}
                  </span>
                </div>
              </div>
              <div class="text-xs text-slate-500 dark:text-slate-400">
                {currentMode === 'system'
                  ? 'Sincronizado reactivamente con tu sistema operativo'
                  : 'Preferencia manual fija'}
              </div>
            </div>

            {/* Muestra de Elementos */}
            <div class="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div class="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
                <div class="text-xs font-bold text-slate-900 dark:text-white">Tarjeta Base</div>
                <div class="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                  Superficie con contraste equilibrado
                </div>
              </div>

              <div class="p-3 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-200 shadow-sm">
                <div class="text-xs font-bold">Elemento Destacado</div>
                <div class="text-[11px] text-indigo-600 dark:text-indigo-400 mt-1">
                  Acentos índigo y estados activos
                </div>
              </div>

              <div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 shadow-sm">
                <div class="text-xs font-bold">Estado Online</div>
                <div class="text-[11px] text-emerald-600 dark:text-emerald-400 mt-1">
                  Indicadores de sincronización POS
                </div>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
