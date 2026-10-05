import type { ComponentChildren } from 'preact';
import { contactWhatsappUrl, markContactHandled, visitorDetailLoadingSignal, visitorDetailSignal } from '../../state/funnel-state.ts';
import { platformTenantUrl, platformUrl } from '../../routing/admin-routes.ts';
import { formatDateTime } from '../../format.ts';
import { FUNNEL_RUBRO_LABELS, FUNNEL_STAGE_LABELS, type FunnelContactSource, type FunnelVisitorDetail } from '../../../shared/funnel-types.ts';
import { PageHeader } from '../ui/PageHeader.tsx';
import { Card, CardHeader } from '../ui/Card.tsx';
import { Button } from '../ui/Button.tsx';
import { Link } from '../ui/Link.tsx';

const SOURCE_LABELS: Record<FunnelContactSource, string> = {
  demo: 'Franja de la demo',
  'demo-ended': 'Fin de la demo',
  landing: 'Landing',
};

const LOAD_LABELS: Record<string, string> = {
  example: 'Catálogo de ejemplo',
  'import-products': 'Importó productos',
  'import-customers': 'Importó clientes',
};

const REVOKE_LABELS: Record<string, string> = { idle: 'inactividad', reset: 'reinicio', legacy: 'demo de antes' };

function titleOf(v: FunnelVisitorDetail): string {
  return v.contact?.name ?? v.tenant?.name ?? v.pointOfSale ?? 'Visitante';
}

function Field(props: { label: string; children: ComponentChildren }) {
  return (
    <div class="flex justify-between gap-4 text-sm py-1">
      <span class="text-slate-500 dark:text-slate-400">{props.label}</span>
      <span class="text-right">{props.children}</span>
    </div>
  );
}

/** La historia de un visitante del embudo (#25): cada etapa con su fecha, la demo, el contacto y el comercio. */
export function VisitorDetailView() {
  const v = visitorDetailSignal.value;
  const back = (
    <Link href={platformUrl('visitors')} class="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
      ← Visitantes
    </Link>
  );
  if (v === null) {
    return (
      <div class="space-y-4">
        {back}
        <p class="text-sm text-slate-500 dark:text-slate-400">{visitorDetailLoadingSignal.value ? 'Cargando…' : 'No existe ese visitante'}</p>
      </div>
    );
  }
  const contact = v.contact;
  return (
    <div class="space-y-6">
      {back}
      <PageHeader title={titleOf(v)} subtitle={`Visitante · ${FUNNEL_RUBRO_LABELS[v.rubro]}`} />
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader title="Historia" />
          <ol class="space-y-2">
            {v.stages.map((s) => (
              <li key={s.stage} class={`flex justify-between gap-4 text-sm ${s.at === null ? 'text-slate-400' : ''}`}>
                <span class="flex items-center gap-2">
                  <span class={s.at === null ? 'text-slate-300 dark:text-slate-600' : 'text-emerald-600 dark:text-emerald-400'}>
                    {s.at === null ? '○' : '✓'}
                  </span>
                  <span class="font-medium">{FUNNEL_STAGE_LABELS[s.stage]}</span>
                  {s.stage === 'commerce' && s.at !== null && v.holder !== null && (
                    <span class="text-xs text-slate-500 dark:text-slate-400">
                      cuenta de {v.holder.name} creada el {formatDateTime(v.holder.accountCreatedAt)}
                    </span>
                  )}
                  {s.stage === 'load' && v.loadSource !== null && (
                    <span class="text-xs text-slate-500 dark:text-slate-400">{LOAD_LABELS[v.loadSource] ?? v.loadSource}</span>
                  )}
                </span>
                <span class="whitespace-nowrap">{s.at === null ? '—' : formatDateTime(s.at)}</span>
              </li>
            ))}
          </ol>
        </Card>

        <div class="space-y-6">
          {contact !== null && (
            <Card>
              <CardHeader title="Contacto" />
              {contact.erased ? (
                <p class="text-sm text-slate-500 dark:text-slate-400">Contacto borrado por antigüedad</p>
              ) : (
                <>
                  <Field label="Nombre">{contact.name}</Field>
                  <Field label="WhatsApp">{contact.whatsapp}</Field>
                </>
              )}
              <Field label="Desde">{SOURCE_LABELS[contact.source]}</Field>
              <Field label="Dejado">{formatDateTime(contact.createdAt)}</Field>
              <div class="flex flex-wrap items-center gap-3 pt-3">
                {!contact.erased && contact.whatsapp !== null && (
                  <a
                    href={contactWhatsappUrl(contact.name, contact.whatsapp)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
                  >
                    Escribir por WhatsApp
                  </a>
                )}
                {contact.handledAt === null ? (
                  <Button size="sm" variant="outline" onClick={() => void markContactHandled(contact.id)}>
                    Marcar atendido
                  </Button>
                ) : (
                  <span class="text-xs text-slate-500 dark:text-slate-400">
                    Atendido por {contact.handledByName ?? 'soporte'} el {formatDateTime(contact.handledAt)}
                  </span>
                )}
              </div>
            </Card>
          )}

          {v.demo !== null && (
            <Card>
              <CardHeader title="Demo" />
              <Field label="Caja">{v.demo.pointOfSale ?? '—'}</Field>
              <Field label="Empezó">{formatDateTime(v.demo.createdAt)}</Field>
              <Field label="Estado">
                {v.demo.revokedAt === null
                  ? 'Activa'
                  : `Revocada el ${formatDateTime(v.demo.revokedAt)}${v.demo.revokeReason === null ? '' : ` (${REVOKE_LABELS[v.demo.revokeReason] ?? v.demo.revokeReason})`}`}
              </Field>
            </Card>
          )}

          {v.tenant !== null && (
            <Card>
              <CardHeader title="Comercio" />
              <Field label="Nombre">{v.tenant.name}</Field>
              {v.holder !== null && <Field label="Titular">{v.holder.name}</Field>}
              <div class="pt-3">
                <Link href={platformTenantUrl(v.tenant.slug)} class="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
                  Ver comercio
                </Link>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
