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
import { POS_CHANNEL } from '../src/shared/contract-version.ts';

let dir = '';
afterEach(() => {
  if (dir !== '') rmSync(dir, { recursive: true, force: true });
  dir = '';
  vi.unstubAllEnvs();
});

function copiaLocal(): string {
  dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
  mkdirSync(join(dir, 'v4', 'assets'), { recursive: true });
  writeFileSync(join(dir, 'v4', 'index.html'), '<title>offline-pos</title>');
  writeFileSync(join(dir, 'v4', 'version.json'), '{"version":"0.3.1","contract":"4.5.0","minBackendContract":"4.0.0"}');
  writeFileSync(join(dir, 'v4', 'assets', 'index-AAA.js'), 'export {};');
  return dir;
}

describe('Copia local del POS en desarrollo (#9)', () => {
  it('sirve la copia en /pos/<canal>/', async () => {
    const app = express();
    mountPosMirror(app, copiaLocal());
    const res = await request(app).get('/pos/v4/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('offline-pos');
    expect((await request(app).get('/pos/v4/assets/index-AAA.js')).status).toBe(200);
  });

  it('un archivo que falta da 404 con la pista, no el SPA', async () => {
    const app = express();
    mountPosMirror(app, copiaLocal());
    app.use((_req, res) => {
      res.send('SPA');
    });
    const res = await request(app).get('/pos/v5/');
    expect(res.status).toBe(404);
    expect(res.text).toContain('pnpm pos:mirror');
  });

  it('ensurePosMirror baja la copia si falta', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const base = 'https://pos.contax.ar/v4/';
    const files: Record<string, string> = {
      [`${base}version.json`]: '{"version":"0.3.1","contract":"4.5.0","minBackendContract":"4.0.0"}',
      [`${base}index.html`]: '<title>offline-pos</title>',
    };
    const fetch: FetchLike = (url) =>
      Promise.resolve(files[url] === undefined ? new Response('', { status: 404 }) : new Response(files[url]));
    const log = vi.fn();

    await ensurePosMirror({ dir, channel: 'v4', fetch, log });
    expect(existsSync(join(dir, 'v4', 'index.html'))).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('0.3.1'));

    const fetchNunca = vi.fn<FetchLike>();
    await ensurePosMirror({ dir, channel: 'v4', fetch: fetchNunca, log });
    expect(fetchNunca).not.toHaveBeenCalled();
  });

  it('ensurePosMirror no tumba el arranque si no hay red', async () => {
    dir = mkdtempSync(join(tmpdir(), 'mini-erp-pos-'));
    const log = vi.fn();
    await expect(
      ensurePosMirror({ dir, channel: 'v4', fetch: () => Promise.reject(new Error('sin red')), log }),
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

describe('URL del POS del landing (#9, #58)', () => {
  it('en desarrollo, la copia local del canal en el mismo origen', () => {
    expect(posBaseUrl('http://localhost:4100', true, 'https://pos.contax.ar', 'v4')).toBe('http://localhost:4100/pos/v4/');
  });

  it('en producción, el canal del POS publicado', () => {
    expect(posBaseUrl('https://erp.example.com', false, 'https://pos.contax.ar', 'v4')).toBe('https://pos.contax.ar/v4/');
  });

  it('por defecto, el canal del contrato implementado', () => {
    expect(posBaseUrl('https://erp.example.com', false, 'https://pos.contax.ar')).toBe(`https://pos.contax.ar/${POS_CHANNEL}/`);
  });

  it('el link de demo lleva el Connector API de este mini-erp', () => {
    const url = new URL(buildDemoUrl('http://localhost:4100/pos/v4/', 'http://localhost:4100'));
    expect(`${url.origin}${url.pathname}`).toBe('http://localhost:4100/pos/v4/');
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('http://localhost:4100/connector');
  });
});
