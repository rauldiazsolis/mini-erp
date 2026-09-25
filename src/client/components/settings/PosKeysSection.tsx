import {
  apiKeysSignal,
  apiKeysLoadingSignal,
  createKeyModalOpenSignal,
  createKeyFormSignal,
  isCreatingKeySignal,
  createKeyErrorSignal,
  createdSecretKeySignal,
  settingsBranchesSignal,
  openCreateKeyModal,
  closeCreateKeyModal,
  submitCreateApiKey,
  dismissSecretKeyModal,
  revokeApiKey,
  fetchApiKeys,
} from '../../state/settings-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function PosKeysSection() {
  const keys = apiKeysSignal.value;
  const isLoading = apiKeysLoadingSignal.value;
  const isCreateOpen = createKeyModalOpenSignal.value;
  const form = createKeyFormSignal.value;
  const isCreating = isCreatingKeySignal.value;
  const createError = createKeyErrorSignal.value;
  const secretKey = createdSecretKeySignal.value;
  const branches = settingsBranchesSignal.value;

  const copyToClipboard = async (text: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        showToast({
          type: 'success',
          title: 'Copiado',
          message: 'Clave secreta copiada al portapapeles',
        });
      }
    } catch {
      showToast({ type: 'error', title: 'Error', message: 'No se pudo copiar automáticamente' });
    }
  };

  return (
    <div class="space-y-6">
      {/* Header y Acciones */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>📡 Terminales POS y Llaves de Acceso (API Keys)</span>
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Cada caja registradora u operadora offline se autentica con una API Key criptográfica vinculada a su sucursal
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchApiKeys}
            disabled={isLoading}
            class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer"
            title="Recargar llaves"
          >
            <svg
              class={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-400' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>

          <Button size="sm" onClick={openCreateKeyModal} class="shadow-md shadow-indigo-600/20">
            <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nueva API Key
          </Button>
        </div>
      </div>

      {/* Lista de API Keys */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {isLoading && keys.length === 0 ? (
          <div class="p-8 text-center text-xs text-slate-400 space-y-3">
            <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div>Cargando terminales autorizadas...</div>
          </div>
        ) : keys.length === 0 ? (
          <div class="p-12 text-center text-slate-400 space-y-3">
            <div class="text-3xl">🔑</div>
            <div class="text-sm font-bold text-white">No hay API Keys generadas</div>
            <p class="text-xs text-slate-500 max-w-sm mx-auto">
              Crea tu primera llave para vincular tu caja registradora o terminal de venta con el Mini-ERP.
            </p>
            <Button size="sm" onClick={openCreateKeyModal}>
              Crear Primera Llave
            </Button>
          </div>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="bg-slate-950/80 border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-400 select-none">
                  <th class="py-3 px-4">Terminal / Nombre</th>
                  <th class="py-3 px-4 w-32">Sucursal</th>
                  <th class="py-3 px-4 w-32">Punto de Venta</th>
                  <th class="py-3 px-4 w-40">Prefijo de Clave</th>
                  <th class="py-3 px-4 w-28 text-center">Estado</th>
                  <th class="py-3 px-4 w-28 text-center">Creada</th>
                  <th class="py-3 px-4 w-20 text-right">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60 font-sans">
                {keys.map((k) => (
                  <tr key={k.id} class="hover:bg-slate-800/30 transition-colors">
                    <td class="py-3 px-4 font-semibold text-white">{k.name}</td>
                    <td class="py-3 px-4">
                      <span class="px-2 py-0.5 rounded-md bg-slate-800 text-indigo-300 font-mono text-[11px] font-bold border border-slate-700/50">
                        {k.branch}
                      </span>
                    </td>
                    <td class="py-3 px-4 text-slate-300">{k.pointOfSale}</td>
                    <td class="py-3 px-4 font-mono text-slate-400">{k.keyPrefix}••••••••</td>
                    <td class="py-3 px-4 text-center">
                      <span
                        class={`inline-block px-2 py-0.5 rounded-full font-medium text-[10px] ${
                          k.active
                            ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {k.active ? 'Activa' : 'Revocada'}
                      </span>
                    </td>
                    <td class="py-3 px-4 text-center text-slate-400 font-mono text-[11px]">
                      {formatDate(k.createdAt)}
                    </td>
                    <td class="py-3 px-4 text-right">
                      {k.active && (
                        <button
                          type="button"
                          onClick={() => revokeApiKey(k.id, k.name)}
                          title="Revocar acceso a esta terminal"
                          class="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                        >
                          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path
                              stroke-linecap="round"
                              stroke-linejoin="round"
                              stroke-width="2"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Crear Nueva API Key */}
      {isCreateOpen && (
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div class="p-5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold">
                  🔑
                </div>
                <div>
                  <h3 class="text-base font-bold text-white">Nueva API Key de POS</h3>
                  <p class="text-xs text-slate-400">Emite una credencial segura para sincronizar</p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeCreateKeyModal}
                class="text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <div class="p-6 space-y-4">
              {createError && (
                <div class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                  {createError}
                </div>
              )}

              <Input
                label="Nombre identificador *"
                placeholder="Ej: Caja Mostrador 1"
                value={form.name}
                onInput={(e) =>
                  (createKeyFormSignal.value = {
                    ...createKeyFormSignal.value,
                    name: (e.target as HTMLInputElement).value,
                  })
                }
                autoFocus
              />

              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">Sucursal *</label>
                <select
                  value={form.branch}
                  onChange={(e) =>
                    (createKeyFormSignal.value = {
                      ...createKeyFormSignal.value,
                      branch: (e.target as HTMLSelectElement).value,
                    })
                  }
                  class="w-full px-3.5 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.code}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </div>

              <Input
                label="Nombre de Punto de Venta / Terminal *"
                placeholder="Caja 1"
                value={form.pointOfSale}
                onInput={(e) =>
                  (createKeyFormSignal.value = {
                    ...createKeyFormSignal.value,
                    pointOfSale: (e.target as HTMLInputElement).value,
                  })
                }
              />
            </div>

            <div class="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
              <Button variant="outline" size="sm" onClick={closeCreateKeyModal} disabled={isCreating}>
                Cancelar
              </Button>
              <Button size="sm" onClick={submitCreateApiKey} disabled={isCreating}>
                {isCreating ? 'Generando...' : 'Generar Clave 🔑'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Clave Secreta Generada (Solo visible una vez) */}
      {secretKey && (
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-150">
          <div class="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div class="p-6 border-b border-slate-800 bg-slate-950/40 flex items-center gap-3">
              <div class="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center text-xl font-bold">
                ✓
              </div>
              <div>
                <h3 class="text-base font-bold text-white">¡API Key Generada con Éxito!</h3>
                <p class="text-xs text-slate-400">Asignada a "{secretKey.name}" ({secretKey.branch} / {secretKey.pointOfSale})</p>
              </div>
            </div>

            <div class="p-6 space-y-4">
              <div class="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-300 leading-relaxed flex items-start gap-2.5">
                <span class="text-lg">⚠️</span>
                <span>
                  <strong>Copia esta clave ahora:</strong> Por seguridad, esta es la única vez que se mostrará la clave completa. No se almacenará en texto plano en la base de datos.
                </span>
              </div>

              <div>
                <label class="block text-xs font-medium text-slate-300 mb-1.5">Clave Secreta de Conexión</label>
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={secretKey.rawKey}
                    class="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl font-mono text-xs text-emerald-400 focus:outline-none"
                  />
                  <Button size="sm" onClick={() => copyToClipboard(secretKey.rawKey)}>
                    Copiar
                  </Button>
                </div>
              </div>
            </div>

            <div class="p-4 border-t border-slate-800 bg-slate-950/40 flex justify-end">
              <Button size="sm" onClick={dismissSecretKeyModal}>
                Entendido y Guardado
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
