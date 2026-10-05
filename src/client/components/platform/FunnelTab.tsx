import { funnelReportLoadingSignal, funnelReportSignal, percentOf } from '../../state/funnel-state.ts';
import { routeSignal, setPlatformFilters } from '../../state/route-state.ts';
import { platformUrl } from '../../routing/admin-routes.ts';
import { formatDay, formatQty } from '../../format.ts';
import { FUNNEL_RUBRO_LABELS, FUNNEL_RUBROS, FUNNEL_STAGE_LABELS, isFunnelRubro, type FunnelReport, type FunnelRubro } from '../../../shared/funnel-types.ts';
import { FilterToolbar } from '../ui/FilterToolbar.tsx';
import { Input } from '../ui/Input.tsx';
import { Select } from '../ui/Select.tsx';
import { StatCard } from '../ui/StatCard.tsx';
import { Link } from '../ui/Link.tsx';
import { Table, TableContainer, TableEmptyState, Tbody, Td, Th, Thead, Tr } from '../ui/Table.tsx';

type Stage = FunnelReport['stages'][number];
type Column = { key: 'total' | FunnelRubro; label: string };

function countOf(stage: Stage | undefined, key: Column['key']): number {
  if (stage === undefined) return 0;
  return key === 'total' ? stage.total : stage.byRubro[key];
}

/** Los visitantes de la cohorte en la columna: la base del % y de la barra. */
function cohortOf(report: FunnelReport, key: Column['key']): number {
  return key === 'total' ? report.visitors.total : report.visitors.byRubro[key];
}

/**
 * Una celda: la cantidad (con link a Visitantes), el % de la cohorte y una barra. Sobre la cohorte y no
 * sobre la etapa anterior: la cohorte mezcla demos, contactos del landing y comercios sin demo, y una
 * etapa puede superar a la anterior.
 */
function Cell(props: { report: FunnelReport; index: number; column: Column }) {
  const { report, index, column } = props;
  const stage = report.stages[index];
  const n = countOf(stage, column.key);
  const cohort = cohortOf(report, column.key);
  const width = cohort === 0 ? 0 : Math.round((n / cohort) * 100);
  const rubro = column.key === 'total' ? {} : { rubro: column.key };
  const href = platformUrl('visitors', { desde: report.from, hasta: report.to, etapa: stage?.stage ?? 'demo', ...rubro });
  return (
    <Td>
      <div class="space-y-1 min-w-16">
        <div class="flex items-baseline gap-2">
          <Link href={href} class="font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
            {formatQty(n)}
          </Link>
          <span class="text-[10px] text-slate-400">{percentOf(n, cohort)}</span>
        </div>
        <div class="h-1.5 rounded bg-slate-100 dark:bg-slate-800">
          <div class="h-1.5 rounded bg-indigo-500" style={{ width: `${String(width)}%` }} />
        </div>
      </div>
    </Td>
  );
}

/** Embudo (#25): los totales del landing y la cohorte del rango por etapa y por rubro, para root y soporte. */
export function FunnelTab() {
  const route = routeSignal.value;
  const params = route.kind === 'plataforma' ? route.params : {};
  const report = funnelReportSignal.value;
  const rubro = isFunnelRubro(params['rubro']) ? params['rubro'] : undefined;
  const columns: Column[] = [
    { key: 'total', label: 'Total' },
    ...FUNNEL_RUBROS.filter((r) => rubro === undefined || r === rubro).map((r) => ({ key: r, label: FUNNEL_RUBRO_LABELS[r] })),
  ];
  return (
    <div class="space-y-4">
      <FilterToolbar>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Input
            type="date"
            label="Desde"
            value={params['desde'] ?? report?.from ?? ''}
            onInput={(e) => {
              setPlatformFilters({ desde: e.currentTarget.value });
            }}
          />
          <Input
            type="date"
            label="Hasta"
            value={params['hasta'] ?? report?.to ?? ''}
            onInput={(e) => {
              setPlatformFilters({ hasta: e.currentTarget.value });
            }}
          />
          <Select
            label="Rubro"
            value={rubro ?? ''}
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
        </div>
      </FilterToolbar>

      {report !== null && (
        <>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <StatCard title="Visitas al landing" value={formatQty(report.landing.landing)} />
            <StatCard title="Clics en Probar la demo" value={formatQty(report.landing['demo-click'])} />
            <StatCard title="Altas abiertas sin demo" value={formatQty(report.landing['alta-open'])} />
          </div>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Cohorte: los {formatQty(report.visitors.total)} visitantes que empezaron entre el {formatDay(report.from)} y el{' '}
            {formatDay(report.to)}, con cada etapa a la que llegaron y el % sobre la cohorte. Las cohortes recientes siguen avanzando.
          </p>
        </>
      )}

      <TableContainer>
        {report === null || report.stages.every((s) => s.total === 0) ? (
          <TableEmptyState message={funnelReportLoadingSignal.value ? 'Cargando…' : 'Sin visitantes en este rango'} />
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Etapa</Th>
                {columns.map((c) => (
                  <Th key={c.key}>
                    {c.label} ({formatQty(cohortOf(report, c.key))})
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {report.stages.map((s, index) => (
                <Tr key={s.stage}>
                  <Td class="font-semibold whitespace-nowrap">{FUNNEL_STAGE_LABELS[s.stage]}</Td>
                  {columns.map((c) => (
                    <Cell key={c.key} report={report} index={index} column={c} />
                  ))}
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </TableContainer>
    </div>
  );
}
