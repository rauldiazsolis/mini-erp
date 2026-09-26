import {
  connectorInfoSignal,
  connectorCheckingSignal,
  checkConnectorStatus,
} from '../../state/settings-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';
import { Card } from '../ui/Card.tsx';

export function ConnectorGuideSection() {
  const info = connectorInfoSignal.value;
  const isChecking = connectorCheckingSignal.value;

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:4100';
  const connectorUrl = `${origin}/connector`;

  const copyUrl = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(connectorUrl);
        showToast({
          type: 'success',
          title: 'URL Copiada',
          message: 'URL del Connector copiada al portapapeles',
        });
      }
    } catch {
      showToast({ type: 'error', title: 'Error', message: 'No se pudo copiar' });
    }
  };

  return (
    <div class="space-y-6">
      {/* Tarjeta de Estado del Connector */}
      <Card class="space-y-4">
        <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h3 class="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <span>🔌 Estado de la API de Sincronización POS</span>
              <span class="px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 text-[10px] font-mono font-bold">
                Contrato v4.0.0
              </span>
            </h3>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Protocolo bidireccional idempotente para terminales de venta con soporte offline
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={checkConnectorStatus}
            disabled={isChecking}
          >
            {isChecking ? 'Verificando...' : 'Probar Endpoint (/connector/info) ⚡'}
          </Button>
        </div>

        {/* URL del Connector */}
        <div class="pt-2">
          <label class="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
            URL Base del Connector para terminales POS
          </label>
          <div class="flex items-center gap-2 max-w-xl">
            <input
              type="text"
              readOnly
              value={connectorUrl}
              class="flex-1 px-3.5 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl font-mono text-xs text-indigo-600 dark:text-indigo-300 focus:outline-none"
            />
            <Button size="sm" onClick={copyUrl}>
              Copiar
            </Button>
          </div>
        </div>

        {/* Resultado del Ping */}
        {info && (
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 flex items-center gap-4 text-xs animate-in fade-in duration-150">
            <div class="w-3 h-3 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50 animate-pulse"></div>
            <div>
              <span class="text-slate-900 dark:text-white font-bold">Conexión Verificada: </span>
              <span class="text-slate-500 dark:text-slate-400">
                Versión: <strong class="text-emerald-600 dark:text-emerald-400 font-mono">{info.version}</strong> • Estado:{' '}
                <strong class="text-emerald-600 dark:text-emerald-400 font-mono uppercase">{info.status}</strong> • Verificado a las{' '}
                {info.checkedAt}
              </span>
            </div>
          </div>
        )}
      </Card>

      {/* Pasos de Configuración en el POS */}
      <Card class="space-y-4">
        <h4 class="text-sm font-bold text-slate-900 dark:text-white">¿Cómo vincular tu caja registradora Offline POS?</h4>

        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <div class="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              1
            </div>
            <div class="font-bold text-slate-900 dark:text-white">Ingresar al POS</div>
            <p class="text-slate-500 dark:text-slate-400 leading-relaxed">
              En tu aplicación Offline POS (desktop, web o tablet), abre la pantalla de <strong>Configuración de Sincronización</strong>.
            </p>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <div class="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              2
            </div>
            <div class="font-bold text-slate-900 dark:text-white">Pegar Credenciales</div>
            <p class="text-slate-500 dark:text-slate-400 leading-relaxed">
              Pega la <strong>URL del Connector</strong> y la <strong>API Key</strong> generada en la pestaña anterior para la sucursal de esta caja.
            </p>
          </div>

          <div class="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 space-y-2 text-xs">
            <div class="w-7 h-7 rounded-lg bg-indigo-50 dark:bg-indigo-600/20 text-indigo-600 dark:text-indigo-400 flex items-center justify-center font-bold">
              3
            </div>
            <div class="font-bold text-slate-900 dark:text-white">Sincronización Inmediata</div>
            <p class="text-slate-500 dark:text-slate-400 leading-relaxed">
              El POS descargará la foto completa del catálogo, existencias y cuentas. Al vender offline, el POS encolará las transacciones y las enviará en lote automáticamente.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
