import {
  accessText,
  helpMessageSignal,
  helpModalOpenSignal,
  helpSendingSignal,
  sendHelpRequest,
  supportAccessSignal,
} from '../../state/help-state.ts';
import { HELP_MESSAGE_MAX } from '../../../shared/help-types.ts';
import { formatTime } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';

const close = (): void => {
  helpModalOpenSignal.value = false;
};

/** "Pedir ayuda" (#23): el pedido por WhatsApp, el pedido abierto y los accesos de soporte de 7 días. */
export function HelpModal() {
  if (!helpModalOpenSignal.value) return null;
  const access = supportAccessSignal.value;
  const open = access?.openRequest ?? null;
  const now = new Date();
  return (
    <Modal
      isOpen
      onClose={close}
      title="Pedir ayuda"
      subtitle="Le escribís a soporte por WhatsApp con un link a esta pantalla. Soporte entra a tu cuenta para verla como vos."
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cerrar
          </Button>
          <Button loading={helpSendingSignal.value} onClick={() => void sendHelpRequest()}>
            Escribir a soporte por WhatsApp
          </Button>
        </>
      }
    >
      <div class="space-y-4">
        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-200">
          ¿En qué te ayudamos? (opcional)
          <textarea
            rows={3}
            maxLength={HELP_MESSAGE_MAX}
            value={helpMessageSignal.value}
            onInput={(e) => {
              helpMessageSignal.value = e.currentTarget.value;
            }}
            class="mt-1 w-full px-3.5 py-2.5 bg-white dark:bg-slate-900/90 border border-slate-300 dark:border-slate-800 rounded-xl text-sm font-normal text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </label>
        {open !== null && (
          <p class="text-xs text-slate-600 dark:text-slate-300">
            Tenés un pedido abierto hasta las {formatTime(open.expiresAt)}. Uno nuevo lo reemplaza.
          </p>
        )}
        <div class="space-y-1">
          <h3 class="text-xs font-bold text-slate-700 dark:text-slate-200">Accesos de soporte de los últimos 7 días</h3>
          {access === null || access.accesses.length === 0 ? (
            <p class="text-xs text-slate-500 dark:text-slate-400">Soporte no entró a tu cuenta.</p>
          ) : (
            <ul class="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
              {access.accesses.map((a) => (
                <li key={`${a.at}-${a.staffName}`}>{accessText(a, now)}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
