import { PASSWORD_MIN_LENGTH } from '../../../shared/password.ts';
import { currentUserSignal } from '../../state/auth-state.ts';
import {
  accountFormSignal,
  accountErrorSignal,
  accountSavingSignal,
  submitChangePassword,
} from '../../state/account-state.ts';
import { Button } from '../ui/Button.tsx';
import { Card, CardHeader } from '../ui/Card.tsx';
import { Input } from '../ui/Input.tsx';

/** Mi cuenta (#19): cambiar la propia contraseña. */
export function AccountSection() {
  const form = accountFormSignal.value;
  const user = currentUserSignal.value;

  return (
    <div class="space-y-6 animate-in fade-in duration-150">
      <Card class="max-w-lg">
        <CardHeader
          title="Cambiar contraseña"
          description={`Cuenta ${user?.email ?? ''}. Al cambiarla se cierra la sesión en tus otros equipos.`}
        />
        <form
          class="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submitChangePassword();
          }}
        >
          <Input
            id="account-current"
            label="Contraseña actual"
            type="password"
            autoComplete="current-password"
            value={form.current}
            onInput={(e) => (accountFormSignal.value = { ...form, current: (e.target as HTMLInputElement).value })}
          />
          <Input
            id="account-next"
            label="Contraseña nueva"
            type="password"
            autoComplete="new-password"
            helperText={`Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres`}
            value={form.next}
            onInput={(e) => (accountFormSignal.value = { ...form, next: (e.target as HTMLInputElement).value })}
          />
          <Input
            id="account-confirm"
            label="Repetir contraseña nueva"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            onInput={(e) => (accountFormSignal.value = { ...form, confirm: (e.target as HTMLInputElement).value })}
            error={accountErrorSignal.value}
          />
          <div class="flex justify-end">
            <Button type="submit" size="sm" loading={accountSavingSignal.value}>
              Guardar
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
