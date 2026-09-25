import {
  fetchCustomers,
  customersSignal,
  customerLoadingSignal,
} from '../../state/customer-state.ts';
import { effectiveTenantIdSignal } from '../../state/auth-state.ts';
import { CustomerStatsBar } from './CustomerStatsBar.tsx';
import { CustomerToolbar } from './CustomerToolbar.tsx';
import { CustomerGrid } from './CustomerGrid.tsx';
import { CustomerModal } from './CustomerModal.tsx';
import { PaymentModal } from './PaymentModal.tsx';
import { BalanceAdjustModal } from './BalanceAdjustModal.tsx';
import { AccountStatementDrawer } from './AccountStatementDrawer.tsx';

let lastFetchedTenantId: string | null = null;

export function CustomerView() {
  const currentTenantId = effectiveTenantIdSignal.value;

  if (currentTenantId && currentTenantId !== lastFetchedTenantId) {
    lastFetchedTenantId = currentTenantId;
    fetchCustomers();
  } else if (currentTenantId && customersSignal.value.length === 0 && !customerLoadingSignal.value) {
    fetchCustomers();
  }

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      {/* Encabezado */}
      <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 class="text-2xl font-black text-white tracking-tight flex items-center gap-2.5">
            <span>Clientes & Cuentas Corrientes</span>
            <span class="text-xs px-2.5 py-0.5 rounded-full bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 font-bold uppercase tracking-wider">
              Gestión Financiera
            </span>
          </h1>
          <p class="text-xs text-slate-400 mt-1">
            Control de límites de crédito, registro de cobranzas manuales, ajustes contables y extractos cronológicos
          </p>
        </div>
      </div>

      {/* Tarjetas KPI de Estado de Cuenta y Deuda */}
      <CustomerStatsBar />

      {/* Barra de Filtros y Búsqueda */}
      <CustomerToolbar />

      {/* Grilla de Clientes */}
      <CustomerGrid />

      {/* Modales y Drawer */}
      <CustomerModal />
      <PaymentModal />
      <BalanceAdjustModal />
      <AccountStatementDrawer />
    </div>
  );
}
