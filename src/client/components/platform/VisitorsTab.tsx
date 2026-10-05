import { visitorListLoadingSignal, visitorListSignal } from '../../state/funnel-state.ts';
import { routeSignal, setPlatformFilters } from '../../state/route-state.ts';
import { platformTenantUrl, visitorUrl } from '../../routing/admin-routes.ts';
import { formatDateTime } from '../../format.ts';
import { FUNNEL_RUBRO_LABELS, FUNNEL_RUBROS, FUNNEL_STAGE_LABELS, FUNNEL_STAGES, type FunnelContactInfo } from '../../../shared/funnel-types.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Input } from '../ui/Input.tsx';
import { Select } from '../ui/Select.tsx';
import { Link } from '../ui/Link.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';

const FILTER_LABELS = { all: 'Todos', contact: 'Con contacto', pending: 'Contactos sin atender', alta: 'Con alta' } as const;

export function ContactSummary(props: { contact: FunnelContactInfo | null }) {
  const c = props.contact;
  if (c === null) return <span class="text-slate-400">—</span>;
  if (c.erased) return <span class="text-slate-400">Contacto borrado por antigüedad</span>;
  return (
    <span class="inline-flex items-center gap-1.5">
      {c.handledAt === null && <span class="w-2 h-2 rounded-full bg-amber-500" title="Sin atender" />}
      <span>
        <span class="font-medium">{c.name}</span> <span class="text-slate-500 dark:text-slate-400">{c.whatsapp}</span>
      </span>
    </span>
  );
}

/** Visitantes (#25): las demos, los contactos y las altas, con su etapa más avanzada, para root y soporte. */
export function VisitorsTab() {
  const route = routeSignal.value;
  const p = route.kind === 'plataforma' ? route.params : {};
  const list = visitorListSignal.value;
  const items = list?.items ?? [];
  const pending = p['filtro'] === 'pending';
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Select
            label="Mostrar"
            value={p['filtro'] ?? 'all'}
            onChange={(e) => {
              const value = e.currentTarget.value;
              setPlatformFilters({ filtro: value === 'all' ? '' : value });
            }}
          >
            {Object.entries(FILTER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
          <Select
            label="Rubro"
            value={p['rubro'] ?? ''}
            onChange={(e) => {
              setPlatformFilters({ rubro: e.currentTarget.value });
            }}
          >
            <option value="">Todos</option>
            {FUNNEL_RUBROS.map((r) => (
              <option key={r} value={r}>
                {FUNNEL_RUBRO_LABELS[r]}
              </option>
            ))}
          </Select>
          <Select
            label="Llegó a"
            value={p['etapa'] ?? ''}
            onChange={(e) => {
              setPlatformFilters({ etapa: e.currentTarget.value });
            }}
          >
            <option value="">Cualquier etapa</option>
            {FUNNEL_STAGES.map((s) => (
              <option key={s} value={s}>
                {FUNNEL_STAGE_LABELS[s]}
              </option>
            ))}
          </Select>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            type="date"
            label="Desde"
            disabled={pending}
            value={p['desde'] ?? list?.from ?? ''}
            onInput={(e) => {
              setPlatformFilters({ desde: e.currentTarget.value });
            }}
          />
          <Input
            type="date"
            label="Hasta"
            disabled={pending}
            value={p['hasta'] ?? list?.to ?? ''}
            onInput={(e) => {
              setPlatformFilters({ hasta: e.currentTarget.value });
            }}
          />
          <Input
            label="Buscar"
            placeholder="Buscar por nombre, WhatsApp, comercio o caja"
            value={p['q'] ?? ''}
            onInput={(e) => {
              setPlatformFilters({ q: e.currentTarget.value });
            }}
          />
        </div>
        {pending && <p class="text-xs text-slate-500 dark:text-slate-400">Todos los contactos sin atender, de cualquier fecha.</p>}
      </FilterToolbar>

      <TableContainer>
        {items.length === 0 ? (
          <TableEmptyState message={visitorListLoadingSignal.value ? 'Cargando…' : 'Sin visitantes'} />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Inicio</Th>
                <Th>Rubro</Th>
                <Th>Llegó a</Th>
                <Th>Caja</Th>
                <Th>Contacto</Th>
                <Th>Comercio</Th>
              </Tr>
            </Thead>
            <Tbody>
              {items.map((v) => (
                <Tr key={v.id}>
                  <Td class="whitespace-nowrap">
                    <Link href={visitorUrl(v.id)} class="font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                      {formatDateTime(v.startedAt)}
                    </Link>
                  </Td>
                  <Td>{FUNNEL_RUBRO_LABELS[v.rubro]}</Td>
                  <Td>{FUNNEL_STAGE_LABELS[v.furthest]}</Td>
                  <Td>{v.pointOfSale ?? '—'}</Td>
                  <Td>
                    <ContactSummary contact={v.contact} />
                  </Td>
                  <Td>
                    {v.tenant === null ? (
                      '—'
                    ) : (
                      <Link href={platformTenantUrl(v.tenant.slug)} class="text-indigo-600 dark:text-indigo-400 hover:underline">
                        {v.tenant.name}
                      </Link>
                    )}
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </TableContainer>
    </div>
  );
}
