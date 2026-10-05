import { signal } from '@preact/signals';
import { Modal } from '../ui/Modal.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { closeContact, contactDialogSignal, submitContact } from '../../state/funnel-public-state.ts';

const nameSignal = signal('');
const whatsappSignal = signal('');
const errorSignal = signal<string | null>(null);
const busySignal = signal(false);

async function send(): Promise<void> {
  busySignal.value = true;
  errorSignal.value = await submitContact({ name: nameSignal.value, whatsapp: whatsappSignal.value });
  busySignal.value = false;
}

function close(): void {
  errorSignal.value = null;
  closeContact();
}

/** "¿Querés que te ayudemos a empezar?" (#25): nombre y WhatsApp, y soporte escribe. */
export function ContactModal() {
  if (contactDialogSignal.value === null) return null;
  return (
    <Modal
      isOpen
      onClose={close}
      title="¿Querés que te ayudemos a empezar?"
      subtitle="Dejanos tu nombre y tu WhatsApp y te escribimos."
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button loading={busySignal.value} onClick={() => void send()}>
            Enviar
          </Button>
        </>
      }
    >
      <form
        class="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <Input
          label="Tu nombre"
          value={nameSignal.value}
          autocomplete="name"
          onInput={(e) => {
            nameSignal.value = e.currentTarget.value;
          }}
        />
        <Input
          label="WhatsApp"
          value={whatsappSignal.value}
          inputMode="tel"
          autocomplete="tel"
          placeholder="Ej: 11 5555-1234"
          onInput={(e) => {
            whatsappSignal.value = e.currentTarget.value;
          }}
        />
        {/* Enter en un campo manda el formulario: los botones están en el pie del modal */}
        <button type="submit" class="hidden" tabIndex={-1} aria-hidden="true" />
        {errorSignal.value !== null && (
          <p role="alert" class="text-xs text-rose-600 dark:text-rose-400">
            {errorSignal.value}
          </p>
        )}
      </form>
    </Modal>
  );
}
