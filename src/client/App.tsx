import {
  isAuthenticatedSignal,
  tokenSignal,
  currentUserSignal,
  fetchProfile,
  activeTenantSignal,
} from './state/auth-state.ts';
import { activeViewSignal } from './state/navigation-state.ts';
import { AuthView } from './components/auth/AuthView.tsx';
import { AppShell } from './components/shell/AppShell.tsx';
import { DashboardView } from './components/dashboard/DashboardView.tsx';
import { CatalogView } from './components/catalog/CatalogView.tsx';
import { Card, CardHeader } from './components/ui/Card.tsx';

// Cargar perfil al inicializar si hay un token persistido
if (typeof window !== 'undefined' && tokenSignal.value && !currentUserSignal.value) {
  fetchProfile();
}

export function App() {
  if (!isAuthenticatedSignal.value) {
    return <AuthView />;
  }

  const currentView = activeViewSignal.value;

  return (
    <AppShell>
      {/* Vista de Navegación Activa */}
      {currentView === 'dashboard' && <DashboardView />}

      {currentView === 'catalog' && <CatalogView />}

      {currentView === 'stock' && (
        <Card>
          <CardHeader
            title="Stock Multi-Sucursal & Kardex"
            description="Control de existencias por sucursal, ajustes auditados e historial cronológico."
          />
          <div class="py-12 text-center text-xs text-slate-400">
            Vista de stock y auditoría de Kardex.
          </div>
        </Card>
      )}

      {currentView === 'customers' && (
        <Card>
          <CardHeader
            title="Clientes & Cuentas Corrientes"
            description="Gestión de saldos, límites de crédito, extractos y cobranzas."
          />
          <div class="py-12 text-center text-xs text-slate-400">
            Vista de cuentas corrientes y clientes.
          </div>
        </Card>
      )}

      {currentView === 'bulk' && (
        <Card>
          <CardHeader
            title="Operaciones Masivas"
            description="Actualización porcentual de precios, devengamiento de intereses e importación/exportación."
          />
          <div class="py-12 text-center text-xs text-slate-400">
            Módulo de operaciones masivas y wizards.
          </div>
        </Card>
      )}

      {currentView === 'settings' && (
        <Card>
          <CardHeader
            title="Configuración & Terminales POS"
            description="Gestión de API Keys para cajas, terminales y puntos de venta."
          />
          <div class="py-12 text-center text-xs text-slate-400">
            Módulo de llaves de conexión del POS.
          </div>
        </Card>
      )}
    </AppShell>
  );
}
