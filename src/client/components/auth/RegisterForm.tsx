import { signal } from '@preact/signals';
import { register, authLoadingSignal, authErrorSignal } from '../../state/auth-state.ts';
import { Input } from '../ui/Input.tsx';
import { Button } from '../ui/Button.tsx';

export const registerNameSignal = signal('');
export const registerEmailSignal = signal('');
export const registerPasswordSignal = signal('');

export function RegisterForm(props: { onSwitchToLogin: () => void }) {
  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (!registerNameSignal.value.trim() || !registerEmailSignal.value.trim() || !registerPasswordSignal.value.trim()) {
      authErrorSignal.value = 'Completa todos los campos requeridos';
      return;
    }

    if (registerPasswordSignal.value.length < 6) {
      authErrorSignal.value = 'La contraseña debe tener al menos 6 caracteres';
      return;
    }

    void register({
      name: registerNameSignal.value.trim(),
      email: registerEmailSignal.value.trim(),
      password: registerPasswordSignal.value,
    });
  };

  return (
    <form onSubmit={handleSubmit} class="space-y-4">
      <div class="space-y-3">
        <Input
          label="Nombre completo"
          type="text"
          placeholder="Ej. Juan Pérez"
          value={registerNameSignal.value}
          onInput={(e) => (registerNameSignal.value = (e.target as HTMLInputElement).value)}
          required
        />

        <Input
          label="Correo electrónico"
          type="email"
          placeholder="usuario@comercio.com"
          value={registerEmailSignal.value}
          onInput={(e) => (registerEmailSignal.value = (e.target as HTMLInputElement).value)}
          required
        />

        <Input
          label="Contraseña (mínimo 6 caracteres)"
          type="password"
          placeholder="••••••••"
          value={registerPasswordSignal.value}
          onInput={(e) => (registerPasswordSignal.value = (e.target as HTMLInputElement).value)}
          required
        />
      </div>

      {authErrorSignal.value && (
        <div class="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 font-medium">
          {authErrorSignal.value}
        </div>
      )}

      <div class="pt-2">
        <Button type="submit" variant="primary" size="md" loading={authLoadingSignal.value} class="w-full">
          Crear Cuenta
        </Button>
      </div>

      <div class="pt-4 border-t border-slate-800 text-center">
        <p class="text-xs text-slate-400">
          ¿Ya tienes cuenta?{' '}
          <button
            type="button"
            onClick={props.onSwitchToLogin}
            class="text-indigo-400 hover:text-indigo-300 font-semibold cursor-pointer underline-offset-2 hover:underline"
          >
            Iniciar sesión
          </button>
        </p>
      </div>
    </form>
  );
}
