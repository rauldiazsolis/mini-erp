import {
  settingsBranchesSignal,
  branchesLoadingSignal,
  branchModalOpenSignal,
  editingBranchSignal,
  branchFormSignal,
  isSavingBranchSignal,
  branchFormErrorSignal,
  openNewBranchModal,
  openEditBranchModal,
  closeBranchModal,
  submitBranchForm,
  fetchSettingsBranches,
} from '../../state/settings-state.ts';
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

export function BranchesSection() {
  const branches = settingsBranchesSignal.value;
  const isLoading = branchesLoadingSignal.value;
  const isModalOpen = branchModalOpenSignal.value;
  const isEdit = Boolean(editingBranchSignal.value);
  const form = branchFormSignal.value;
  const isSaving = isSavingBranchSignal.value;
  const error = branchFormErrorSignal.value;

  return (
    <div class="space-y-6">
      {/* Header */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-white flex items-center gap-2">
            <span>🏢 Sucursales y Puntos Físicos</span>
          </h3>
          <p class="text-xs text-slate-400 mt-0.5">
            Administra las sucursales donde opera tu comercio para la segregación de stock y cajas
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchSettingsBranches}
            disabled={isLoading}
            class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer"
            title="Recargar sucursales"
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

          <Button size="sm" onClick={openNewBranchModal} class="shadow-md shadow-indigo-600/20">
            <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nueva Sucursal
          </Button>
        </div>
      </div>

      {/* Grilla de Sucursales */}
      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        {isLoading && branches.length === 0 ? (
          <div class="p-8 text-center text-xs text-slate-400 space-y-3">
            <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div>Cargando sucursales...</div>
          </div>
        ) : branches.length === 0 ? (
          <div class="p-12 text-center text-slate-400 space-y-3">
            <div class="text-3xl">🏢</div>
            <div class="text-sm font-bold text-white">No hay sucursales registradas</div>
            <Button size="sm" onClick={openNewBranchModal}>
              Crear Primera Sucursal
            </Button>
          </div>
        ) : (
          <div class="overflow-x-auto">
            <table class="w-full text-left border-collapse text-xs">
              <thead>
                <tr class="bg-slate-950/80 border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-400 select-none">
                  <th class="py-3 px-4 w-36">Código Único</th>
                  <th class="py-3 px-4">Nombre Comercial de Sucursal</th>
                  <th class="py-3 px-4 w-32 text-center">Alta</th>
                  <th class="py-3 px-4 w-20 text-right">Acción</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-800/60 font-sans">
                {branches.map((b) => (
                  <tr key={b.id} class="hover:bg-slate-800/30 transition-colors">
                    <td class="py-3 px-4 font-mono font-bold text-indigo-400">{b.code}</td>
                    <td class="py-3 px-4 font-semibold text-white">{b.name}</td>
                    <td class="py-3 px-4 text-center text-slate-400 font-mono text-[11px]">
                      {formatDate(b.createdAt)}
                    </td>
                    <td class="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEditBranchModal(b)}
                        title="Modificar sucursal"
                        class="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                          />
                        </svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal: Crear / Editar Sucursal */}
      {isModalOpen && (
        <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
          <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
            <div class="p-5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
              <div class="flex items-center gap-3">
                <div class="w-9 h-9 rounded-2xl bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 flex items-center justify-center font-bold">
                  🏢
                </div>
                <div>
                  <h3 class="text-base font-bold text-white">
                    {isEdit ? 'Editar Sucursal' : 'Nueva Sucursal'}
                  </h3>
                  <p class="text-xs text-slate-400">
                    {isEdit ? 'Modifica el nombre o código' : 'Se habilitará el control de stock para esta ubicación'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeBranchModal}
                class="text-slate-400 hover:text-white transition-colors cursor-pointer p-1"
              >
                ✕
              </button>
            </div>

            <div class="p-6 space-y-4">
              {error && (
                <div class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-300">
                  {error}
                </div>
              )}

              <Input
                label="Nombre de la Sucursal *"
                placeholder="Ej: Sucursal Norte, Local 2..."
                value={form.name}
                onInput={(e) =>
                  (branchFormSignal.value = {
                    ...branchFormSignal.value,
                    name: (e.target as HTMLInputElement).value,
                  })
                }
                autoFocus
              />

              <Input
                label="Código Alfanumérico Único *"
                placeholder="SUC02"
                value={form.code}
                onInput={(e) =>
                  (branchFormSignal.value = {
                    ...branchFormSignal.value,
                    code: (e.target as HTMLInputElement).value.toUpperCase(),
                  })
                }
                helperText="Identificador breve en mayúsculas para las terminales y stock"
              />
            </div>

            <div class="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
              <Button variant="outline" size="sm" onClick={closeBranchModal} disabled={isSaving}>
                Cancelar
              </Button>
              <Button size="sm" onClick={submitBranchForm} disabled={isSaving}>
                {isSaving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Sucursal'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
