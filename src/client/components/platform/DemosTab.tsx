import { signal } from '@preact/signals';
import { demosLoadingSignal, demosSignal, resetDemos } from '../../state/platform-panel-state.ts';
import { formatDateTime } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import type { DemoResetKind, DemoStatusItem } from '../../../shared/demo-types.ts';

/** El reinicio a confirmar: de un rubro o, sin rubro, de los tres. */
type PendingReset = { kind: DemoResetKind; demo: DemoStatusItem | null };

const pendingSignal = signal<PendingReset | null>(null);
const busySignal = signal<boolean>(false);

function confirmText(p: PendingReset, all: DemoStatusItem[]): string {
  const name = p.demo?.name ?? 'las tres demos';
  if (p.kind === 'partial') {
    return `Vuelven catálogo, precios, stock y clientes de ${name}. Las ventas y las cajas de los visitantes siguen.`;
  }
  const revoked = p.demo === null ? all.reduce((sum, d) => sum + d.activeRegisters, 0) : p.demo.activeRegisters;
  return `Vuelve ${name} a la foto inicial y revoca ${String(revoked)} cajas de visitantes: sus POS van a ofrecer una demo nueva.`;
}

async function confirmReset(p: PendingReset): Promise<void> {
  busySignal.value = true;
  const ok = await resetDemos({ kind: p.kind, ...(p.demo === null ? {} : { template: p.demo.template }) }).finally(() => {
    busySignal.value = false;
  });
  if (ok) pendingSignal.value = null;
}

function ResetModal() {
  const pending = pendingSignal.value;
  if (pending === null) return null;
  const close = () => {
    pendingSignal.value = null;
  };
  const title = `${pending.kind === 'full' ? 'Reinicio total' : 'Reinicio parcial'} de ${pending.demo?.name ?? 'todas las demos'}`;
  return (
    <Modal
      isOpen
      onClose={close}
      title={title}
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancelar
          </Button>
          <Button variant={pending.kind === 'full' ? 'danger' : 'primary'} loading={busySignal.value} onClick={() => void confirmReset(pending)}>
            Reiniciar
          </Button>
        </>
      }
    >
      <p class="text-sm text-slate-600 dark:text-slate-300">{confirmText(pending, demosSignal.value)}</p>
    </Modal>
  );
}

/** Demos (#24): los comercios demo, su uso de hoy y los reinicios, para root y soporte. */
export function DemosTab() {
  const demos = demosSignal.value;
  const ask = (kind: DemoResetKind, demo: DemoStatusItem | null) => () => {
    pendingSignal.value = { kind, demo };
  };
  return (
    <div class="space-y-4">
      <div class="flex justify-end">
        <Button variant="danger" size="sm" disabled={demos.length === 0} onClick={ask('full', null)}>
          Reiniciar todas
        </Button>
      </div>
      <TableContainer>
        {demos.length === 0 ? (
          <TableEmptyState message={demosLoadingSignal.value ? 'Cargando…' : 'Las demos están apagadas'} />
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Demo</Th>
                  <Th class="text-right">Cajas activas</Th>
                  <Th class="text-right">Demos de hoy</Th>
                  <Th class="text-right">Ventas de hoy</Th>
                  <Th>Último reinicio total</Th>
                  <Th>Último parcial</Th>
                  <Th />
                </Tr>
              </Thead>
              <Tbody>
                {demos.map((d) => (
                  <Tr key={d.tenantId}>
                    <Td>
                      <div class="font-semibold">{d.name}</div>
                      <div class="text-[11px] text-slate-500">{d.tenantId}</div>
                    </Td>
                    <Td class="text-right">{d.activeRegisters}</Td>
                    <Td class="text-right">{d.createdToday}</Td>
                    <Td class="text-right">{d.salesToday}</Td>
                    <Td class="whitespace-nowrap">{formatDateTime(d.lastFullResetAt)}</Td>
                    <Td class="whitespace-nowrap">{d.lastPartialResetAt === null ? '—' : formatDateTime(d.lastPartialResetAt)}</Td>
                    <Td class="text-right whitespace-nowrap space-x-2">
                      <Button size="sm" variant="outline" onClick={ask('partial', d)}>
                        Reinicio parcial
                      </Button>
                      <Button size="sm" variant="danger" onClick={ask('full', d)}>
                        Reinicio total
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </TableContainer>
      <ResetModal />
    </div>
  );
}
