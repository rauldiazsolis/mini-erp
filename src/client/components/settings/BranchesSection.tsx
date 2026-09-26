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
import { Card } from '../ui/Card.tsx';
import { Modal } from '../ui/Modal.tsx';
import { TableContainer, Table, Thead, Tbody, Tr, Th, Td } from '../ui/Table.tsx';

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
      <Card class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>🏢 Sucursales y Puntos Físicos</span>
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Administra las sucursales donde opera tu comercio para la segregación de stock y cajas
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void fetchSettingsBranches(); }}
            disabled={isLoading}
            class="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
            title="Recargar sucursales"
          >
            <svg
              class={`w-4 h-4 ${isLoading ? 'animate-spin text-indigo-500 dark:text-indigo-400' : ''}`}
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
      </Card>

      {/* Grilla de Sucursales */}
      <TableContainer>
        {isLoading && branches.length === 0 ? (
          <div class="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div>Cargando sucursales...</div>
          </div>
        ) : branches.length === 0 ? (
          <div class="p-12 text-center text-slate-500 dark:text-slate-400 space-y-3">
            <div class="text-3xl">🏢</div>
            <div class="text-sm font-bold text-slate-900 dark:text-white">No hay sucursales registradas</div>
            <Button size="sm" onClick={openNewBranchModal}>
              Crear Primera Sucursal
            </Button>
          </div>
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th class="w-36">Código Único</Th>
                  <Th>Nombre Comercial de Sucursal</Th>
                  <Th class="w-32 text-center">Alta</Th>
                  <Th class="w-20 text-right">Acción</Th>
                </Tr>
              </Thead>
              <Tbody>
                {branches.map((b) => (
                  <Tr key={b.id}>
                    <Td class="font-mono font-bold text-indigo-600 dark:text-indigo-400">{b.code}</Td>
                    <Td class="font-semibold text-slate-900 dark:text-white">{b.name}</Td>
                    <Td class="text-center text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {formatDate(b.createdAt)}
                    </Td>
                    <Td class="text-right">
                      <button
                        type="button"
                        onClick={() => { openEditBranchModal(b); }}
                        title="Modificar sucursal"
                        class="p-1.5 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
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
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </TableContainer>

      {/* Modal: Crear / Editar Sucursal */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeBranchModal}
        title={isEdit ? 'Editar Sucursal' : 'Nueva Sucursal'}
        subtitle={isEdit ? 'Modifica el nombre o código' : 'Se habilitará el control de stock para esta ubicación'}
        icon="🏢"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeBranchModal} disabled={isSaving}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => { void submitBranchForm(); }} disabled={isSaving}>
              {isSaving ? 'Guardando...' : isEdit ? 'Guardar Cambios' : 'Crear Sucursal'}
            </Button>
          </>
        }
      >
        <div class="space-y-4">
          {error && (
            <div class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-300">
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
      </Modal>
    </div>
  );
}
