import {
  stepSignal,
  nameSignal,
  slugSignal,
  tenantIdSignal,
  selectedPresetSignal,
  branchNameSignal,
  branchCodeSignal,
  posNameSignal,
  isSubmittingSignal,
  errorMessageSignal,
  provisionResultSignal,
  setName,
  nextStep,
  prevStep,
  finishAndEnterTenant,
  type BusinessPreset,
} from '../../state/onboarding-state.ts';
import {
  onboardingModalOpenSignal,
  closeOnboardingModal,
} from '../../state/navigation-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

const PRESETS: Array<{
  id: BusinessPreset;
  title: string;
  badge: string;
  description: string;
  icon: string;
}> = [
  {
    id: 'kiosco',
    title: 'Kiosco / Drugstore',
    badge: 'Popular',
    description: 'Bebidas, snacks, golosinas y cigarrillos precargados con categorías y precios sugeridos.',
    icon: '🏪',
  },
  {
    id: 'ferreteria',
    title: 'Ferretería / Corralón',
    badge: 'Industrial',
    description: 'Tornillería, herramientas manuales, pinturas y electricidad con stock de referencia.',
    icon: '🔧',
  },
  {
    id: 'almacen',
    title: 'Almacén / Minimarket',
    badge: 'Comestibles',
    description: 'Lácteos, fiambres, panificados, artículos de almacén y limpieza listos para la venta.',
    icon: '🛒',
  },
  {
    id: 'empty',
    title: 'En Blanco (Personalizado)',
    badge: 'Sin datos',
    description: 'Inicia con un catálogo completamente vacío para cargar tus propios productos desde cero o CSV.',
    icon: '📄',
  },
];

