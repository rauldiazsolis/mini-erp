import { platformTenantsLoadingSignal, platformTenantsSignal } from '../../state/platform-panel-state.ts';
import { navigate, routeSignal, setPlatformFilters } from '../../state/route-state.ts';
import { CardList, CardRow, DesktopOnly } from '../ui/CardList.tsx';
import { platformTenantUrl } from '../../routing/admin-routes.ts';
import { formatDate } from '../../format.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Input } from '../ui/Input.tsx';
import { Link } from '../ui/Link.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';
import { BillingBadge, TenantStatusBadge } from './platform-badges.tsx';

/** Comercios de la plataforma (#23): todos los reales, con titular, estado y estado de cobro. */
export function TenantsTab() {
  const route = routeSignal.value;
  const q = route.kind === 'plataforma' ? (route.params['q'] ?? '') : '';
  const items = platformTenantsSignal.value;
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <Input
          aria-label="Buscar comercio"
          placeholder="Buscar comercio"
          value={q}
          onInput={(e) => { setPlatformFilters({ q: e.currentTarget.value }); }}
        />
      </FilterToolbar>
      <TableContainer>
        {items.length === 0 ? (
          <TableEmptyState message={platformTenantsLoadingSignal.value ? 'Cargando…' : 'Sin comercios'} />
        ) : (
          <>
            {/* En el teléfono, una tarjeta por comercio; tocarla abre su detalle (#89) */}
            <CardList label="Comercios">
              {items.map((t) => (
                <CardRow
                  key={t.id}
                  onOpen={() => { navigate(platformTenantUrl(t.slug)); }}
                  title={<span class="text-indigo-600 dark:text-indigo-400">{t.name}</span>}
                  aside={<BillingBadge state={t.billingState} />}
                  meta={
                    <span class="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                      <TenantStatusBadge status={t.status} />
                      <span>
                        {t.holder?.name ?? 'Sin titular'} · {t.members} {t.members === 1 ? 'usuario' : 'usuarios'} · alta {formatDate(t.createdAt)}
                      </span>
                    </span>
                  }
                />
              ))}
            </CardList>
            <DesktopOnly>
              <Table>
                <Thead>
                  <Tr>
                    <Th>Comercio</Th>
                    <Th>Titular</Th>
                    <Th>Estado</Th>
                    <Th>Cobro</Th>
                    <Th class="text-right">Usuarios</Th>
                    <Th>Alta</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {items.map((t) => (
                    <Tr key={t.id}>
                      <Td>
                        <Link href={platformTenantUrl(t.slug)} class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                          {t.name}
                        </Link>
                        <div class="text-[11px] text-slate-500">{t.slug}</div>
                      </Td>
                      <Td>{t.holder?.name ?? '—'}</Td>
                      <Td>
                        <TenantStatusBadge status={t.status} />
                      </Td>
                      <Td>
                        <BillingBadge state={t.billingState} />
                      </Td>
                      <Td class="text-right">{t.members}</Td>
                      <Td>{formatDate(t.createdAt)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </DesktopOnly>
          </>
        )}
      </TableContainer>
    </div>
  );
}
