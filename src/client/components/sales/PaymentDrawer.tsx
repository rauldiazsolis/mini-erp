import { formatDateTime, formatMoney } from '../../format.ts';
import { customerLabel, methodLabel, registerLabel } from '../../state/sales-labels.ts';
import { closePayment, openPayment, paymentDetailSignal, paymentsListSignal } from '../../state/sales-state.ts';
import { Drawer } from '../ui/Drawer.tsx';
import { SaleBadges, amountClass } from './SaleBadges.tsx';

const link = 'text-indigo-600 dark:text-indigo-400 font-semibold underline cursor-pointer';

export function PaymentDrawer() {
  const p = paymentDetailSignal.value;
  const inPage = (id: string | undefined): boolean => id !== undefined && (paymentsListSignal.value?.items.some((x) => x.id === id) ?? false);
  return (
    <Drawer
      isOpen={p !== null}
      onClose={closePayment}
      title={p === null ? '' : `${p.voidsPaymentId === undefined ? 'Cobranza' : 'Anulación de cobranza'} ${p.receipt === undefined ? 'sin número' : `#${String(p.receipt.number)}`}`}
      subtitle={p === null ? '' : `${formatDateTime(p.createdAt)} · ${registerLabel(p.branch, p.pointOfSale)}`}
    >
      {p !== null && (
        <div class="space-y-4 text-sm text-slate-700 dark:text-slate-300">
          <div class="flex flex-wrap items-center gap-2">
            <span>Cliente: <strong>{customerLabel(p.customer)}</strong></span>
            <SaleBadges voided={p.voided} isVoid={p.voidsPaymentId !== undefined} />
          </div>
          {p.voidsPaymentId !== undefined && (
            <p>Anula {inPage(p.voidsPaymentId) ? <button type="button" class={link} onClick={() => { openPayment(p.voidsPaymentId ?? ''); }}>la cobranza original</button> : 'una cobranza de otra página o de otro rango'}.</p>
          )}
          {p.voidedBy !== undefined && (
            <p>Anulada por {inPage(p.voidedBy) ? <button type="button" class={link} onClick={() => { openPayment(p.voidedBy ?? ''); }}>su anulación</button> : 'una cobranza de otra página o de otro rango'}.</p>
          )}
          <ul class="space-y-1">
            {p.payments.map((x, i) => (
              <li key={i} class="flex justify-between">
                <span>{methodLabel(x.method)}{x.reference === undefined ? '' : ` · ${x.reference}`}</span>
                <span class={amountClass(x.amount)}>{formatMoney(x.amount)}</span>
              </li>
            ))}
          </ul>
          <div class="flex justify-between font-bold"><span>Total</span><span class={amountClass(p.total)}>{formatMoney(p.total)}</span></div>
        </div>
      )}
    </Drawer>
  );
}
