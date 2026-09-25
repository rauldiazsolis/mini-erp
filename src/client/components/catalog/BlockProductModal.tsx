import {
  blockModalOpenSignal,
  targetProductToBlockSignal,
  blockReasonSignal,
  closeBlockModal,
  confirmToggleBlock,
} from '../../state/catalog-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';

export function BlockProductModal() {
  if (!blockModalOpenSignal.value) return null;

  const target = targetProductToBlockSignal.value;
  if (!target) return null;

  const isCurrentlyBlocked = Boolean(target.blockedReason);

  return (
    <div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div class="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div class="p-5 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <div class="flex items-center gap-3">
            <div
              class={`w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-bold border ${
                isCurrentlyBlocked
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
              }`}
            >
              {isCurrentlyBlocked ? '🔓' : '🔒'}
            </div>
            <div>
              <h3 class="text-base font-bold text-white">
                {isCurrentlyBlocked ? 'Desbloquear Producto' : 'Bloquear Producto'}
              </h3>
              <p class="text-xs text-slate-400">
                {isCurrentlyBlocked
                  ? 'El artículo volverá a estar disponible para venta en el POS'
                  : 'El artículo no podrá venderse en las terminales POS'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={closeBlockModal}
            class="text-slate-400 hover:text-white transition-colors cursor-pointer p-1.5 rounded-xl hover:bg-slate-800"
          >
            <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div class="p-6 space-y-4">
          <div class="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800 space-y-1 text-xs">
            <div class="font-bold text-white">{target.name}</div>
            <div class="text-slate-400 font-mono">
              SKU: {target.sku} • Categoría: {target.category}
            </div>
          </div>

          {!isCurrentlyBlocked ? (
            <Input
              label="Motivo del bloqueo (opcional pero recomendado)"
              placeholder="Ej: Falta de stock de fábrica, Producto discontinuado..."
              value={blockReasonSignal.value}
              onInput={(e) => (blockReasonSignal.value = (e.target as HTMLInputElement).value)}
              autoFocus
            />
          ) : (
            <div class="text-xs text-slate-300">
              Actualmente bloqueado por:{' '}
              <strong class="text-rose-400 font-medium">"{target.blockedReason}"</strong>. Al desbloquearlo,
              se sincronizará inmediatamente con el POS en el próximo pull.
            </div>
          )}
        </div>

        {/* Footer */}
        <div class="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeBlockModal}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={confirmToggleBlock}
            class={isCurrentlyBlocked ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'}
          >
            {isCurrentlyBlocked ? 'Confirmar Desbloqueo' : 'Confirmar Bloqueo'}
          </Button>
        </div>
      </div>
    </div>
  );
}
