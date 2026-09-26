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
import { Card } from '../ui/Card.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Select } from '../ui/Select.tsx';
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
      if (typeof navigator !== 'undefined') {
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
      <Card class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <span>📡 Terminales POS y Llaves de Acceso (API Keys)</span>
          </h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cada caja registradora u operadora offline se autentica con una API Key criptográfica vinculada a su sucursal
          </p>
        </div>

        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void fetchApiKeys(); }}
            disabled={isLoading}
            class="p-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl transition-colors cursor-pointer"
            title="Recargar llaves"
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

          <Button size="sm" onClick={openCreateKeyModal} class="shadow-md shadow-indigo-600/20">
            <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nueva API Key
          </Button>
        </div>
      </Card>

      {/* Lista de API Keys */}
      <TableContainer>
        {isLoading && keys.length === 0 ? (
          <div class="p-8 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
            <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <div>Cargando terminales autorizadas...</div>
          </div>
        ) : keys.length === 0 ? (
          <div class="p-12 text-center text-slate-500 dark:text-slate-400 space-y-3">
            <div class="text-3xl">🔑</div>
            <div class="text-sm font-bold text-slate-900 dark:text-white">No hay API Keys generadas</div>
            <p class="text-xs text-slate-500 dark:text-slate-400 max-w-sm mx-auto">
              Crea tu primera llave para vincular tu caja registradora o terminal de venta con el Mini-ERP.
            </p>
            <Button size="sm" onClick={openCreateKeyModal}>
              Crear Primera Llave
            </Button>
          </div>
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Terminal / Nombre</Th>
                  <Th class="w-32">Sucursal</Th>
                  <Th class="w-32">Punto de Venta</Th>
                  <Th class="w-40">Prefijo de Clave</Th>
                  <Th class="w-28 text-center">Estado</Th>
                  <Th class="w-28 text-center">Creada</Th>
                  <Th class="w-20 text-right">Acción</Th>
                </Tr>
              </Thead>
              <Tbody>
                {keys.map((k) => (
                  <Tr key={k.id}>
                    <Td class="font-semibold text-slate-900 dark:text-white">{k.name}</Td>
                    <Td>
                      <span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 font-mono text-[11px] font-bold border border-slate-200 dark:border-slate-700/50">
                        {k.branch}
                      </span>
                    </Td>
                    <Td class="text-slate-600 dark:text-slate-300">{k.pointOfSale}</Td>
                    <Td class="font-mono text-slate-500 dark:text-slate-400">{k.keyPrefix}••••••••</Td>
                    <Td class="text-center">
                      <span
                        class={`inline-block px-2 py-0.5 rounded-full font-medium text-[10px] ${
                          k.active
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        }`}
                      >
                        {k.active ? 'Activa' : 'Revocada'}
                      </span>
                    </Td>
                    <Td class="text-center text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                      {formatDate(k.createdAt)}
                    </Td>
                    <Td class="text-right">
                      {k.active && (
                        <button
                          type="button"
                          onClick={() => { void revokeApiKey(k.id, k.name); }}
                          title="Revocar acceso a esta terminal"
                          class="p-1.5 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
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
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </TableContainer>

      {/* Modal: Crear Nueva API Key */}
      <Modal
        isOpen={isCreateOpen}
        onClose={closeCreateKeyModal}
        title="Nueva API Key de POS"
        subtitle="Emite una credencial segura para sincronizar"
        icon="🔑"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeCreateKeyModal} disabled={isCreating}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => { void submitCreateApiKey(); }} disabled={isCreating}>
              {isCreating ? 'Generando...' : 'Generar Clave 🔑'}
            </Button>
          </>
        }
      >
        <div class="space-y-4">
          {createError && (
            <div class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-300">
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
            <Select
              label="Sucursal *"
              value={form.branch}
              onChange={(e) =>
                (createKeyFormSignal.value = {
                  ...createKeyFormSignal.value,
                  branch: (e.target as HTMLSelectElement).value,
                })
              }
            >
              {branches.map((b) => (
                <option key={b.id} value={b.code}>
                  {b.name} ({b.code})
                </option>
              ))}
            </Select>
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
      </Modal>

      {/* Modal: Clave Secreta Generada (Solo visible una vez) */}
      <Modal
        isOpen={Boolean(secretKey)}
        onClose={dismissSecretKeyModal}
        title="¡API Key Generada con Éxito!"
        subtitle={secretKey ? `Asignada a "${secretKey.name}" (${secretKey.branch} / ${secretKey.pointOfSale})` : undefined}
        icon="✓"
        footer={
          <Button size="sm" onClick={dismissSecretKeyModal}>
            Entendido y Guardado
          </Button>
        }
      >
        {secretKey && (
          <div class="space-y-4">
            <div class="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-xs text-amber-700 dark:text-amber-300 leading-relaxed flex items-start gap-2.5">
              <span class="text-lg">⚠️</span>
              <span>
                <strong>Copia esta clave ahora:</strong> Por seguridad, esta es la única vez que se mostrará la clave completa. No se almacenará en texto plano en la base de datos.
              </span>
            </div>

            <div>
              <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">Clave Secreta de Conexión</label>
              <div class="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={secretKey.rawKey}
                  class="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs text-emerald-600 dark:text-emerald-400 focus:outline-none"
                />
                <Button size="sm" onClick={() => { void copyToClipboard(secretKey.rawKey); }}>
                  Copiar
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
