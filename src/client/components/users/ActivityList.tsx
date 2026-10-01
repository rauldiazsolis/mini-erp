import { auditSignal, AUDIT_LABEL } from '../../state/users-state.ts';
import { Card, CardHeader } from '../ui/Card.tsx';
import { formatDateTime } from './format.ts';

/** La auditoría del comercio (#19): solo la ve el owner. */
export function ActivityList() {
  const entries = auditSignal.value;

  return (
    <Card>
      <CardHeader title="Actividad" description="Quién hizo qué con los usuarios, los roles y las invitaciones." />
      {entries.length === 0 ? (
        <p class="text-xs text-slate-500 dark:text-slate-400">Sin actividad todavía.</p>
      ) : (
        <ul class="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
          {entries.map((e) => {
            const email = typeof e.details['email'] === 'string' ? e.details['email'] : null;
            return (
              <li key={e.id} class="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                <span class="text-slate-400 font-mono shrink-0">{formatDateTime(e.at)}</span>
                <span class="text-slate-700 dark:text-slate-300">
                  <strong class="text-slate-900 dark:text-white">{e.actorName}</strong> {AUDIT_LABEL[e.action] ?? e.action}
                  {e.targetName !== null && e.targetName !== e.actorName && (
                    <>
                      {' '}
                      <strong class="text-slate-900 dark:text-white">{e.targetName}</strong>
                    </>
                  )}
                  {email !== null && <span class="text-slate-500"> {email}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
