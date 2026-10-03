import {
  registersSignal,
  registersLoadingSignal,
  createRegisterModalOpenSignal,
  createRegisterFormSignal,
  createRegisterErrorSignal,
  isCreatingRegisterSignal,
  revealedKeySignal,
  fetchRegisters,
  openCreateRegisterModal,
  closeCreateRegisterModal,
  submitCreateRegister,
  rotateRegisterKey,
  transferRegister,
  unbindRegister,
  deactivateRegister,
  dismissRevealedKey,
} from '../../state/registers-state.ts';
import { settingsBranchesSignal } from '../../state/settings-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { formatDateTime } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Card } from '../ui/Card.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Select } from '../ui/Select.tsx';
import type { RegisterItem } from '../../../shared/register-types.ts';

/** Los últimos 8 caracteres del id del equipo: alcanza para reconocerlo. */
function shortDevice(deviceId: string): string {
  return deviceId.length > 8 ? `…${deviceId.slice(-8)}` : deviceId;
}

async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ type: 'success', title: 'Copiada', message: 'La key quedó en el portapapeles' });
  } catch {
    showToast({ type: 'error', title: 'No se pudo copiar', message: 'Seleccionala y copiala a mano' });
  }
}

function RegisterCard(props: { item: RegisterItem }) {
  const r = props.item;
  return (
    <Card class={`space-y-3 ${r.active ? '' : 'opacity-60'}`}>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <h4 class="text-sm font-bold text-slate-900 dark:text-white truncate">{r.name}</h4>
            {!r.active && (
              <span class="px-2 py-0.5 rounded-full text-[10px] font-medium bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                Inactiva
              </span>
            )}
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            <span class="font-mono font-bold text-indigo-700 dark:text-indigo-300">{r.branch}</span> · {r.pointOfSale}
          </p>
        </div>
        {r.active && (
          <div class="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => void rotateRegisterKey(r)}>
              Rotar key
            </Button>
            {r.deviceId !== null && (
              <Button size="sm" variant="outline" onClick={() => void unbindRegister(r)}>
                Desligar equipo
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => void deactivateRegister(r)}>
              Desactivar
            </Button>
          </div>
        )}
      </div>

      <dl class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
        <div>
          <dt class="text-slate-500 dark:text-slate-400">Equipo</dt>
          <dd class="text-slate-800 dark:text-slate-200">
            {r.deviceId === null ? (
              'Sin equipo todavía: se liga el primero que la use'
            ) : (
              <>
                <span class="font-mono">{shortDevice(r.deviceId)}</span>
                {r.lastSeenAt !== null && <span class="text-slate-500 dark:text-slate-400"> · visto {formatDateTime(r.lastSeenAt)}</span>}
              </>
            )}
          </dd>
        </div>
        <div>
          <dt class="text-slate-500 dark:text-slate-400">Key activa</dt>
          <dd class="font-mono text-slate-800 dark:text-slate-200">{r.keyPrefix === null ? '—' : `${r.keyPrefix}••••••••`}</dd>
        </div>
      </dl>

      {r.active && r.otherDevices.length > 0 && (
        <div class="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-800 dark:text-amber-200 space-y-2">
          <p class="font-semibold">Otro equipo usó esta key: sus ventas se cobran aparte.</p>
          <ul class="space-y-1.5">
            {r.otherDevices.map((d) => (
              <li key={d.deviceId} class="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span class="font-mono">{shortDevice(d.deviceId)}</span> · visto {formatDateTime(d.lastSeenAt)}
                </span>
                <Button size="sm" variant="outline" onClick={() => void transferRegister(r, d.deviceId)}>
                  Pasar la caja a este equipo
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

/** Configuración → Cajas del POS (#21): cada caja con su equipo ligado y su key. */
export function RegistersSection() {
  const items = registersSignal.value;
  const isLoading = registersLoadingSignal.value;
  const form = createRegisterFormSignal.value;
  const error = createRegisterErrorSignal.value;
  const isCreating = isCreatingRegisterSignal.value;
  const revealed = revealedKeySignal.value;
  const branches = settingsBranchesSignal.value;

  return (
    <div class="space-y-4">
      <Card class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 class="text-base font-bold text-slate-900 dark:text-white">Cajas del POS</h3>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Cada caja se usa desde un solo equipo: si otro equipo usa su key, sus ventas se cobran aparte.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => void fetchRegisters()} disabled={isLoading}>
            {isLoading ? 'Cargando…' : 'Recargar'}
          </Button>
          <Button size="sm" onClick={openCreateRegisterModal}>
            Nueva caja
          </Button>
        </div>
      </Card>

      {items.length === 0 && !isLoading ? (
        <Card class="text-center text-xs text-slate-500 dark:text-slate-400 py-10">
          Todavía no hay cajas. Creá una para conectar el POS con mini contax.
        </Card>
      ) : (
        <div class="space-y-3">
          {items.map((item) => (
            <RegisterCard key={item.id} item={item} />
          ))}
        </div>
      )}

      <Modal
        isOpen={createRegisterModalOpenSignal.value}
        onClose={closeCreateRegisterModal}
        title="Nueva caja"
        subtitle="Genera la key para conectar un POS"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeCreateRegisterModal} disabled={isCreating}>
              Cancelar
            </Button>
            <Button size="sm" onClick={() => void submitCreateRegister()} disabled={isCreating}>
              {isCreating ? 'Creando…' : 'Crear caja'}
            </Button>
          </>
        }
      >
        <div class="space-y-4">
          {error !== null && (
            <div class="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl text-xs text-rose-700 dark:text-rose-300">{error}</div>
          )}
          <Input
            label="Nombre *"
            value={form.name}
            onInput={(e) => (createRegisterFormSignal.value = { ...form, name: e.currentTarget.value })}
            autoFocus
          />
          <Select
            label="Sucursal *"
            value={form.branch}
            onChange={(e) => (createRegisterFormSignal.value = { ...form, branch: e.currentTarget.value })}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.code}>
                {b.name} ({b.code})
              </option>
            ))}
          </Select>
          <Input
            label="Punto de venta *"
            value={form.pointOfSale}
            onInput={(e) => (createRegisterFormSignal.value = { ...form, pointOfSale: e.currentTarget.value })}
          />
        </div>
      </Modal>

      <Modal
        isOpen={revealed !== null}
        onClose={dismissRevealedKey}
        title="Key de la caja"
        subtitle={revealed === null ? undefined : revealed.registerName}
        footer={
          <Button size="sm" onClick={dismissRevealedKey}>
            Listo, la guardé
          </Button>
        }
      >
        {revealed !== null && (
          <div class="space-y-4">
            <p class="p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-800 dark:text-amber-200">
              Copiala ahora y cargala en el POS: es la única vez que se muestra completa.
            </p>
            <div class="flex items-center gap-2">
              <input
                type="text"
                readOnly
                value={revealed.rawKey}
                class="flex-1 min-w-0 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs text-emerald-600 dark:text-emerald-400"
              />
              <Button size="sm" onClick={() => void copyToClipboard(revealed.rawKey)}>
                Copiar
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
