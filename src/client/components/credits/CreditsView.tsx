import {
  creditsSignal,
  chargesSignal,
  movementsSignal,
  giftsSignal,
  creditsTabSignal,
  chargesRangeSignal,
  fetchCharges,
  whatsappPayUrl,
  type CreditsTab,
} from '../../state/credits-state.ts';
import { activeTenantSignal, isRootOrSupportSignal } from '../../state/auth-state.ts';
import { showToast } from '../../state/toast-state.ts';
import { formatDateTime, formatDay, formatMoney } from '../../format.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { StatCard } from '../ui/StatCard.tsx';
import { Card } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Pagination } from '../ui/Pagination.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { PlatformActionsBar, GiftVoidAction } from './PlatformActionsBar.tsx';
import type { CreditMovementItem, GiftItem } from '../../../shared/credits-types.ts';

const TABS: Array<{ id: CreditsTab; label: string }> = [
  { id: 'charges', label: 'Consumo' },
  { id: 'movements', label: 'Movimientos' },
  { id: 'gifts', label: 'Regalados' },
];

const MOVEMENT_LABEL: Record<CreditMovementItem['kind'], string> = {
  payment: 'Pago',
  refund: 'Devolución',
  'debt-settlement': 'Deuda cancelada',
  'gift-granted': 'Créditos regalados',
  'gift-voided': 'Regalados anulados',
};

const GIFT_STATUS: Record<GiftItem['status'], string> = {
  active: 'Vigente',
  expired: 'Vencido',
  voided: 'Anulado',
  used: 'Usado',
};

async function copy(text: string, what: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    showToast({ type: 'success', title: 'Copiado', message: `${what} quedó en el portapapeles` });
  } catch {
    showToast({ type: 'error', title: 'No se pudo copiar', message: 'Seleccionalo y copialo a mano' });
  }
}

function CopyRow(props: { label: string; value: string }) {
  return (
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-[11px] text-slate-500 dark:text-slate-400">{props.label}</div>
        <div class="font-mono text-sm text-slate-900 dark:text-white break-all">{props.value}</div>
      </div>
      <Button size="sm" variant="outline" onClick={() => void copy(props.value, props.label)}>
        Copiar
      </Button>
    </div>
  );
}

function HowToPay() {
  const credits = creditsSignal.value;
  if (credits === null) return null;
  const info = credits.paymentInfo;
  const tenantName = activeTenantSignal.value?.name ?? 'mi comercio';
  const hasAccount = info.alias !== '' || info.cbu !== '';
  return (
    <Card class="space-y-3">
      <h3 class="text-sm font-bold text-slate-900 dark:text-white">Cómo pagar</h3>
      {hasAccount ? (
        <div class="space-y-3">
          {info.alias !== '' && <CopyRow label="Alias" value={info.alias} />}
          {info.cbu !== '' && <CopyRow label="CBU" value={info.cbu} />}
          {info.holder !== '' && <p class="text-xs text-slate-600 dark:text-slate-300">Titular de la cuenta: {info.holder}</p>}
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Transferí el importe que quieras. Cuando lo registremos, se acredita como saldo pagado; primero cancela la deuda.
          </p>
        </div>
      ) : (
        <p class="text-xs text-slate-500 dark:text-slate-400">Escribinos por WhatsApp para coordinar el pago.</p>
      )}
      {info.supportWhatsapp !== '' && (
        <a
          href={whatsappPayUrl({ phone: info.supportWhatsapp, tenantName })}
          target="_blank"
          rel="noopener noreferrer"
          class="inline-flex items-center justify-center px-3 py-2 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
        >
          Avisar por WhatsApp
        </a>
      )}
    </Card>
  );
}

