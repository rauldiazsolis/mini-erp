import { PASSWORD_MIN_LENGTH } from '../../../shared/password.ts';
import { ROLE_LABEL } from '../../state/permissions-state.ts';
import {
  invitationInfoSignal,
  linkErrorSignal,
  linkKindSignal,
  staffInfoSignal,
  linkFormSignal,
  linkSubmittingSignal,
  setLinkField,
  submitInvitation,
} from '../../state/link-pages-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { LinkGone, LinkPageFrame } from './LinkPageFrame.tsx';

/**
 * Aceptar una invitación (#19): crea la cuenta o suma la membresía a una existente. La del equipo de
 * soporte (#23) crea una cuenta de soporte o promueve una existente.
 */
export function InvitationView() {
  const tenantInfo = invitationInfoSignal.value;
  const staffInfo = staffInfoSignal.value;
  const info = linkKindSignal.value === 'staff' ? staffInfo : tenantInfo;
  const error = linkErrorSignal.value;
  const form = linkFormSignal.value;

  if (info === null) {
    return (
      <LinkPageFrame title="Invitación">
        {error !== null ? <LinkGone /> : <p class="text-xs text-center text-slate-500">Cargando…</p>}
      </LinkPageFrame>
    );
  }

  return (
    <LinkPageFrame title="Invitación">
      <form
        class="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submitInvitation();
        }}
      >
        <p class="text-sm text-slate-700 dark:text-slate-300 text-center">
          {tenantInfo !== null && linkKindSignal.value === 'tenant' ? (
            <>
              <strong>{tenantInfo.invitedByName}</strong> te invitó a <strong>{tenantInfo.tenantName}</strong> como{' '}
              <strong>{ROLE_LABEL[tenantInfo.role]}</strong>
            </>
          ) : (
            <>
              Te invitaron al equipo de soporte de mini contax{staffInfo === null ? '' : ` (${staffInfo.invitedByName})`}
            </>
          )}
        </p>

        {info.accountExists ? (
          <>
            <p class="text-xs text-slate-500 dark:text-slate-400 text-center">Entrá con tu contraseña de {info.email}</p>
            <Input
              id="link-password"
              label="Contraseña"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onInput={(e) => { setLinkField('password', (e.target as HTMLInputElement).value); }}
              autoFocus
            />
          </>
        ) : (
          <>
            <p class="text-xs text-slate-500 dark:text-slate-400 text-center">Creá tu cuenta para {info.email}</p>
            <Input
              id="link-name"
              label="Tu nombre"
              value={form.name}
              onInput={(e) => { setLinkField('name', (e.target as HTMLInputElement).value); }}
              autoFocus
            />
            <Input
              id="link-password"
              label="Contraseña"
              type="password"
              autoComplete="new-password"
              helperText={`Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres`}
              value={form.password}
              onInput={(e) => { setLinkField('password', (e.target as HTMLInputElement).value); }}
            />
            <Input
              id="link-confirm"
              label="Repetir contraseña"
              type="password"
              autoComplete="new-password"
              value={form.confirm}
              onInput={(e) => { setLinkField('confirm', (e.target as HTMLInputElement).value); }}
            />
          </>
        )}

        {error !== null && <p class="text-xs text-rose-600 dark:text-rose-400">{error}</p>}

        <Button type="submit" class="w-full" loading={linkSubmittingSignal.value}>
          Aceptar invitación
        </Button>
      </form>
    </LinkPageFrame>
  );
}
