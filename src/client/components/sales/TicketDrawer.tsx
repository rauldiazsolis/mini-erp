import { formatDateTime, formatMoney, formatQty } from '../../format.ts';
import { KIND_LABELS, customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { closeTicket, openTicket, ticketSignal } from '../../state/sales-state.ts';
import { Drawer } from '../ui/Drawer.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

const link = 'text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer';

/** El ticket completo (#20): líneas, subtotal, ajuste global, pagos y su anulación. */
export function TicketDrawer() {
  const t = ticketSignal.value;
  const title = t === null ? '' : `${KIND_LABELS[t.kind]} ${t.ticket === undefined ? 'sin número' : `#${String(t.ticket.number)}`}`;
  return (
    <Drawer
      isOpen={t !== null}
      onClose={closeTicket}
      title={title}
      subtitle={t === null ? '' : `${formatDateTime(t.createdAt)} · ${registerLabel(t.branch, t.pointOfSale)}`}
    >
      {t !== null && (
        <div class="space-y-5 text-sm text-slate-700 dark:text-slate-300">
          <div class="flex flex-wrap items-center gap-2">
            <span>Cliente: <strong>{customerLabel(t.customer)}</strong></span>
            <SaleBadges kind={t.kind} voided={t.voided} />
          </div>
          {t.voidsSaleId !== undefined && (
            <p>
              Anula el{' '}
              <button type="button" class={link} onClick={() => { openTicket(t.voidsSaleId ?? ''); }}>ticket original</button>
              . Motivo: {t.voidReason ?? 'sin motivo'}
            </p>
          )}
          {t.voidedBy !== undefined && (
            <p>
              Anulada por{' '}
              <button type="button" class={link} onClick={() => { openTicket(t.voidedBy ?? ''); }}>su anulación</button>
            </p>
          )}
          <table class="w-full text-left">
            <thead class="text-[11px] uppercase text-slate-500">
              <tr><th>Producto</th><th class="text-right">Cant.</th><th class="text-right">Precio</th><th class="text-right">Desc.</th><th class="text-right">Total</th></tr>
            </thead>
            <tbody>
              {t.lines.map((line, i) => (
                <tr key={i} class="border-t border-slate-100 dark:border-slate-800">
                  <td class="py-1.5">{line.name}</td>
                  <td class="text-right">{formatQty(line.qty)}</td>
                  <td class="text-right">{formatMoney(line.unitPrice)}</td>
                  <td class="text-right">
                    {line.discount === undefined ? '—' : line.discount.type === 'amount' ? formatMoney(line.discount.value) : `${formatQty(line.discount.value)} %`}
                  </td>
                  <td class={`text-right ${amountClass(line.total)}`}>{formatMoney(line.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl class="grid grid-cols-2 gap-y-1">
            <dt>Subtotal</dt><dd class="text-right">{formatMoney(t.subtotal)}</dd>
            <dt>Ajuste global</dt><dd class="text-right">{formatMoney(t.globalAdjustment)}</dd>
            <dt class="font-bold">Total</dt><dd class={`text-right font-bold ${amountClass(t.total)}`}>{formatMoney(t.total)}</dd>
          </dl>
          <div>
            <h3 class="text-xs font-bold uppercase text-slate-500 mb-1">Pagos</h3>
            <ul class="space-y-1">
              {t.payments.map((p, i) => (
                <li key={i} class="flex justify-between">
                  <span>{methodLabel(p.method)}{p.reference === undefined ? '' : ` · ${p.reference}`}</span>
                  <span class={amountClass(p.amount)}>{formatMoney(p.amount)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Drawer>
  );
}
