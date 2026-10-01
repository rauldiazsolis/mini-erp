import type { ComponentChildren } from 'preact';
import { Card } from '../ui/Card.tsx';
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { Logo } from '../ui/Logo.tsx';
import { versionLabel } from '../../state/app-version.ts';
import { linkErrorSignal } from '../../state/link-pages-state.ts';

/** El marco de las páginas de links (#19): el mismo del login. */
export function LinkPageFrame(props: { title: string; children: ComponentChildren }) {
  return (
    <div class="min-h-screen bg-slate-100 dark:bg-slate-950 flex flex-col justify-center items-center p-4 relative overflow-hidden transition-colors">
      <div class="absolute top-4 right-4 z-20">
        <ThemeToggle compact />
      </div>
      <div class="w-full max-w-md relative z-10">
        <div class="text-center mb-8">
          <Logo class="w-14 h-14 mb-4 inline-block" />
          <h1 class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">mini contax</h1>
        </div>
        <Card class="border-slate-200 dark:border-slate-800/90 shadow-xl dark:shadow-2xl">
          <h2 class="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 text-center">{props.title}</h2>
          {props.children}
        </Card>
        <p class="text-center text-xs text-slate-400 dark:text-slate-500 mt-6">{versionLabel()}</p>
      </div>
    </div>
  );
}

/** El link no sirve (vencido, usado, revocado o sin token): solo el mensaje y la salida. */
export function LinkGone() {
  return (
    <div class="space-y-4 text-center">
      <p class="text-sm text-rose-600 dark:text-rose-400">{linkErrorSignal.value}</p>
      <a href="/" class="inline-block text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
        Ir a mini contax
      </a>
    </div>
  );
}
