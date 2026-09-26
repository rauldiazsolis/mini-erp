import {
  blockModalOpenSignal,
  targetProductToBlockSignal,
  blockReasonSignal,
  closeBlockModal,
  confirmToggleBlock,
} from '../../state/catalog-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Modal } from '../ui/Modal.tsx';

export function BlockProductModal() {
  const isOpen = blockModalOpenSignal.value;
  const target = targetProductToBlockSignal.value;
  if (!target) return null;

  const isCurrentlyBlocked = Boolean(target.blockedReason);

  return (
    <Modal
      isOpen={isOpen}
      onClose={closeBlockModal}
      title={isCurrentlyBlocked ? 'Desbloquear Producto' : 'Bloquear Producto'}
      subtitle={
        isCurrentlyBlocked
          ? 'El artículo volverá a estar disponible para venta en el POS'
          : 'El artículo no podrá venderse en las terminales POS'
      }
      icon={<span>{isCurrentlyBlocked ? '🔓' : '🔒'}</span>}
      maxWidth="md"
    >
      <div class="space-y-4">
        <div class="bg-slate-50 dark:bg-slate-950/60 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 space-y-1 text-xs">
          <div class="font-bold text-slate-900 dark:text-white">{target.name}</div>
          <div class="text-slate-500 dark:text-slate-400 font-mono">
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
          <div class="text-xs text-slate-700 dark:text-slate-300">
            Actualmente bloqueado por:{' '}
            <strong class="text-rose-600 dark:text-rose-400 font-medium">"{target.blockedReason}"</strong>. Al desbloquearlo,
            se sincronizará inmediatamente con el POS en el próximo pull.
          </div>
        )}

        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-2.5">
          <Button variant="outline" size="sm" onClick={closeBlockModal}>
            Cancelar
          </Button>
          <Button
            size="sm"
            onClick={() => { void confirmToggleBlock(); }}
            class={isCurrentlyBlocked ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'}
          >
            {isCurrentlyBlocked ? 'Confirmar Desbloqueo' : 'Confirmar Bloqueo'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
