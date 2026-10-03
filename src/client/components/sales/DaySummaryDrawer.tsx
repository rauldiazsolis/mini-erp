import type { ComponentChildren } from 'preact';
import { PAYMENT_METHODS } from '../../../shared/payment-methods.ts';
import type { DayEntry } from '../../../shared/sales-types.ts';
import { formatDay, formatMoney, formatTime } from '../../format.ts';
import { KIND_LABELS, customerLabel, methodLabel } from '../../state/sales-labels.ts';
import { closeDaySummary, daySummarySignal, openTicket } from '../../state/sales-state.ts';
import { Drawer } from '../ui/Drawer.tsx';
import { amountClass } from './SaleBadges.tsx';

const METHODS = [...PAYMENT_METHODS, 'other'] as const;

function Row(props: { label: string; amount: number; strong?: boolean }) {
  return (
    <div class={`flex justify-between ${props.strong === true ? 'font-bold' : ''}`}>
      <span>{props.label}</span>
      <span class={amountClass(props.amount)}>{formatMoney(props.amount)}</span>
    </div>
  );
}

function Block(props: { title: string; children: ComponentChildren }) {
  return (
    <section class="space-y-1 p-3 rounded-xl border border-slate-200 dark:border-slate-800">
      <h3 class="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">{props.title}</h3>
      {props.children}
    </section>
  );
}

function entryText(e: DayEntry): { label: string; amount: number } {
  switch (e.kind) {
    case 'sale':
      return {
        label: `${KIND_LABELS[e.sale.kind]} ${e.sale.ticket === undefined ? '' : `#${String(e.sale.ticket.number)} `}· ${customerLabel(e.sale.customer)}`,
        amount: e.sale.total,
      };
    case 'movement':
      return {
        label: `${e.movement.direction === 'out' ? 'Egreso' : 'Ingreso'} · ${e.movement.concept}`,
        amount: e.movement.direction === 'out' ? -e.movement.amount : e.movement.amount,
      };
    case 'collection':
      return { label: `Cobranza · ${customerLabel(e.payment.customer)}`, amount: e.payment.total };
  }
}

function entryId(e: DayEntry): string {
  return e.kind === 'sale' ? e.sale.id : e.kind === 'movement' ? e.movement.id : e.payment.id;
}

/**
 * Los números del `/RESUMEN` del POS para una caja y un día, con sus mismos nombres, y los movimientos
 * del día (#20). "Neto del día" es de mini: el POS muestra el saldo de efectivo actual, que mini no
 * tiene (el arqueo sin diferencia no viaja).
 */
export function DaySummaryDrawer() {
  const data = daySummarySignal.value;
  const s = data?.summary;
  const cashNet = s === undefined ? 0 : s.cash.sales + s.cash.income - s.cash.expense + s.cash.countAdjustments + s.cash.collections;
  return (
    <Drawer isOpen={data !== null} onClose={closeDaySummary} title="Resumen del día" subtitle={data === null ? '' : formatDay(data.day)}>
      {data !== null && s !== undefined && (
        <div class="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <Block title="Ventas">
            <Row label="Total vendido" amount={s.totalSold} strong />
            <div class="flex justify-between">
              <span>Tickets emitidos</span>
              <span>
                {s.ticketCount}
                {s.voidedCount > 0 && ` (${String(s.voidedCount)} anuladas)`}
              </span>
            </div>
            <Row label="Desc/Recargos" amount={s.adjustmentTotal} />
            <Row label="Otros pagos" amount={s.otherPayments} />
          </Block>
          <Block title="Medios de pago">
            {METHODS.filter((m) => s.totalsByMethod[m] !== 0).map((m) => (
              <Row key={m} label={methodLabel(m)} amount={s.totalsByMethod[m]} />
            ))}
          </Block>
          <Block title="Efectivo">
            <Row label="Cobros" amount={s.cash.sales} />
            <Row label="Cobranzas" amount={s.cash.collections} />
            <Row label="Ingresos" amount={s.cash.income} />
            <Row label="Egresos" amount={-s.cash.expense} />
            <Row label="Ajustes por arqueo" amount={s.cash.countAdjustments} />
            <Row label="Neto del día" amount={cashNet} strong />
          </Block>
          <Block title="Cobranzas">
            <div class="flex justify-between font-bold">
              <span>
                Total
                {s.collections.count > 0 &&
                  ` (${String(s.collections.count)} recibos${s.collections.voidedCount > 0 ? `, ${String(s.collections.voidedCount)} anulados` : ''})`}
              </span>
              <span class={amountClass(s.collections.total)}>{formatMoney(s.collections.total)}</span>
            </div>
            {METHODS.filter((m) => s.collectionsByMethod[m] !== 0).map((m) => (
              <Row key={m} label={methodLabel(m)} amount={s.collectionsByMethod[m]} />
            ))}
          </Block>
          <Block title="Movimientos">
            {data.entries.length === 0 && <p class="text-slate-500">Sin movimientos.</p>}
            <ul class="divide-y divide-slate-100 dark:divide-slate-800">
              {data.entries.map((e) => {
                const { label, amount } = entryText(e);
                return (
                  <li key={entryId(e)} class="py-1.5 flex justify-between gap-3">
                    <span>
                      <span class="text-slate-400 mr-2">{formatTime(e.at)}</span>
                      {e.kind === 'sale' ? (
                        <button type="button" class="underline cursor-pointer" onClick={() => { void openTicket(e.sale.id); }}>
                          {label}
                        </button>
                      ) : (
                        label
                      )}
                    </span>
                    <span class={amountClass(amount)}>{formatMoney(amount)}</span>
                  </li>
                );
              })}
            </ul>
          </Block>
        </div>
      )}
    </Drawer>
  );
}
