import { PASSWORD_MIN_LENGTH } from '../../../shared/password.ts';
import {
  resetInfoSignal,
  linkErrorSignal,
  linkFormSignal,
  linkSubmittingSignal,
  setLinkField,
  submitReset,
} from '../../state/link-pages-state.ts';
import { Button } from '../ui/Button.tsx';
import { Input } from '../ui/Input.tsx';
import { LinkGone, LinkPageFrame } from './LinkPageFrame.tsx';

/** Elegir una contraseña nueva con el link que generó el owner (#19). */
export function ResetPasswordView() {
  const info = resetInfoSignal.value;
  const error = linkErrorSignal.value;
  const form = linkFormSignal.value;

  if (info === null) {
    return (
      <LinkPageFrame title="Restablecer contraseña">
        {error !== null ? <LinkGone /> : <p class="text-xs text-center text-slate-500">Cargando…</p>}
      </LinkPageFrame>
    );
  }

  return (
    <LinkPageFrame title="Restablecer contraseña">
      <form
        class="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submitReset();
        }}
      >
        <p class="text-sm text-slate-700 dark:text-slate-300 text-center">
          Nueva contraseña para <strong>{info.email}</strong>
        </p>
        <Input
          id="reset-password"
          label="Contraseña nueva"
          type="password"
          autoComplete="new-password"
          helperText={`Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres`}
          value={form.password}
          onInput={(e) => { setLinkField('password', (e.target as HTMLInputElement).value); }}
          autoFocus
        />
        <Input
          id="reset-confirm"
          label="Repetir contraseña"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onInput={(e) => { setLinkField('confirm', (e.target as HTMLInputElement).value); }}
        />
        {error !== null && <p class="text-xs text-rose-600 dark:text-rose-400">{error}</p>}
        <Button type="submit" class="w-full" loading={linkSubmittingSignal.value}>
          Guardar y entrar
        </Button>
      </form>
    </LinkPageFrame>
  );
}
