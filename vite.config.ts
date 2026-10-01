import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import pkg from './package.json' with { type: 'json' };

/** La versión de mini (la de package.json) para el cliente; solo viaja el número, no el package.json (#18). */
export const appVersionDefine = {
  'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
};

export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(),
  ],
  root: resolve(import.meta.dirname, 'src/client'),
  define: appVersionDefine,
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 4100,
  },
});
