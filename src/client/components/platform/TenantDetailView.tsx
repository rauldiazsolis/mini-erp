import { signal } from '@preact/signals';
import {
  activeOwners,
  platformTenantDetailErrorSignal,
  platformTenantDetailSignal,
  reactivateTenant,
  suspendTenant,
} from '../../state/platform-panel-state.ts';
import { ROLE_LABEL } from '../../state/permissions-state.ts';
import { openEnterTab } from '../../state/impersonation-state.ts';
import { platformUrl } from '../../routing/admin-routes.ts';
import { formatDateTime, formatMoney } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { Link } from '../ui/Link.tsx';
import { Modal } from '../ui/Modal.tsx';
import { PageHeader } from '../ui/PageHeader.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { CreditsStats } from '../credits/CreditsStats.tsx';
import { GiftVoidAction, PlatformActionsBar } from '../credits/PlatformActionsBar.tsx';
import { AccountStatusBadge, BillingBadge, TenantStatusBadge } from './platform-badges.tsx';
import type { PlatformTenantDetail } from '../../../shared/platform-types.ts';

const suspendOpenSignal = signal<boolean>(false);
const reasonSignal = signal<string>('');
const busySignal = signal<boolean>(false);

async function confirmSuspend(tenantId: string): Promise<void> {
  if (reasonSignal.value.trim() === '') return;
  busySignal.value = true;
  const ok = await suspendTenant(tenantId, reasonSignal.value.trim()).finally(() => {
    busySignal.value = false;
  });
  if (ok) suspendOpenSignal.value = false;
}

function SuspendModal(props: { tenantId: string; name: string }) {
  if (!suspendOpenSignal.value) return null;
  const close = () => {
    suspendOpenSignal.value = false;
  };
  return (
    <Modal
      isOpen
      onClose={close}
      title={`Suspender ${props.name}`}
      subtitle="Sus usuarios dejan de usar el admin (salvo Uso y pagos). El POS sigue vendiendo y sincronizando, y esos días no se cobran."
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button variant="danger" loading={busySignal.value} disabled={reasonSignal.value.trim() === ''} onClick={() => void confirmSuspend(props.tenantId)}>
            Suspender comercio
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void confirmSuspend(props.tenantId);
        }}
      >
        <Input label="Motivo" value={reasonSignal.value} maxLength={200} onInput={(e) => { reasonSignal.value = e.currentTarget.value; }} />
      </form>
    </Modal>
  );
}

function Members(props: { detail: PlatformTenantDetail }) {
  const members = props.detail.members;
  return (
    <TableContainer>
      {members.length === 0 ? (
        <TableEmptyState message="Sin miembros" />
      ) : (
        <div class="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Nombre</Th>
                <Th>Correo</Th>
                <Th>Rol</Th>
                <Th>Estado</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {members.map((m) => (
                <Tr key={m.userId}>
                  <Td>{m.name}</Td>
                  <Td>{m.email}</Td>
                  <Td>{ROLE_LABEL[m.role]}</Td>
                  <Td>
                    <AccountStatusBadge status={m.status} />
                  </Td>
                  <Td class="text-right">
                    {m.status === 'active' && (
                      <Button size="sm" onClick={() => { openEnterTab(m.userId, props.detail.tenant.slug); }}>
                        Entrar como
                      </Button>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </TableContainer>
  );
}

function Gifts(props: { detail: PlatformTenantDetail }) {
  const { detail } = props;
  const target = { tenantId: detail.tenant.id, owners: activeOwners(detail), paidBalance: detail.credits.paidBalance };
  return (
    <TableContainer>
      {detail.gifts.length === 0 ? (
        <TableEmptyState message="Sin bonos" />
      ) : (
        <div class="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Origen</Th>
                <Th class="text-right">Importe</Th>
                <Th class="text-right">Remanente</Th>
                <Th>Vence</Th>
                <Th>Motivo</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {detail.gifts.map((g) => (
                <Tr key={g.id}>
                  <Td>{g.origin === 'signup' ? 'Bono de alta' : 'Otorgado'}</Td>
                  <Td class="text-right">{formatMoney(g.amount)}</Td>
                  <Td class="text-right font-semibold">{formatMoney(g.remaining)}</Td>
                  <Td>{formatDateTime(g.expiresAt)}</Td>
                  <Td>{g.reason ?? ''}</Td>
                  <Td class="text-right">
                    <GiftVoidAction target={target} gift={g} />
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </TableContainer>
  );
}

/** El detalle de un comercio en la plataforma (#23): estado, suspensión, créditos con sus acciones y miembros. */
export function TenantDetailView() {
  const detail = platformTenantDetailSignal.value;
  const back = (
    <Link href={platformUrl('tenants')} class="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
      ← Comercios
    </Link>
  );
  if (detail === null) {
    return (
      <div class="space-y-4">
        {back}
        <p class="text-sm text-slate-500">{platformTenantDetailErrorSignal.value === null ? 'Cargando…' : 'No se encontró el comercio.'}</p>
      </div>
    );
  }
  const { tenant, suspension, credits } = detail;
  const suspended = tenant.status === 'suspended';
  return (
    <div class="space-y-6">
      {back}
      <PageHeader title={tenant.name} subtitle={`${tenant.slug} · titular: ${tenant.holder?.name ?? 'sin titular'}`}>
        <div class="flex items-center gap-2">
          <TenantStatusBadge status={tenant.status} />
          <BillingBadge state={tenant.billingState} />
          {suspended ? (
            <Button size="sm" onClick={() => void reactivateTenant(tenant.id)}>
              Reactivar
            </Button>
          ) : (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                reasonSignal.value = '';
                suspendOpenSignal.value = true;
              }}
            >
              Suspender
            </Button>
          )}
        </div>
      </PageHeader>
      {suspension !== null && (
        <div role="status" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-5 py-4 space-y-1 text-rose-900 dark:text-rose-100">
          <p class="text-[11px] font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">Motivo de la suspensión</p>
          <p class="text-base font-semibold">{suspension.reason}</p>
          <p class="text-xs text-rose-700/80 dark:text-rose-300/80">
            Suspendido desde el {formatDateTime(suspension.since)} por {suspension.byName}
          </p>
        </div>
      )}
      <CreditsStats credits={credits} />
      <PlatformActionsBar tenantId={tenant.id} owners={activeOwners(detail)} paidBalance={credits.paidBalance} />
      <section class="space-y-2">
        <h2 class="text-sm font-bold text-slate-700 dark:text-slate-200">Bonos</h2>
        <Gifts detail={detail} />
      </section>
      <section class="space-y-2">
        <h2 class="text-sm font-bold text-slate-700 dark:text-slate-200">Usuarios</h2>
        <Members detail={detail} />
      </section>
      <SuspendModal tenantId={tenant.id} name={tenant.name} />
    </div>
  );
}
