import {
  merchantStepSignal,
  isExistingAccountSignal,
  userNameSignal,
  userEmailSignal,
  userPasswordSignal,
  businessNameSignal,
  selectedMerchantPresetSignal,
  isSubmittingSignal,
  progressStepMessageSignal,
  errorMessageSignal,
  merchantResultSignal,
  advanceMerchantStep,
  goBackMerchantStep,
  closeMerchantOnboarding,
  enterDashboardFromOnboarding,
  returnToPosWithCredentials,
} from '../../state/merchant-onboarding-state.ts';
import {
  isAuthenticatedSignal,
  currentUserSignal,
} from '../../state/auth-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import type { BusinessPreset } from '../../state/onboarding-state.ts';

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
    description: 'Bebidas, snacks, golosinas y cigarrillos precargados con precios y stock de referencia.',
    icon: '🏪',
  },
  {
    id: 'ferreteria',
    title: 'Ferretería / Corralón',
    badge: 'Industrial',
    description: 'Tornillería, herramientas manuales, pinturas y electricidad listos para vender.',
    icon: '🔧',
  },
  {
    id: 'almacen',
    title: 'Almacén / Minimarket',
    badge: 'Comestibles',
    description: 'Lácteos, fiambres, panificados, artículos de almacén y limpieza.',
    icon: '🛒',
  },
  {
    id: 'empty',
    title: 'En Blanco (Personalizado)',
    badge: 'Sin datos',
    description: 'Inicia con un catálogo completamente vacío para cargar tus propios productos desde cero.',
    icon: '📄',
  },
];

