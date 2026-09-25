import type { Express } from 'express';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import express from 'express';

export async function setupClient(app: Express): Promise<void> {
  const isProd = process.env['NODE_ENV'] === 'production';
  const clientDir = resolve(import.meta.dirname, '../client');
  const distDir = resolve(import.meta.dirname, '../../dist/client');

  if (!isProd) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
      root: clientDir,
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