function ChargesTab() {
  const page = chargesSignal.value;
  const range = chargesRangeSignal.value;
  const setRange = (next: { from: string; to: string }) => {
    chargesRangeSignal.value = next;
    void fetchCharges();
  };
  const items = page?.items ?? [];
  return (
    <div class="space-y-4">
      <Card class="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input label="Desde" type="date" value={range.from} onChange={(e) => { setRange({ ...range, from: e.currentTarget.value }); }} />
        <Input label="Hasta" type="date" value={range.to} onChange={(e) => { setRange({ ...range, to: e.currentTarget.value }); }} />
      </Card>
      <TableContainer>
        <div class="px-4 py-3 text-sm font-semibold text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800">
          {page === null ? 'Cargando…' : `${String(page.count)} ${page.count === 1 ? 'cargo' : 'cargos'} · Total ${formatMoney(page.total)}`}
        </div>
        {items.length === 0 ? (
          <TableEmptyState message="Sin cargos en el período" submessage="Se cobra un día por caja solo si esa caja vendió." />
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Día</Th>
                  <Th>Caja</Th>
                  <Th class="text-right">Importe</Th>
                  <Th class="text-right">Pagado</Th>
                  <Th class="text-right">Regalado</Th>
                  <Th class="text-right">Deuda</Th>
                </Tr>
              </Thead>
              <Tbody>
                {items.map((c) => (
                  <Tr key={c.id}>
                    <Td>{formatDay(c.day)}</Td>
                    <Td>{c.deviceId === null ? c.registerName : `${c.registerName} · otro equipo`}</Td>
                    <Td class="text-right font-semibold">{formatMoney(c.amount)}</Td>
                    <Td class="text-right">{formatMoney(c.paidAmount)}</Td>
                    <Td class="text-right">{formatMoney(c.giftAmount)}</Td>
                    <Td class={`text-right ${c.debtAmount > 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}`}>{formatMoney(c.debtAmount)}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
        {page !== null && page.count > page.pageSize && (
          <Pagination page={page.page} pageSize={page.pageSize} count={page.count} onPage={(p) => void fetchCharges(p)} />
        )}
      </TableContainer>
    </div>
  );
}

function MovementsTab() {
  const items = movementsSignal.value;
  return (
    <TableContainer>
      {items.length === 0 ? (
        <TableEmptyState message="Todavía no hay movimientos" />
      ) : (
        <div class="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Fecha</Th>
                <Th>Tipo</Th>
                <Th class="text-right">Importe</Th>
                <Th>Detalle</Th>
                <Th>Por</Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((m) => (
                <Tr key={m.id}>
                  <Td>{formatDateTime(m.createdAt)}</Td>
                  <Td>{MOVEMENT_LABEL[m.kind]}</Td>
                  <Td class="text-right font-semibold">{m.kind === 'gift-voided' ? '—' : formatMoney(Math.abs(m.amount))}</Td>
                  <Td>{m.info ?? ''}</Td>
                  <Td>{m.byName ?? ''}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </TableContainer>
  );
}

function GiftsTab() {
  const items = giftsSignal.value;
  const withActions = isRootOrSupportSignal.value;
  return (
    <TableContainer>
      {items.length === 0 ? (
        <TableEmptyState message="Sin créditos regalados" />
      ) : (
        <div class="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Origen</Th>
                <Th class="text-right">Importe</Th>
                <Th class="text-right">Remanente</Th>
                <Th>Vence</Th>
                <Th>Estado</Th>
                <Th>Otorgó</Th>
                <Th>Motivo</Th>
                {withActions && <Th />}
              </Tr>
            </Thead>
            <Tbody>
              {items.map((g) => (
                <Tr key={g.id}>
                  <Td>{g.origin === 'signup' ? 'Bono de alta' : 'Otorgado'}</Td>
                  <Td class="text-right">{formatMoney(g.amount)}</Td>
                  <Td class="text-right font-semibold">{formatMoney(g.remaining)}</Td>
                  <Td>{formatDateTime(g.expiresAt)}</Td>
                  <Td>{GIFT_STATUS[g.status]}</Td>
                  <Td>{g.grantedByName ?? ''}</Td>
                  <Td>{g.reason ?? ''}</Td>
                  {withActions && (
                    <Td class="text-right">
                      <GiftVoidAction gift={g} />
                    </Td>
                  )}
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </TableContainer>
  );
}

/**
 * Créditos (#21), para owner y admin: saldos, cómo pagar, consumo por caja y día, movimientos y
 * regalados. Root y soporte suman las acciones de plataforma sobre el comercio.
 */
export function CreditsView() {
  const credits = creditsSignal.value;
  const tab = creditsTabSignal.value;
  return (
    <div class="space-y-6">
      <PageHeader title="Créditos" subtitle="Tu saldo, lo que consume cada caja por día y cómo pagar" />
      {isRootOrSupportSignal.value && <PlatformActionsBar />}
      {credits !== null && (
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Saldo pagado"
            value={formatMoney(credits.paidBalance)}
            subtitle="Es tuyo: si dejás de usar mini contax, te devolvemos lo que quede"
            variant="primary"
          />
          <StatCard
            title="Créditos regalados"
            value={formatMoney(credits.giftBalance)}
            subtitle={credits.nextGiftExpiry === null ? 'Sin créditos vigentes' : `El próximo vence el ${formatDateTime(credits.nextGiftExpiry)}`}
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
      )}
      <HowToPay />
      <div class="flex flex-wrap items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => (creditsTabSignal.value = t.id)}
            class={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
              tab === t.id
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:text-slate-900 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'charges' && <ChargesTab />}
      {tab === 'movements' && <MovementsTab />}
      {tab === 'gifts' && <GiftsTab />}
    </div>
  );
}
