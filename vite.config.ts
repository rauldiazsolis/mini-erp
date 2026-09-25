import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  plugins: [
    preact(),
    tailwindcss(),
  ],
  root: resolve(import.meta.dirname, 'src/client'),
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 4100,
  },
});
