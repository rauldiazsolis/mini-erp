import { signal } from '@preact/signals';
import { LoginForm } from './LoginForm.tsx';
import { RegisterForm } from './RegisterForm.tsx';
import { Card } from '../ui/Card.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { Logo } from '../ui/Logo.tsx';
import { versionLabel } from '../../state/app-version.ts';
import { openMerchantOnboarding } from '../../state/merchant-onboarding-state.ts';

export const authViewModeSignal = signal<'login' | 'register'>('login');

export function AuthView() {
  const isLogin = authViewModeSignal.value === 'login';

  return (
    <div class="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center p-4 selection:bg-indigo-500 selection:text-white relative overflow-hidden transition-colors">
      {/* Botón de tema en pantalla de login */}
      <div class="absolute top-4 right-4 z-20">
        <ThemeToggle compact />
      </div>

      {/* Glow decorativo de fondo */}
      <div class="absolute -top-40 -left-40 w-96 h-96 bg-indigo-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div class="absolute -bottom-40 -right-40 w-96 h-96 bg-purple-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div class="w-full max-w-md relative z-10">
        <div class="text-center mb-8">
          <Logo class="w-14 h-14 mb-4 inline-block" />
          <h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">mini contax</h1>
          <p class="text-sm text-slate-500 dark:text-slate-400 mt-1">Caja, stock, clientes y cuentas corrientes de tu comercio</p>
        </div>

        <Card class="border-slate-200 dark:border-slate-800/90 shadow-xl dark:shadow-2xl">
          <div class="mb-6 text-center">
            <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {isLogin ? 'Iniciar Sesión' : 'Crear Nueva Cuenta'}
            </h2>
            <p class="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {isLogin ? 'Ingresa tus credenciales para acceder' : 'Regístrate para administrar tus comercios'}
            </p>
          </div>

          {isLogin ? (
            <LoginForm onSwitchToRegister={() => (authViewModeSignal.value = 'register')} />
          ) : (
            <RegisterForm onSwitchToLogin={() => (authViewModeSignal.value = 'login')} />
          )}
        </Card>

        {/* Acceso directo al alta */}
        <div class="mt-4 p-4 rounded-3xl bg-gradient-to-tr from-indigo-500/10 via-purple-500/10 to-violet-500/10 border border-indigo-500/20 text-center backdrop-blur-sm">
          <p class="text-xs font-semibold text-slate-800 dark:text-slate-200">
            ¿Todavía no tenés tu comercio en mini contax?
          </p>
          <button
            type="button"
            onClick={() => { openMerchantOnboarding(); }}
            class="mt-2.5 w-full py-2.5 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
          >
            Crear mi comercio
          </button>
        </div>

        <p class="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">
          {versionLabel()}
        </p>
      </div>
    </div>
  );
}