export function OnboardingModal() {
  if (!onboardingModalOpenSignal.value) return null;

  const step = stepSignal.value;
  const isSubmitting = isSubmittingSignal.value;
  const error = errorMessageSignal.value;
  const result = provisionResultSignal.value;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast({
          type: 'success',
          title: 'Copiado',
          message: `${label} copiado al portapapeles`,
        });
      }
    } catch {
      showToast({
        type: 'error',
        title: 'Error al copiar',
        message: 'No se pudo copiar automáticamente al portapapeles',
      });
    }
  };

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-in fade-in duration-200">
      <div class="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header Modal */}
        <div class="p-6 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center font-bold text-lg shadow-lg shadow-indigo-500/25">
              🚀
            </div>
            <div>
              <h2 class="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Nuevo Comercio en Mini-ERP</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">Asistente de configuración y aprovisionamiento en 3 pasos</p>
            </div>
          </div>
          {step < 4 && (
            <button
              type="button"
              onClick={closeOnboardingModal}
              disabled={isSubmitting}
              class="text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Stepper Wizard Bar */}
        <div class="px-6 py-3 border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/80 dark:bg-slate-900/60 flex items-center justify-between text-xs">
          {[
            { num: 1, label: 'Identidad' },
            { num: 2, label: 'Rubro & Preset' },
            { num: 3, label: 'Sucursal & POS' },
            { num: 4, label: '¡Listo!' },
          ].map((s) => {
            const isActive = step === s.num;
            const isDone = step > s.num;
            return (
              <div
                key={s.num}
                class={`flex items-center gap-2 ${
                  isActive ? 'text-indigo-600 dark:text-indigo-400 font-bold' : isDone ? 'text-emerald-600 dark:text-emerald-400 font-medium' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                <div
                  class={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                    isActive
                      ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/40 ring-2 ring-indigo-400/30'
                      : isDone
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {isDone ? '✓' : s.num}
                </div>
                <span class="hidden sm:inline">{s.label}</span>
              </div>
            );
          })}
        </div>

        {/* Body Container */}
        <div class="p-6 overflow-y-auto flex-1 space-y-6">
          {error && (
            <div class="p-3.5 bg-rose-500/10 border border-rose-500/30 rounded-2xl flex items-center gap-3 text-xs text-rose-700 dark:text-rose-300">
              <svg class="w-5 h-5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* STEP 1: IDENTIDAD */}
          {step === 1 && (
            <div class="space-y-4 animate-in fade-in duration-150">
              <div class="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 p-3.5 rounded-2xl text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                Ingresa los datos comerciales básicos. Se generará un slug amigable y un identificador aislado para la
                base de datos SQLite del tenant.
              </div>

              <Input
                label="Nombre del Comercio / Empresa"
                placeholder="Ej: Kiosco San Martín, Ferretería El Candado..."
                value={nameSignal.value}
                onInput={(e) => setName((e.target as HTMLInputElement).value)}
                autoFocus
              />

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Slug Web"
                  placeholder="ej: kiosco-san-martin"
                  value={slugSignal.value}
                  onInput={(e) => (slugSignal.value = (e.target as HTMLInputElement).value)}
                  helperText="Identificador legible para URLs y subdominios"
                />

                <Input
                  label="Identificador de Tenant (ID)"
                  placeholder="ej: kiosco-san-martin"
                  value={tenantIdSignal.value}
                  onInput={(e) => (tenantIdSignal.value = (e.target as HTMLInputElement).value)}
                  helperText="Nombre del archivo SQLite aislado: data/tenants/[id].sqlite"
                />
              </div>
            </div>
          )}

          {/* STEP 2: PRESET COMERCIAL */}
          {step === 2 && (
            <div class="space-y-4 animate-in fade-in duration-150">
              <div>
                <h3 class="text-sm font-bold text-slate-900 dark:text-white">Selecciona una plantilla o rubro inicial</h3>
                <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Puedes precargar categorías, marcas y artículos modelo listos para vender o comenzar en blanco.
                </p>
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                {PRESETS.map((p) => {
                  const isSelected = selectedPresetSignal.value === p.id;
                  return (
                    <div
                      key={p.id}
                      onClick={() => (selectedPresetSignal.value = p.id)}
                      class={`p-4 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                        isSelected
                          ? 'bg-indigo-600/15 border-indigo-500 shadow-lg shadow-indigo-600/10 ring-2 ring-indigo-500/40'
                          : 'bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <div class="flex items-start justify-between mb-2">
                        <span class="text-2xl">{p.icon}</span>
                        <span
                          class={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                            isSelected
                              ? 'bg-indigo-600 text-white'
                              : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400 border border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {p.badge}
                        </span>
                      </div>
                      <div class="font-bold text-sm text-slate-900 dark:text-white mb-1">{p.title}</div>
                      <div class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{p.description}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 3: SUCURSAL & TERMINAL POS */}
          {step === 3 && (
            <div class="space-y-4 animate-in fade-in duration-150">
              <div class="bg-indigo-50 dark:bg-indigo-500/10 border border-indigo-200 dark:border-indigo-500/20 p-3.5 rounded-2xl text-xs text-indigo-700 dark:text-indigo-300 leading-relaxed">
                Configura la primera sucursal física y la terminal POS donde operará tu caja registradora. Se emitirá
                una API Key segura lista para sincronizar.
              </div>

              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Nombre de Sucursal"
                  placeholder="Casa Central, Sucursal 1..."
                  value={branchNameSignal.value}
                  onInput={(e) => (branchNameSignal.value = (e.target as HTMLInputElement).value)}
                />

                <Input
                  label="Código de Sucursal"
                  placeholder="CENTRAL, SUC01..."
                  value={branchCodeSignal.value}
                  onInput={(e) => (branchCodeSignal.value = (e.target as HTMLInputElement).value)}
                  helperText="Código alfanumérico en mayúsculas"
                />
              </div>

              <Input
                label="Nombre del Punto de Venta / Terminal"
                placeholder="Caja 1, Mostrador Principal..."
                value={posNameSignal.value}
                onInput={(e) => (posNameSignal.value = (e.target as HTMLInputElement).value)}
                helperText="Identificará a esta caja registradora en los reportes de ventas"
              />
            </div>
          )}

          {/* STEP 4: RESULTADO Y CREDENCIALES POS */}
          {step === 4 && result && (
            <div class="space-y-5 animate-in fade-in duration-150">
              <div class="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-3.5">
                <div class="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-emerald-500/30 shrink-0">
                  ✓
                </div>
                <div>
                  <h4 class="text-sm font-bold text-slate-900 dark:text-white">¡Comercio "{result.name}" Creado con Éxito!</h4>
                  <p class="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                    La base de datos SQLite fue creada y poblada. Conecta tu Offline POS con las siguientes credenciales:
                  </p>
                </div>
              </div>

              {/* Credenciales Card */}
              <div class="bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3.5">
                <div>
                  <div class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    Connector Sync URL
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={result.connectorUrl}
                      class="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-indigo-600 dark:text-indigo-300 focus:outline-none"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(result.connectorUrl, 'URL')}
                    >
                      Copiar
                    </Button>
                  </div>
                </div>

                <div>
                  <div class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">
                    API Key del POS (v4.0.0)
                  </div>
                  <div class="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={result.apiKey}
                      class="flex-1 px-3 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-emerald-600 dark:text-emerald-300 focus:outline-none"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => copyToClipboard(result.apiKey, 'API Key')}
                    >
                      Copiar
                    </Button>
                  </div>
                </div>

                <div class="flex items-center gap-4 text-xs text-slate-500 dark:text-slate-400 pt-1">
                  <div>
                    <span class="text-slate-400 dark:text-slate-500">Sucursal:</span> <strong class="text-slate-900 dark:text-white">{result.branch}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 dark:text-slate-500">Terminal:</span>{' '}
                    <strong class="text-slate-900 dark:text-white">{result.pointOfSale}</strong>
                  </div>
                  <div>
                    <span class="text-slate-400 dark:text-slate-500">Tenant ID:</span>{' '}
                    <strong class="text-slate-900 dark:text-white font-mono">{result.tenantId}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Modal Actions */}
        <div class="p-5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 flex items-center justify-between">
          {step < 4 ? (
            <>
              <div>
                {step > 1 ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={prevStep}
                    disabled={isSubmitting}
                  >
                    ← Anterior
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={closeOnboardingModal}
                    disabled={isSubmitting}
                  >
                    Cancelar
                  </Button>
                )}
              </div>

              <div>
                {step < 3 ? (
                  <Button type="button" size="sm" onClick={nextStep}>
                    Siguiente Paso →
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={nextStep}
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? 'Aprovisionando...' : 'Aprovisionar Comercio 🚀'}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div class="w-full flex justify-end">
              <Button type="button" size="md" onClick={finishAndEnterTenant}>
                Ingresar al Dashboard →
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
