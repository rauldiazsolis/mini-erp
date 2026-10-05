import { formatDateTime, formatDay, formatMoney } from '../../format.ts';
import { StatCard } from '../ui/StatCard.tsx';
import type { BillingSummary } from '../../../shared/credits-types.ts';

/** Las cuatro tarjetas de saldo de Uso y pagos (#21); también en el detalle de un comercio de la plataforma (#23). */
export function CreditsStats(props: { credits: BillingSummary }) {
  const { credits } = props;
  return (
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <StatCard
        title="Saldo pagado"
        value={formatMoney(credits.paidBalance)}
        subtitle="Es tuyo: si dejás de usar mini contax, te devolvemos lo que quede"
        variant="primary"
      />
      <StatCard
        title="Bonos"
        value={formatMoney(credits.giftBalance)}
        subtitle={credits.nextGiftExpiry === null ? 'Sin bonos vigentes' : `El próximo vence el ${formatDateTime(credits.nextGiftExpiry)}`}
        variant="success"
      />
      <StatCard
        title="Deuda"
        value={formatMoney(credits.debt)}
        subtitle={credits.deadline === null ? 'Sin deuda' : `Pagá antes del ${formatDay(credits.deadline)}`}
        variant={credits.debt > 0 ? 'danger' : 'default'}
      />
      <StatCard
        title="Te alcanza para"
        value={credits.daysCovered === null ? '—' : `${String(credits.daysCovered)} días`}
        subtitle={`Consumo diario estimado: ${formatMoney(credits.dailyBurn)}`}
        variant={credits.state === 'ok' ? 'default' : 'warning'}
      />
    </div>
  );
}
