import {
  accountDrawerOpenSignal,
  accountTargetCustomerSignal,
  accountMovementsSignal,
  accountLoadingSignal,
  closeAccountStatement,
  openPaymentModal,
} from '../../state/customer-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';
import { Button } from '../ui/Button.tsx';
import { Drawer } from '../ui/Drawer.tsx';

function formatDateTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleString('es-AR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export function AccountStatementDrawer() {
  const isOpen = accountDrawerOpenSignal.value;
  const customer = accountTargetCustomerSignal.value;
  if (!isOpen || !customer) return null;

  const movements = accountMovementsSignal.value;
  const isLoading = accountLoadingSignal.value;

  return (
    <Drawer
      isOpen={isOpen}
      onClose={closeAccountStatement}
      title="Extracto de Cuenta Corriente"
      subtitle={`${customer.name}${customer.document ? ` (${customer.document})` : ''}`}
      icon={<span>📜</span>}
      maxWidth="max-w-2xl"
    >
      <div class="space-y-4">
        {/* Tarjeta de Saldo Actual */}
        <div class="p-4 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200 dark:border-slate-800/80 flex items-center justify-between text-xs">
          <div>
            <span class="text-slate-500 dark:text-slate-400">Límite asignado: </span>
            <strong class="text-slate-800 dark:text-slate-200 font-mono">
              {customer.unrestricted ? 'Sin límite' : formatCurrency(customer.creditLimit)}
            </strong>
          </div>
          <div class="flex items-center gap-2">
            <span class="text-slate-500 dark:text-slate-400">Saldo Actual:</span>
            <span
              class={`px-2.5 py-0.5 rounded-full font-mono text-xs font-bold ${
                customer.balance > 0
                  ? 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                  : 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
              }`}
            >
              {formatCurrency(customer.balance)}
            </span>
          </div>
        </div>

        {/* Lista de Movimientos */}
        <div class="space-y-3">
          {isLoading ? (
            <div class="py-16 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
              <div class="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
              <div>Consultando extracto contable...</div>
            </div>
          ) : movements.length === 0 ? (
            <div class="py-16 text-center text-xs text-slate-500">
              No hay movimientos registrados en la cuenta corriente de este cliente.
            </div>
          ) : (
            movements.map((m) => {
              const isCredit = m.amount < 0 || m.type === 'payment' || m.type === 'credit_adjustment';
              const isDebit = m.amount > 0 && m.type !== 'payment';

              return (
                <div
                  key={m.id}
                  class="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800/80 hover:border-slate-300 dark:hover:border-slate-700 transition-colors flex items-start justify-between gap-4"
                >
                  <div class="space-y-1">
                    <div class="flex items-center gap-2">
                      <span
                        class={`inline-block px-2 py-0.5 rounded-md font-mono font-bold text-xs ${
                          isCredit
                            ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                            : isDebit
                            ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                        }`}
                      >
                        {m.amount > 0 ? `+${formatCurrency(m.amount)}` : formatCurrency(m.amount)}
                      </span>

                      <span class="text-xs font-semibold text-slate-900 dark:text-white capitalize">
                        {m.type === 'payment'
                          ? 'Pago / Cobranza'
                          : m.type === 'sale'
                          ? 'Compra en POS (Cuenta Corriente)'
                          : m.type.replace(/_/g, ' ')}
                      </span>

                      {m.saleId && (
                        <span class="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-mono border border-indigo-500/20">
                          Venta #{m.saleId.slice(0, 8)}
                        </span>
                      )}
                    </div>

                    {m.description && (
                      <p class="text-xs text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 mt-1">
                        {m.description}
                      </p>
                    )}

                    <div class="text-[11px] text-slate-500 dark:text-slate-400 pt-0.5">
                      Saldo resultante: <strong class="text-slate-800 dark:text-slate-200 font-mono">{formatCurrency(m.balanceAfter)}</strong>
                    </div>
                  </div>

                  <div class="text-right shrink-0">
                    <div class="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                      {formatDateTime(m.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div class="pt-4 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            {customer.balance > 0 && (
              <Button
                size="sm"
                onClick={() => {
                  closeAccountStatement();
                  openPaymentModal(customer);
                }}
                class="bg-emerald-600 hover:bg-emerald-500 text-white"
              >
                Cobrar Deuda 💵
              </Button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={closeAccountStatement}>
            Cerrar Extracto
          </Button>
        </div>
      </div>
    </Drawer>
  );
}
