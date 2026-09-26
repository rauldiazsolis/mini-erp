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
import { PageHeader } from '../ui/PageHeader.tsx';

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
      {/* Encabezado con PageHeader */}
      <PageHeader
        title="Clientes & Cuentas Corrientes"
        badge="Gestión Financiera"
        description="Control de límites de crédito, registro de cobranzas manuales, ajustes contables y extractos cronológicos"
      />

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
