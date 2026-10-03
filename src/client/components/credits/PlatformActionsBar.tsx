import { signal } from '@preact/signals';
import {
  registerPayment,
  grantCredits,
  voidCredit,
  extendGrace,
  registerRefund,
  changeHolder,
  fetchOwners,
  ownersSignal,
} from '../../state/platform-state.ts';
import { creditsSignal } from '../../state/credits-state.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import { argentinaToday, shiftDay } from '../../../shared/argentina-day.ts';
import { formatMoney } from '../../format.ts';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Select } from '../ui/Select.tsx';
import { Modal } from '../ui/Modal.tsx';
import type { GiftItem } from '../../../shared/credits-types.ts';

type ActionKind = 'payment' | 'grant' | 'grace' | 'refund' | 'holder' | 'void';

type Draft = {
  day: string;
  amount: string;
  info: string;
  expiresOn: string;
  reason: string;
  until: string;
  userId: string;
  creditId: string;
};

const openActionSignal = signal<ActionKind | null>(null);
const draftSignal = signal<Draft>(emptyDraft());
const actionErrorSignal = signal<string | null>(null);
const actionBusySignal = signal<boolean>(false);

function emptyDraft(): Draft {
  const today = argentinaToday(new Date());
  return { day: today, amount: '', info: '', expiresOn: shiftDay(today, 90), reason: '', until: '', userId: '', creditId: '' };
}

function openAction(kind: ActionKind, patch: Partial<Draft> = {}): void {
  draftSignal.value = { ...emptyDraft(), ...patch };
  actionErrorSignal.value = null;
  openActionSignal.value = kind;
  if (kind === 'holder') void fetchOwners();
}

function closeAction(): void {
  openActionSignal.value = null;
}

function setDraft(patch: Partial<Draft>): void {
  draftSignal.value = { ...draftSignal.value, ...patch };
}

