import { helpRequestsLoadingSignal, helpRequestsSignal } from '../../state/platform-panel-state.ts';
import { openHelpRequestTab } from '../../state/impersonation-state.ts';
import { formatDateTime, formatTime } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { Badge } from './platform-badges.tsx';
import type { HelpRequestStatus } from '../../../shared/help-types.ts';

const STATUS: Record<HelpRequestStatus, { text: string; tone: 'ok' | 'neutral' | 'warning' }> = {
  open: { text: 'Abierto', tone: 'ok' },
  expired: { text: 'Vencido', tone: 'warning' },
  closed: { text: 'Cerrado', tone: 'neutral' },
};

/** Pedidos de ayuda de las últimas 48 h (#23): "Atender" entra como quien lo pidió, en otra pestaña. */
export function HelpRequestsTab() {
  const requests = helpRequestsSignal.value;
  return (
    <TableContainer>
      {requests.length === 0 ? (
        <TableEmptyState message={helpRequestsLoadingSignal.value ? 'Cargando…' : 'Sin pedidos en las últimas 48 h'} />
      ) : (
        <div class="overflow-x-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Pedido</Th>
                <Th>Quién</Th>
                <Th>Comercio</Th>
                <Th>Pantalla</Th>
                <Th>Mensaje</Th>
                <Th>Estado</Th>
                <Th>Tomado por</Th>
                <Th />
              </Tr>
            </Thead>
            <Tbody>
              {requests.map((r) => (
                <Tr key={r.id}>
                  <Td>{formatDateTime(r.createdAt)}</Td>
                  <Td>{r.userName}</Td>
                  <Td>{r.tenantName}</Td>
                  <Td>
                    <span class="font-mono text-[11px]">{r.path}</span>
                  </Td>
                  <Td>{r.message === '' ? '—' : r.message}</Td>
                  <Td>
                    <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Badge>
                  </Td>
                  <Td>{r.takes.length === 0 ? '—' : r.takes.map((t) => `${t.staffName} ${formatTime(t.at)}`).join(', ')}</Td>
                  <Td class="text-right">
                    {r.status === 'open' && (
                      <Button size="sm" onClick={() => { openHelpRequestTab(r.id); }}>
                        Atender
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
