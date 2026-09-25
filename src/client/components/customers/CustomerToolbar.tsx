import {
  customerSearchSignal,
  customerDebtorsOnlySignal,
  customerBlockedFilterSignal,
  filteredCustomersSignal,
  customersSignal,
  customerLoadingSignal,
  fetchCustomers,
  openNewCustomerModal,
} from '../../state/customer-state.ts';
import { Button } from '../ui/Button.tsx';

export function CustomerToolbar() {
  const search = customerSearchSignal.value;
  const debtorsOnly = customerDebtorsOnlySignal.value;
  const blockedFilter = customerBlockedFilterSignal.value;
  const filteredCount = filteredCustomersSignal.value.length;
  const totalCount = customersSignal.value.length;
  const isLoading = customerLoadingSignal.value;

  return (
    <div class="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-3.5 shadow-sm">
      <div class="flex flex-col md:flex-row md:items-center justify-between gap-3">
        {/* Izquierda: Buscador */}
        <div class="relative flex-1 max-w-md">
          <svg
            class="w-4 h-4 absolute left-3.5 top-3 text-slate-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            type="text"
            placeholder="Buscar por nombre, DNI/CUIT o teléfono..."
            value={search}
            onInput={(e) => (customerSearchSignal.value = (e.target as HTMLInputElement).value)}
            class="w-full pl-10 pr-4 py-2 bg-slate-950/80 border border-slate-800 rounded-xl text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => (customerSearchSignal.value = '')}
              class="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* Derecha: Botón Nuevo Cliente y Refresco */}
        <div class="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchCustomers}
            disabled={isLoading}
            title="Recargar clientes"
            class="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
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

          <Button size="sm" onClick={openNewCustomerModal} class="shadow-md shadow-indigo-600/20">
            <svg class="w-4 h-4 mr-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Nuevo Cliente
          </Button>
        </div>
      </div>

      {/* Filtros secundarios: Solo Deudores, Estado y Conteo */}
      <div class="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs text-slate-400">
        <div class="flex flex-wrap items-center gap-3">
          {/* Toggle Solo Deudores */}
          <button
            type="button"
            onClick={() => (customerDebtorsOnlySignal.value = !debtorsOnly)}
            class={`px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
              debtorsOnly
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-xs'
                : 'bg-slate-950/60 text-slate-400 border-slate-800 hover:border-slate-700'
            }`}
          >
            <span>⚠️ Solo Deudores</span>
          </button>

          {/* Selector de Estado */}
          <div class="flex items-center gap-1.5">
            <span class="text-slate-500">Estado:</span>
            <div class="inline-flex rounded-lg p-0.5 bg-slate-950 border border-slate-800">
              <button
                type="button"
                onClick={() => (customerBlockedFilterSignal.value = 'all')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  blockedFilter === 'all' ? 'bg-indigo-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Todos
              </button>
              <button
                type="button"
                onClick={() => (customerBlockedFilterSignal.value = 'active')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  blockedFilter === 'active' ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Habilitados
              </button>
              <button
                type="button"
                onClick={() => (customerBlockedFilterSignal.value = 'blocked')}
                class={`px-2 py-0.5 rounded-md font-medium text-[11px] transition-colors cursor-pointer ${
                  blockedFilter === 'blocked' ? 'bg-rose-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                }`}
              >
                Bloqueados
              </button>
            </div>
          </div>
        </div>

        {/* Conteo */}
        <div class="text-slate-500 font-mono text-[11px]">
          Mostrando <strong class="text-slate-200">{filteredCount}</strong> de {totalCount} clientes
        </div>
      </div>
    </div>
  );
}
