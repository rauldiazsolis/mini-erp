import {
  filteredCustomersSignal,
  customerLoadingSignal,
  openEditCustomerModal,
  openPaymentModal,
  openBalanceAdjustModal,
  openAccountStatement,
} from '../../state/customer-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';

export function CustomerGrid() {
  const customers = filteredCustomersSignal.value;
  const isLoading = customerLoadingSignal.value;

  if (isLoading && customers.length === 0) {
    return (
      <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm">
        <div class="p-8 text-center text-xs text-slate-400 space-y-3">
          <div class="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div>Cargando listado de clientes y cuentas corrientes...</div>
        </div>
      </div>
    );
  }

  if (customers.length === 0) {
    return (
      <div class="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center shadow-sm">
        <div class="w-12 h-12 mx-auto rounded-2xl bg-slate-800/80 text-slate-400 flex items-center justify-center text-2xl mb-3">
          👥
        </div>
        <h4 class="text-sm font-bold text-white">No se encontraron clientes</h4>
        <p class="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
          Prueba cambiando el filtro de búsqueda o el estado de deudores.
        </p>
      </div>
    );
  }

  return (
    <div class="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-sm flex flex-col">
      <div class="overflow-x-auto">
        <table class="w-full text-left border-collapse text-xs">
          <thead>
            <tr class="bg-slate-950/80 border-b border-slate-800 text-[10px] uppercase font-bold tracking-wider text-slate-400 select-none">
              <th class="py-3 px-4 min-w-[180px]">Cliente / Razón Social</th>
              <th class="py-3 px-4 w-32">Documento</th>
              <th class="py-3 px-4 w-32">Teléfono</th>
              <th class="py-3 px-4 w-32 text-right">Límite Crédito</th>
              <th class="py-3 px-4 w-36 text-right">Saldo Cuenta Cte.</th>
              <th class="py-3 px-4 w-32 text-right">Crédito Disp.</th>
              <th class="py-3 px-4 w-28 text-center">Estado</th>
              <th class="py-3 px-4 w-36 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800/60 font-sans">
            {customers.map((c) => {
              const isBlocked = Boolean(c.blockedReason);
              const isDebtor = c.balance > 0;
              const hasCredit = c.balance < 0;

              return (
                <tr
                  key={c.id}
                  class={`hover:bg-slate-800/30 transition-colors group ${
                    isBlocked ? 'bg-rose-950/10' : isDebtor ? 'bg-amber-950/5' : ''
                  }`}
                >
                  {/* Nombre */}
                  <td class="py-3 px-4">
                    <div class="font-semibold text-white group-hover:text-indigo-200 transition-colors">
                      {c.name}
                    </div>
                    {c.unrestricted && (
                      <span class="text-[10px] text-indigo-400 font-mono">Crédito Ilimitado</span>
                    )}
                  </td>

                  {/* Documento */}
                  <td class="py-3 px-4 font-mono text-[11px] text-slate-300">
                    {c.document ?? <span class="text-slate-600">--</span>}
                  </td>

                  {/* Teléfono */}
                  <td class="py-3 px-4 text-slate-300">
                    {c.phone ?? <span class="text-slate-600">--</span>}
                  </td>

                  {/* Límite de Crédito */}
                  <td class="py-3 px-4 text-right font-mono text-slate-300">
                    {c.unrestricted ? 'Sin límite' : formatCurrency(c.creditLimit)}
                  </td>

                  {/* Saldo en Cuenta Corriente */}
                  <td class="py-3 px-4 text-right font-mono font-bold">
                    <span
                      class={`inline-block px-2.5 py-0.5 rounded-lg text-xs ${
                        isDebtor
                          ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          : hasCredit
                          ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                          : 'text-slate-400'
                      }`}
                    >
                      {formatCurrency(c.balance)}
                    </span>
                  </td>

                  {/* Crédito Disponible */}
                  <td class="py-3 px-4 text-right font-mono text-slate-300">
                    {c.unrestricted ? (
                      <span class="text-indigo-400 font-sans text-[11px]">Total</span>
                    ) : c.availableCredit !== null ? (
                      <span class={c.availableCredit <= 0 ? 'text-rose-400 font-bold' : 'text-slate-300'}>
                        {formatCurrency(c.availableCredit)}
                      </span>
                    ) : (
                      '--'
                    )}
                  </td>

                  {/* Estado */}
                  <td class="py-3 px-4 text-center">
                    {isBlocked ? (
                      <span
                        class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-rose-500/15 text-rose-400 border border-rose-500/30"
                        title={c.blockedReason ?? 'Bloqueado'}
                      >
                        Bloqueado
                      </span>
                    ) : isDebtor ? (
                      <span class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30">
                        Deudor
                      </span>
                    ) : (
                      <span class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                        Al día
                      </span>
                    )}
                  </td>

                  {/* Acciones */}
                  <td class="py-3 px-4 text-right">
                    <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                      {/* Cobranza */}
                      <button
                        type="button"
                        onClick={() => openPaymentModal(c)}
                        title="Registrar pago / cobranza"
                        class="p-1.5 text-slate-400 hover:text-emerald-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <span class="text-sm">💵</span>
                      </button>

                      {/* Ajuste de Saldo */}
                      <button
                        type="button"
                        onClick={() => openBalanceAdjustModal(c)}
                        title="Ajuste manual de saldo"
                        class="p-1.5 text-slate-400 hover:text-amber-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <span class="text-sm">⚖️</span>
                      </button>

                      {/* Extracto de Movimientos */}
                      <button
                        type="button"
                        onClick={() => openAccountStatement(c)}
                        title="Ver extracto de movimientos"
                        class="p-1.5 text-slate-400 hover:text-indigo-400 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                      >
                        <span class="text-sm">📜</span>
                      </button>

                      {/* Editar Datos */}
                      <button
                        type="button"
                        onClick={() => openEditCustomerModal(c)}
                        title="Editar datos de cliente"
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
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
