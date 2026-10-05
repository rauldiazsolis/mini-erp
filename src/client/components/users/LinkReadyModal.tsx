import { linkReadySignal, linkShareText, whatsappShareUrl, currentTenantName, closeLinkReady } from '../../state/users-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';

/** El link de invitación o restablecimiento, una sola vez (#19): después ya no se puede ver. */
export function LinkReadyModal() {
  const link = linkReadySignal.value;
  if (link === null) return null;

  const close = closeLinkReady;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(link.url);
      showToast({ type: 'success', title: 'Copiado', message: 'El link quedó en el portapapeles' });
    } catch {
      showToast({ type: 'error', title: 'No se pudo copiar', message: 'Seleccioná el link y copialo a mano' });
    }
  };

  return (
    <Modal
      isOpen
      onClose={close}
      title={`Link listo para ${link.email}`}
      subtitle={link.kind === 'reset' ? 'Restablecer la contraseña' : link.kind === 'staff-invitation' ? 'Invitación al equipo de soporte' : 'Invitación a mini contax'}
      maxWidth="lg"
      footer={
        <div class="flex justify-end">
          <Button size="sm" onClick={close}>
            Listo
          </Button>
        </div>
      }
    >
      <div class="space-y-4">
        <input
          type="text"
          readOnly
          aria-label="Link"
          value={link.url}
          onFocus={(e) => { (e.target as HTMLInputElement).select(); }}
          class="w-full px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-indigo-600 dark:text-indigo-300 focus:outline-none"
        />
        <div class="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => { void copy(); }}>
            Copiar
          </Button>
          <a
            href={whatsappShareUrl(linkShareText(link, currentTenantName()))}
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center text-xs px-3 py-1.5 rounded-xl font-medium bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            Compartir por WhatsApp
          </a>
        </div>
        <p class="text-xs text-amber-700 dark:text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 leading-relaxed">
          Sirve una sola vez y vence en 48 h. No lo vas a poder ver de nuevo: si se pierde, generá otro.
        </p>
      </div>
    </Modal>
  );
}