export function MerchantOnboardingView() {
  const step = merchantStepSignal.value;
  const isSubmitting = isSubmittingSignal.value;
  const error = errorMessageSignal.value;
  const result = merchantResultSignal.value;
  const isAuth = isAuthenticatedSignal.value;
  const currentUser = currentUserSignal.value;
  const isExistingAccount = isExistingAccountSignal.value;

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
    <div class="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col selection:bg-indigo-500 selection:text-white transition-colors relative overflow-hidden">
      {/* Luces y glows decorativos */}
      <div class="absolute -top-40 -left-40 w-96 h-96 bg-indigo-500/10 dark:bg-indigo-600/15 rounded-full blur-3xl pointer-events-none"></div>
      <div class="absolute -bottom-40 -right-40 w-96 h-96 bg-violet-500/10 dark:bg-violet-600/15 rounded-full blur-3xl pointer-events-none"></div>

      {/* Top Navbar */}
      <header class="w-full border-b border-slate-200 dark:border-slate-800/80 bg-white/70 dark:bg-slate-900/60 backdrop-blur-md sticky top-0 z-30 px-6 py-4 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-2xl bg-gradient-to-tr from-indigo-600 to-violet-500 text-white flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/25">
            🚀
          </div>
          <div>
            <h1 class="text-base font-bold tracking-tight text-slate-900 dark:text-white">Mini-ERP Express</h1>
            <p class="text-xs text-slate-500 dark:text-slate-400">Onboarding de Nuevos Comercios</p>
          </div>
        </div>

        <div class="flex items-center gap-3">
          <ThemeToggle compact />
          <button
            type="button"
            onClick={closeMerchantOnboarding}
            class="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white px-3 py-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            Volver a la App
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main class="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 z-10">
        <div class="w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xl dark:shadow-2xl overflow-hidden flex flex-col">
          {/* Stepper Bar */}
          <div class="px-6 py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between text-xs">
            {[
              { num: 1, label: '1. Tu Cuenta' },
              { num: 2, label: '2. Tu Negocio & Rubro' },
              { num: 3, label: '3. Aprovisionando' },
              { num: 4, label: '4. ¡Listo!' },
            ].map((s) => {
              const isActive = step === s.num;
              const isDone = step > s.num;
              return (
                <div
                  key={s.num}
                  class={`flex items-center gap-2 ${
                    isActive
                      ? 'text-indigo-600 dark:text-indigo-400 font-bold'
                      : isDone
                      ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                      : 'text-slate-400 dark:text-slate-500'
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

          {/* Form Content */}
          <div class="p-6 sm:p-8 space-y-6">
            {error && (
              <div class="p-4 bg-rose-500/10 border border-rose-500/25 rounded-2xl flex items-center gap-3 text-xs text-rose-700 dark:text-rose-300 animate-in fade-in duration-150">
                <svg class="w-5 h-5 text-rose-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{error}</span>
              </div>
            )}

            {/* PASO 1: CUENTA */}
            {step === 1 && (
              <div class="space-y-5 animate-in fade-in duration-200">
                <div>
                  <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Crea tu cuenta de administrador</h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Con esta cuenta podrás gestionar tu stock, precios, reportes de ventas y conectar múltiples cajas registradoras.
                  </p>
                </div>

                {isAuth && currentUser ? (
                  <div class="p-4 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-2xl flex items-center justify-between">
                    <div>
                      <p class="text-xs font-bold text-emerald-800 dark:text-emerald-300">Sesión iniciada como:</p>
                      <p class="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{currentUser.name} ({currentUser.email})</p>
                    </div>
                    <span class="text-xs bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2.5 py-1 rounded-full font-bold">
                      Activa ✓
                    </span>
                  </div>
                ) : (
                  <>
                    <div class="flex items-center justify-end text-xs">
                      <button
                        type="button"
                        onClick={() => (isExistingAccountSignal.value = !isExistingAccount)}
                        class="text-indigo-600 dark:text-indigo-400 hover:underline font-semibold cursor-pointer"
                      >
                        {isExistingAccount ? '← ¿No tienes cuenta? Regístrate aquí' : '¿Ya tienes cuenta? Iniciar sesión →'}
                      </button>
                    </div>

                    {!isExistingAccount && (
                      <Input
                        label="Nombre completo / Responsable"
                        placeholder="Ej: Martín Rodríguez"
                        value={userNameSignal.value}
                        onInput={(e) => (userNameSignal.value = (e.target as HTMLInputElement).value)}
                        autoFocus
                      />
                    )}

                    <Input
                      label="Correo electrónico"
                      type="email"
                      placeholder="ejemplo@comercio.com"
                      value={userEmailSignal.value}
                      onInput={(e) => (userEmailSignal.value = (e.target as HTMLInputElement).value)}
                    />

                    <Input
                      label="Contraseña"
                      type="password"
                      placeholder="Mínimo 6 caracteres"
                      value={userPasswordSignal.value}
                      onInput={(e) => (userPasswordSignal.value = (e.target as HTMLInputElement).value)}
                      helperText="Utiliza una contraseña segura para acceder a tus reportes y ventas"
                    />
                  </>
                )}
              </div>
            )}

            {/* PASO 2: NEGOCIO & RUBRO */}
            {step === 2 && (
              <div class="space-y-6 animate-in fade-in duration-200">
                <div>
                  <h2 class="text-xl font-bold tracking-tight text-slate-900 dark:text-white">Cuéntanos sobre tu comercio</h2>
                  <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    Configuraremos automáticamente tu base de datos y dejaremos tu caja lista para operar.
                  </p>
                </div>

                <Input
                  label="Nombre del Negocio o Tienda"
                  placeholder="Ej: Kiosco San Martín, Ferretería El Candado, Minimarket Central..."
                  value={businessNameSignal.value}
                  onInput={(e) => (businessNameSignal.value = (e.target as HTMLInputElement).value)}
                  helperText="No te preocupes por códigos técnicos, nosotros nos encargamos de todo"
                  autoFocus
                />

                <div class="space-y-2">
                  <label class="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Rubro comercial (plantilla inicial sugerida)
                  </label>
                  <p class="text-xs text-slate-500 dark:text-slate-400">
                    Puedes precargar artículos modelo listos para vender o comenzar en blanco. Podrás modificarlos cuando quieras.
                  </p>

                  <div class="grid grid-cols-1 sm:grid-cols-2 gap-3.5 pt-2">
                    {PRESETS.map((p) => {
                      const isSelected = selectedMerchantPresetSignal.value === p.id;
                      return (
                        <div
                          key={p.id}
                          onClick={() => (selectedMerchantPresetSignal.value = p.id)}
                          class={`p-4 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                            isSelected
                              ? 'bg-indigo-600/10 border-indigo-500 shadow-lg shadow-indigo-600/10 ring-2 ring-indigo-500/40'
                              : 'bg-slate-50 dark:bg-slate-950/50 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                          }`}
                        >
                          <div class="flex items-start justify-between mb-2">
                            <span class="text-2xl">{p.icon}</span>
                            <span
                              class={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
                                isSelected
                                  ? 'bg-indigo-600 text-white'
                                  : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-400'
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
              </div>
            )}

            {/* PASO 3: APROVISIONANDO */}
            {step === 3 && (
              <div class="py-12 flex flex-col items-center justify-center text-center space-y-4 animate-in fade-in duration-200">
                <div class="w-16 h-16 rounded-3xl bg-indigo-600/15 border border-indigo-500/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 animate-pulse">
                  <svg class="w-8 h-8 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                  </svg>
                </div>
                <h3 class="text-lg font-bold text-slate-900 dark:text-white">Preparando tu comercio...</h3>
                <p class="text-xs text-indigo-600 dark:text-indigo-400 font-medium max-w-sm">
                  {progressStepMessageSignal.value || 'Configurando tu tienda y credenciales...'}
                </p>
              </div>
            )}

            {/* PASO 4: ÉXITO Y CONEXIÓN */}
            {step === 4 && result && (
              <div class="space-y-6 animate-in fade-in duration-200">
                <div class="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-2xl flex items-center gap-4">
                  <div class="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center font-bold text-2xl shadow-lg shadow-emerald-500/30 shrink-0">
                    ✓
                  </div>
                  <div>
                    <h3 class="text-base font-bold text-slate-900 dark:text-white">
                      ¡Felicitaciones! "{result.name}" está listo para operar
                    </h3>
                    <p class="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                      Tu base de datos segura fue inicializada y tu terminal de caja ya tiene credenciales emitidas.
                    </p>
                  </div>
                </div>

                {/* Acciones de Retorno o Ingreso */}
                <div class="p-5 bg-gradient-to-tr from-indigo-50 to-violet-50 dark:from-indigo-950/30 dark:to-violet-950/30 border border-indigo-200 dark:border-indigo-500/30 rounded-3xl space-y-4 text-center">
                  {result.returnWithParamsUrl ? (
                    <>
                      <div>
                        <h4 class="text-sm font-bold text-slate-900 dark:text-white">Vincular con tu Punto de Venta (POS)</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Vuelve a la pantalla de tu POS. Tu terminal se configurará automáticamente con tu nueva cuenta.
                        </p>
                      </div>
                      <div class="flex flex-col sm:flex-row items-center justify-center gap-3 pt-1">
                        <Button
                          variant="primary"
                          size="lg"
                          class="w-full sm:w-auto shadow-lg shadow-indigo-600/30"
                          onClick={returnToPosWithCredentials}
                        >
                          🚀 Volver al POS y Conectar Caja Automáticamente
                        </Button>
                        <Button
                          variant="outline"
                          size="md"
                          onClick={enterDashboardFromOnboarding}
                        >
                          Ir al Panel Mini-ERP →
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <h4 class="text-sm font-bold text-slate-900 dark:text-white">Acceso a tu Panel de Control</h4>
                        <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">
                          Gestiona tu inventario, ventas, cuentas corrientes y sincronización desde cualquier dispositivo.
                        </p>
                      </div>
                      <div class="flex justify-center pt-1">
                        <Button
                          variant="primary"
                          size="lg"
                          class="shadow-lg shadow-indigo-600/30"
                          onClick={enterDashboardFromOnboarding}
                        >
                          Ingresar al Panel de Mini-ERP →
                        </Button>
                      </div>
                    </>
                  )}
                </div>

                {/* Tarjeta de Credenciales */}
                <div class="bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
                  <div class="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    Credenciales de tu Caja (Guárdalas o úsalas en otra terminal)
                  </div>

                  <div>
                    <div class="text-[10px] text-slate-400 mb-1">Connector Sync URL</div>
                    <div class="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={result.connectorUrl}
                        class="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-indigo-600 dark:text-indigo-300"
                      />
                      <Button size="sm" variant="secondary" onClick={() => copyToClipboard(result.connectorUrl, 'URL')}>
                        Copiar
                      </Button>
                    </div>
                  </div>

                  <div>
                    <div class="text-[10px] text-slate-400 mb-1">API Key de Sincronización</div>
                    <div class="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={result.apiKey}
                        class="flex-1 px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-emerald-600 dark:text-emerald-300"
                      />
                      <Button size="sm" variant="secondary" onClick={() => copyToClipboard(result.apiKey, 'API Key')}>
                        Copiar
                      </Button>
                    </div>
                  </div>

                  <p class="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
                    💡 <strong>Tip:</strong> Puedes vender en tu caja sin conexión a internet. Todas las operaciones se sincronizarán solas cuando vuelva la red.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer Navigation Buttons */}
          {step < 3 && (
            <div class="p-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/40 flex items-center justify-between">
              <div>
                {step > 1 && !isAuth ? (
                  <Button variant="outline" size="sm" onClick={goBackMerchantStep}>
                    ← Anterior
                  </Button>
                ) : (
                  <button
                    type="button"
                    onClick={closeMerchantOnboarding}
                    class="text-xs text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  >
                    Cancelar
                  </button>
                )}
              </div>

              <div>
                <Button
                  variant="primary"
                  size="md"
                  onClick={advanceMerchantStep}
                  loading={isSubmitting}
                >
                  {step === 1 ? 'Continuar a Datos del Negocio →' : 'Aprovisionar Mi Comercio 🚀'}
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
