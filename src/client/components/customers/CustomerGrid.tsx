import {
  filteredCustomersSignal,
  customerLoadingSignal,
  openEditCustomerModal,
  openPaymentModal,
  openBalanceAdjustModal,
  openAccountStatement,
} from '../../state/customer-state.ts';
import { formatCurrency } from '../../state/dashboard-state.ts';
import {
  TableContainer,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableEmptyState,
} from '../ui/Table.tsx';

export function CustomerGrid() {
  const customers = filteredCustomersSignal.value;
  const isLoading = customerLoadingSignal.value;

  if (isLoading && customers.length === 0) {
    return (
      <TableContainer>
        <div class="p-12 text-center text-xs text-slate-500 dark:text-slate-400 space-y-3">
          <div class="w-8 h-8 border-2 border-indigo-600 dark:border-indigo-400 border-t-transparent rounded-full animate-spin mx-auto"></div>
          <div>Cargando listado de clientes y cuentas corrientes...</div>
        </div>
      </TableContainer>
    );
  }

  if (customers.length === 0) {
    return (
      <TableContainer>
        <TableEmptyState
          icon="👥"
          message="No se encontraron clientes"
          submessage="Prueba cambiando el filtro de búsqueda o el estado de deudores."
        />
      </TableContainer>
    );
  }

  return (
    <TableContainer>
      <Table>
        <Thead>
          <tr>
            <Th class="min-w-[180px]">Cliente / Razón Social</Th>
            <Th class="w-32">Documento</Th>
            <Th class="w-32">Teléfono</Th>
            <Th class="w-32 text-right">Límite Crédito</Th>
            <Th class="w-36 text-right">Saldo Cuenta Cte.</Th>
            <Th class="w-32 text-right">Crédito Disp.</Th>
            <Th class="w-28 text-center">Estado</Th>
            <Th class="w-36 text-right">Acciones</Th>
          </tr>
        </Thead>
        <Tbody>
          {customers.map((c) => {
            const isBlocked = Boolean(c.blockedReason);
            const isDebtor = c.balance > 0;
            const hasCredit = c.balance < 0;

            return (
              <Tr
                key={c.id}
                class={`group ${
                  isBlocked ? 'bg-rose-50/40 dark:bg-rose-950/10' : isDebtor ? 'bg-amber-50/30 dark:bg-amber-950/5' : ''
                }`}
              >
                {/* Nombre */}
                <Td>
                  <div class="font-semibold text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-200 transition-colors">
                    {c.name}
                  </div>
                  {c.unrestricted && (
                    <span class="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono">Crédito Ilimitado</span>
                  )}
                </Td>

                {/* Documento */}
                <Td class="font-mono text-[11px] text-slate-600 dark:text-slate-300">
                  {c.document ?? <span class="text-slate-400 dark:text-slate-600">--</span>}
                </Td>

                {/* Teléfono */}
                <Td class="text-slate-600 dark:text-slate-300">
                  {c.phone ?? <span class="text-slate-400 dark:text-slate-600">--</span>}
                </Td>

                {/* Límite de Crédito */}
                <Td class="text-right font-mono text-slate-700 dark:text-slate-300">
                  {c.unrestricted ? 'Sin límite' : formatCurrency(c.creditLimit)}
                </Td>

                {/* Saldo en Cuenta Corriente */}
                <Td class="text-right font-mono font-bold">
                  <span
                    class={`inline-block px-2.5 py-0.5 rounded-lg text-xs ${
                      isDebtor
                        ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30'
                        : hasCredit
                        ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                        : 'text-slate-500 dark:text-slate-400'
                    }`}
                  >
                    {formatCurrency(c.balance)}
                  </span>
                </Td>

                {/* Crédito Disponible */}
                <Td class="text-right font-mono">
                  {c.unrestricted ? (
                    <span class="text-indigo-600 dark:text-indigo-400 font-sans text-[11px]">Total</span>
                  ) : c.availableCredit !== null ? (
                    <span class={c.availableCredit <= 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : 'text-slate-700 dark:text-slate-300'}>
                      {formatCurrency(c.availableCredit)}
                    </span>
                  ) : (
                    <span class="text-slate-400">--</span>
                  )}
                </Td>

                {/* Estado */}
                <Td class="text-center">
                  {isBlocked ? (
                    <span
                      class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30"
                      title={c.blockedReason ?? 'Bloqueado'}
                    >
                      Bloqueado
                    </span>
                  ) : isDebtor ? (
                    <span class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                      Deudor
                    </span>
                  ) : (
                    <span class="inline-block px-2 py-0.5 rounded-full font-medium text-[10px] bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
                      Al día
                    </span>
                  )}
                </Td>

                {/* Acciones */}
                <Td class="text-right">
                  <div class="flex items-center justify-end gap-1.5 opacity-80 group-hover:opacity-100 transition-opacity">
                    {/* Cobranza */}
                    <button
                      type="button"
                      onClick={() => { openPaymentModal(c); }}
                      title="Registrar pago / cobranza"
                      class="p-1.5 text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <span class="text-sm">💵</span>
                    </button>

                    {/* Ajuste de Saldo */}
                    <button
                      type="button"
                      onClick={() => { openBalanceAdjustModal(c); }}
                      title="Ajuste manual de saldo"
                      class="p-1.5 text-slate-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <span class="text-sm">⚖️</span>
                    </button>

                    {/* Extracto de Movimientos */}
                    <button
                      type="button"
                      onClick={() => { void openAccountStatement(c); }}
                      title="Ver extracto de movimientos"
                      class="p-1.5 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
                    >
                      <span class="text-sm">📜</span>
                    </button>

                    {/* Editar Datos */}
                    <button
                      type="button"
                      onClick={() => { openEditCustomerModal(c); }}
                      title="Editar datos de cliente"
                      class="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
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
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </TableContainer>
  );
}
