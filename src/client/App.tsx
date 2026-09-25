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
  const activeTenant = activeTenantSignal.value;

  return (
    <AppShell>
      {/* Vista de Navegación Activa */}
      {currentView === 'dashboard' && (
        <div class="space-y-6">
          <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h2 class="text-2xl font-bold tracking-tight text-white">Dashboard Principal</h2>
              <p class="text-xs text-slate-400 mt-1">
                Resumen ejecutivo y métricas de rendimiento en tiempo real para{' '}
                <strong class="text-indigo-400">{activeTenant?.name ?? 'el comercio activo'}</strong>.
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card class="bg-gradient-to-br from-slate-900 to-indigo-950/40 border-indigo-500/20">
              <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Ventas de Hoy
              </span>
              <div class="text-2xl font-extrabold text-white tracking-tight">$42.850</div>
              <span class="text-[11px] text-emerald-400 font-medium flex items-center gap-1 mt-1">
                ↑ +14.2% vs ayer
              </span>
            </Card>

            <Card>
              <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Tickets Emitidos
              </span>
              <div class="text-2xl font-extrabold text-white tracking-tight">18</div>
              <span class="text-[11px] text-slate-500 mt-1 block">Operaciones registradas</span>
            </Card>

            <Card>
              <span class="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-1">
                Ticket Promedio
              </span>
              <div class="text-2xl font-extrabold text-indigo-400 tracking-tight">$2.380</div>
              <span class="text-[11px] text-slate-500 mt-1 block">Por compra en caja</span>
            </Card>

            <Card class="bg-gradient-to-br from-slate-900 to-amber-950/30 border-amber-500/20">
              <span class="text-xs font-semibold text-amber-400 uppercase tracking-wider block mb-1">
                Deuda en Cuenta Corriente
              </span>
              <div class="text-2xl font-extrabold text-amber-300 tracking-tight">$85.400</div>
              <span class="text-[11px] text-amber-400/80 font-medium mt-1 block">6 clientes con saldo</span>
            </Card>
          </div>

          <Card>
            <CardHeader
              title="App Shell & Navegación Integrada"
              description="Navegación responsiva, selector de comercio multitenant y modo impersonación para administradores activos."
            />
            <div class="p-4 rounded-xl bg-slate-950/60 border border-slate-800 text-xs text-slate-300 space-y-2">
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span><strong>Tenant Activo:</strong> {activeTenant?.name} (ID: {activeTenant?.tenantId})</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-indigo-400"></span>
                <span><strong>Rol del Operador:</strong> {currentUserSignal.value?.globalRole.toUpperCase()}</span>
              </div>
              <div class="flex items-center gap-2">
                <span class="w-2 h-2 rounded-full bg-purple-400"></span>
                <span><strong>Contrato POS:</strong> Connector API v4.0.0 activo y escuchando en /connector</span>
              </div>
            </div>
          </Card>
        </div>
      )}

      {currentView === 'catalog' && (
        <Card>
          <CardHeader
            title="Catálogo & Precios"
            description="Gestión centralizada de productos, códigos de barras, listas de precios y categorías."
          />
          <div class="py-12 text-center text-xs text-slate-400">
            Vista de catálogo (Grilla interactiva programada en la siguiente etapa).
          </div>
        </Card>
      )}

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
