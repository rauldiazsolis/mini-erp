import { platformAuditLoadingSignal, platformAuditSignal, platformTenantsSignal } from '../../state/platform-panel-state.ts';
import { routeSignal, setPlatformFilters } from '../../state/route-state.ts';
import { AUDIT_LABEL, IMPERSONATION_END_LABEL, auditActorText } from '../../state/users-state.ts';
import { formatDateTime } from '../../format.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Select } from '../ui/Select.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';

/** El registro de la plataforma (#23): todo lo auditado, con filtro por comercio. */
export function AuditTab() {
  const route = routeSignal.value;
  const slug = route.kind === 'plataforma' ? (route.params['comercio'] ?? '') : '';
  const entries = platformAuditSignal.value;
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <Select label="Comercio" value={slug} onChange={(e) => { setPlatformFilters({ comercio: e.currentTarget.value }); }}>
          <option value="">Todos</option>
          {platformTenantsSignal.value.map((t) => (
            <option key={t.id} value={t.slug}>
              {t.name}
            </option>
          ))}
        </Select>
      </FilterToolbar>
      <TableContainer>
        {entries.length === 0 ? (
          <TableEmptyState message={platformAuditLoadingSignal.value ? 'Cargando…' : 'Sin actividad'} />
        ) : (
          <div class="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Cuándo</Th>
                  <Th>Comercio</Th>
                  <Th>Qué pasó</Th>
                </Tr>
              </Thead>
              <Tbody>
                {entries.map((e) => {
                  const email = typeof e.details['email'] === 'string' ? e.details['email'] : null;
                  const rawReason = typeof e.details['reason'] === 'string' ? e.details['reason'] : null;
                  const reason = rawReason !== null && e.action === 'impersonation.ended' ? (IMPERSONATION_END_LABEL[rawReason] ?? rawReason) : rawReason;
                  return (
                    <Tr key={e.id}>
                      <Td class="whitespace-nowrap">{formatDateTime(e.at)}</Td>
                      <Td>{e.tenantName ?? '—'}</Td>
                      <Td>
                        <strong>{auditActorText(e)}</strong> {AUDIT_LABEL[e.action] ?? e.action}
                        {e.targetName !== null && e.targetName !== e.actorName && <strong> {e.targetName}</strong>}
                        {email !== null && <span class="text-slate-500"> {email}</span>}
                        {reason !== null && <span class="text-slate-500"> ({reason})</span>}
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          </div>
        )}
      </TableContainer>
    </div>
  );
}
