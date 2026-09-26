import { signal } from '@preact/signals';
import { login, authLoadingSignal, authErrorSignal } from '../../state/auth-state.ts';
import { Input } from '../ui/Input.tsx';
import { Button } from '../ui/Button.tsx';

export const loginEmailSignal = signal('admin@local.test');
export const loginPasswordSignal = signal('admin123');

export function LoginForm(props: { onSwitchToRegister: () => void }) {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!loginEmailSignal.value.trim() || !loginPasswordSignal.value.trim()) {
      authErrorSignal.value = 'Completa tu email y contraseña';
      return;
    }

    void login({
      email: loginEmailSignal.value.trim(),
      password: loginPasswordSignal.value,
    });
  };

  const handleFillDemo = () => {
    loginEmailSignal.value = 'admin@local.test';
    loginPasswordSignal.value = 'admin123';
    authErrorSignal.value = null;
  };

  return (
    <form onSubmit={handleSubmit} class="space-y-4">
      <div class="space-y-3">
        <Input
          label="Correo electrónico"
          type="email"
          placeholder="usuario@comercio.com"
          value={loginEmailSignal.value}
          onInput={(e) => (loginEmailSignal.value = (e.target as HTMLInputElement).value)}
          required
        />

        <Input
          label="Contraseña"
          type="password"
          placeholder="••••••••"
          value={loginPasswordSignal.value}
          onInput={(e) => (loginPasswordSignal.value = (e.target as HTMLInputElement).value)}
          required
        />
      </div>

      {authErrorSignal.value && (
        <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium">
          {authErrorSignal.value}
        </div>
      )}

      <div class="pt-2 flex flex-col gap-2.5">
        <Button type="submit" variant="primary" size="md" loading={authLoadingSignal.value} class="w-full">
          Iniciar Sesión
        </Button>

        <button
          type="button"
          onClick={handleFillDemo}
          class="w-full text-center text-xs text-indigo-400 hover:text-indigo-300 transition-colors py-1 cursor-pointer font-medium"
        >
          ⚡ Rellenar credenciales demo (admin@local.test)
        </button>
      </div>

      <div class="pt-4 border-t border-slate-800 text-center">
        <p class="text-xs text-slate-400">
          ¿No tienes una cuenta aún?{' '}
          <button
            type="button"
            onClick={props.onSwitchToRegister}
            class="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline-offset-2 hover:underline"
          >
            Registrarse
          </button>
        </p>
      </div>
    </form>
  );
}