/** Un importe entero y positivo, o `null`. */
function parseAmount(text: string): number | null {
  const n = Number(text);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function optional(text: string): string | undefined {
  const t = text.trim();
  return t === '' ? undefined : t;
}

async function submit(): Promise<void> {
  const kind = openActionSignal.value;
  const d = draftSignal.value;
  if (kind === null) return;
  const needsAmount = kind === 'payment' || kind === 'grant' || kind === 'refund';
  const amount = parseAmount(d.amount);
  if (needsAmount && amount === null) {
    actionErrorSignal.value = 'El importe tiene que ser un número entero mayor que cero';
    return;
  }
  if (kind === 'grace' && d.until === '') {
    actionErrorSignal.value = 'Elegí la nueva fecha límite';
    return;
  }
  if (kind === 'holder' && d.userId === '') {
    actionErrorSignal.value = 'Elegí el nuevo titular';
    return;
  }
  if (kind === 'void' && d.reason.trim() === '') {
    actionErrorSignal.value = 'Contá por qué se anulan';
    return;
  }
  actionErrorSignal.value = null;
  actionBusySignal.value = true;
  const ok = await run(kind, d, amount ?? 0).finally(() => {
    actionBusySignal.value = false;
  });
  if (ok) closeAction();
}

function run(kind: ActionKind, d: Draft, amount: number): Promise<boolean> {
  switch (kind) {
    case 'payment':
      return registerPayment({ day: d.day, amount, info: optional(d.info) });
    case 'grant':
      return grantCredits({ amount, expiresOn: d.expiresOn, reason: optional(d.reason) });
    case 'grace':
      return extendGrace(d.until);
    case 'refund':
      return registerRefund({ amount, info: optional(d.info) });
    case 'holder':
      return changeHolder(d.userId);
    case 'void':
      return voidCredit(d.creditId, d.reason.trim());
  }
}

const TITLES: Record<ActionKind, { title: string; subtitle: string; submit: string }> = {
  payment: { title: 'Registrar pago', subtitle: 'Se acredita como saldo pagado; primero cancela la deuda.', submit: 'Registrar' },
  grant: { title: 'Otorgar créditos', subtitle: 'Créditos regalados, con vencimiento.', submit: 'Otorgar' },
  grace: { title: 'Extender gracia', subtitle: 'Hasta esa fecha el comercio no se restringe por deuda.', submit: 'Extender' },
  refund: { title: 'Devolución', subtitle: 'Sale del saldo pagado.', submit: 'Registrar devolución' },
  holder: { title: 'Cambiar titular', subtitle: 'El titular es dueño del saldo pagado.', submit: 'Cambiar' },
  void: { title: 'Anular créditos', subtitle: 'El remanente deja de estar disponible.', submit: 'Anular' },
};

function ActionFields(props: { kind: ActionKind }) {
  const d = draftSignal.value;
  const paidBalance = creditsSignal.value?.paidBalance ?? 0;
  switch (props.kind) {
    case 'payment':
      return (
        <>
          <Input label="Fecha del pago" type="date" value={d.day} onInput={(e) => { setDraft({ day: e.currentTarget.value }); }} />
          <Input label="Importe" type="number" min="1" step="1" value={d.amount} onInput={(e) => { setDraft({ amount: e.currentTarget.value }); }} />
          <Input label="Info (opcional)" value={d.info} placeholder="Número de operación, banco…" onInput={(e) => { setDraft({ info: e.currentTarget.value }); }} />
        </>
      );
    case 'grant':
      return (
        <>
          <Input label="Importe" type="number" min="1" step="1" value={d.amount} onInput={(e) => { setDraft({ amount: e.currentTarget.value }); }} />
          <Input label="Vence" type="date" value={d.expiresOn} onInput={(e) => { setDraft({ expiresOn: e.currentTarget.value }); }} />
          <Input label="Motivo (opcional)" value={d.reason} onInput={(e) => { setDraft({ reason: e.currentTarget.value }); }} />
        </>
      );
    case 'grace':
      return <Input label="Nueva fecha límite" type="date" value={d.until} onInput={(e) => { setDraft({ until: e.currentTarget.value }); }} />;
    case 'refund':
      return (
        <>
          <Input
            label="Importe"
            type="number"
            min="1"
            max={String(paidBalance)}
            step="1"
            value={d.amount}
            helperText={`Saldo pagado disponible: ${formatMoney(paidBalance)}`}
            onInput={(e) => { setDraft({ amount: e.currentTarget.value }); }}
          />
          <Input label="Info (opcional)" value={d.info} onInput={(e) => { setDraft({ info: e.currentTarget.value }); }} />
        </>
      );
    case 'holder':
      return (
        <Select label="Nuevo titular" value={d.userId} onChange={(e) => { setDraft({ userId: e.currentTarget.value }); }}>
          <option value="">Elegí un owner…</option>
          {ownersSignal.value.map((m) => (
            <option key={m.userId} value={m.userId}>
              {m.name} ({m.email})
            </option>
          ))}
        </Select>
      );
    case 'void':
      return <Input label="Motivo" value={d.reason} onInput={(e) => { setDraft({ reason: e.currentTarget.value }); }} />;
  }
}

function ActionModal() {
  const kind = openActionSignal.value;
  if (kind === null) return null;
  const t = TITLES[kind];
  const error = actionErrorSignal.value;
  return (
    <Modal
      isOpen
      onClose={closeAction}
      title={t.title}
      subtitle={t.subtitle}
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={closeAction}>
            Cancelar
          </Button>
          <Button variant={kind === 'void' || kind === 'refund' ? 'danger' : 'primary'} loading={actionBusySignal.value} onClick={() => void submit()}>
            {t.submit}
          </Button>
        </>
      }
    >
      <form
        class="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <ActionFields kind={kind} />
        {error !== null && <p class="text-xs text-rose-500 dark:text-rose-400 font-medium">{error}</p>}
      </form>
    </Modal>
  );
}

/** El botón Anular de un crédito regalado vigente, en la solapa Regalados. */
export function GiftVoidAction(props: { gift: GiftItem }) {
  if (props.gift.status !== 'active') return null;
  return (
    <Button size="sm" variant="outline" onClick={() => { openAction('void', { creditId: props.gift.id }); }}>
      Anular
    </Button>
  );
}

/** Acciones de root y soporte sobre el comercio que se impersona (#21), en su pantalla Créditos. */
export function PlatformActionsBar() {
  const isRoot = currentUserSignal.value?.globalRole === 'root';
  // El modal va fuera del Card: su backdrop-blur haría que el fixed del modal se mida contra la tarjeta
  return (
    <>
      <Card class="space-y-3 border-amber-300 dark:border-amber-500/30">
        <h3 class="text-sm font-bold text-amber-700 dark:text-amber-300">Acciones de plataforma</h3>
        <div class="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => { openAction('payment'); }}>
            Registrar pago
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { openAction('grant'); }}>
            Otorgar créditos
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { openAction('grace'); }}>
            Extender gracia
          </Button>
          {isRoot && (
            <Button size="sm" variant="secondary" onClick={() => { openAction('refund'); }}>
              Devolución
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => { openAction('holder'); }}>
            Cambiar titular
          </Button>
        </div>
      </Card>
      <ActionModal />
    </>
  );
}
