import type { Express } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';
import { DEFAULT_POS_MIRROR_DIR, contractPosVersion } from './pos-mirror/mirror.ts';
import { ensurePosMirror, mountPosMirror } from './pos-mirror/serve.ts';

export async function setupClient(app: Express): Promise<void> {
  const isProd = process.env['NODE_ENV'] === 'production';
  const distDir = resolve(import.meta.dirname, '../../dist/client');

  if (!isProd) {
    // Copia local del POS publicado en /pos/<versión>/ (#9), antes de Vite para que no caiga al SPA
    const root = resolve(import.meta.dirname, '../..');
    const posDir = resolve(root, DEFAULT_POS_MIRROR_DIR);
    await ensurePosMirror({ dir: posDir, version: await contractPosVersion(resolve(root, 'contract.json')) });
    mountPosMirror(app, posDir);

    const { createServer } = await import('vite');
    const viteConfigPath = resolve(import.meta.dirname, '../../vite.config.ts');
    const vite = await createServer({
      configFile: viteConfigPath,
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    if (existsSync(distDir)) {
      app.use(express.static(distDir));
      app.get('*', (_req, res) => {
        res.sendFile(resolve(distDir, 'index.html'));
      });
    }
  }
}
