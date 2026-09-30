import { describe, it, expect, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensurePosMirror, mountPosMirror } from '../src/server/pos-mirror/serve.ts';
import type { FetchLike } from '../src/server/pos-mirror/mirror.ts';
import { dataDir } from '../src/server/db/data-dir.ts';
import { buildDemoUrl, posBaseUrl } from '../src/client/state/demo-link.ts';

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
  dir = '';
  vi.unstubAllEnvs();
});

function copiaLocal(): string {
  dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
  mkdirSync(join(dir, '0.1.0', 'assets'), { recursive: true });
  writeFileSync(join(dir, '0.1.0', 'index.html'), '<title>offline-pos</title>');
  writeFileSync(join(dir, '0.1.0', 'version.json'), '{"version":"0.1.0"}');
  writeFileSync(join(dir, '0.1.0', 'assets', 'index-AAA.js'), 'export {};');
  return dir;
}

describe('Copia local del POS en desarrollo (#9)', () => {
  it('sirve la copia en /pos/<versión>/', async () => {
    const app = express();
    mountPosMirror(app, copiaLocal());
    const res = await request(app).get('/pos/0.1.0/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('offline-pos');
    expect((await request(app).get('/pos/0.1.0/assets/index-AAA.js')).status).toBe(200);
  });

  it('un archivo que falta da 404 con la pista, no el SPA', async () => {
    const app = express();
    mountPosMirror(app, copiaLocal());
    app.use((_req, res) => {
      res.send('SPA');
    });
    const res = await request(app).get('/pos/0.2.0/');
    expect(res.status).toBe(404);
    expect(res.text).toContain('pnpm pos:mirror');
  });

  it('ensurePosMirror baja la copia si falta', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const base = 'https://offline-pos.pages.dev/0.1.0/';
    const files: Record<string, string> = {
      [`${base}version.json`]: '{"version":"0.1.0","contract":"4.4.0","minBackendContract":"4.0.0"}',
      [`${base}index.html`]: '<title>offline-pos</title>',
    };
    const fetch: FetchLike = (url) =>
      Promise.resolve(files[url] === undefined ? new Response('', { status: 404 }) : new Response(files[url]));
    const log = vi.fn();

    await ensurePosMirror({ dir, version: '0.1.0', fetch, log });
    expect(existsSync(join(dir, '0.1.0', 'index.html'))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('0.1.0'));

    const fetchNunca = vi.fn<FetchLike>();
    await ensurePosMirror({ dir, version: '0.1.0', fetch: fetchNunca, log });
    expect(fetchNunca).not.toHaveBeenCalled();
  });

  it('ensurePosMirror no tumba el arranque si no hay red', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const log = vi.fn();
    await expect(
      ensurePosMirror({ dir, version: '0.1.0', fetch: () => Promise.reject(new Error('sin red')), log }),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('pnpm pos:mirror'));
  });
});

describe('DATA_DIR (#9)', () => {
  it('por defecto es data/', () => {
    vi.stubEnv('DATA_DIR', '');
    expect(dataDir()).toBe('data');
  });

  it('se puede mover, para el e2e', () => {
    vi.stubEnv('DATA_DIR', 'test-results/e2e-data');
    expect(dataDir()).toBe('test-results/e2e-data');
  });
});

describe('URL del POS del landing (#9)', () => {
  it('en desarrollo, la copia local del mismo origen', () => {
    expect(posBaseUrl('0.1.0', 'http://localhost:4100', true)).toBe('http://localhost:4100/pos/0.1.0/');
  });

  it('en producción, el POS publicado', () => {
    expect(posBaseUrl('0.1.0', 'https://erp.example.com', false)).toBe('https://offline-pos.pages.dev/0.1.0/');
  });

  it('el link de demo lleva el Connector API de este mini-erp', () => {
    const url = new URL(buildDemoUrl('http://localhost:4100/pos/0.1.0/', 'http://localhost:4100'));
    expect(`${url.origin}${url.pathname}`).toBe('http://localhost:4100/pos/0.1.0/');
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('http://localhost:4100/connector');
  });
});
