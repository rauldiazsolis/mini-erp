import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import type { FunnelReport, FunnelVisitorDetail, FunnelVisitorList } from '../src/shared/funnel-types.ts';

describe('el embudo en la plataforma (#25)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tokens: { support: string; root: string; owner: string; supportId: string };
  let contactId: string;

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    const support = bundle.authService.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    bundle.authService.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const rootToken = bundle.authService.login({ email: 'root@x.com', password: 'password123' }).token;
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco', ownerUserId: owner.user.id });
    tokens = { support: support.token, root: rootToken, owner: owner.token, supportId: support.user.id };
    const res = await request(app).post('/api/funnel/contacts').send({ name: 'Beto', whatsapp: '1144440000', source: 'landing' });
    contactId = (res.body as { id: string }).id;
  });

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('el reporte usa por omisión los últimos 30 días argentinos', async () => {
    const res = await request(app).get('/api/platform/funnel').set(as(tokens.support));
    expect(res.status).toBe(200);
    const body = res.body as FunnelReport;
    expect([body.from, body.to]).toEqual(['2026-09-06', '2026-10-05']);
    expect(body.stages.find((s) => s.stage === 'contact')?.total).toBe(1);
  });

  it('una fecha o un filtro inválido da 400', async () => {
    const res = await request(app).get('/api/platform/funnel?desde=05-10-2026').set(as(tokens.root));
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('Fecha inválida');
    expect((await request(app).get('/api/platform/visitors?etapa=nada').set(as(tokens.root))).status).toBe(400);
  });

  it('lista los visitantes y trae la historia de uno', async () => {
    const list = await request(app).get('/api/platform/visitors?filtro=pending').set(as(tokens.root));
    expect(list.status).toBe(200);
    const body = list.body as FunnelVisitorList;
    expect(body.from).toBeNull();
    expect(body.items.map((i) => i.id)).toEqual([`c-${contactId}`]);
    const detail = await request(app).get(`/api/platform/visitors/c-${contactId}`).set(as(tokens.root));
    expect(detail.status).toBe(200);
    expect((detail.body as FunnelVisitorDetail).contact).toMatchObject({ name: 'Beto', whatsapp: '1144440000' });
    expect((await request(app).get('/api/platform/visitors/nada').set(as(tokens.root))).status).toBe(404);
  });

  it('marcar atendido baja el contador y queda en la auditoría', async () => {
    expect((await request(app).get('/api/platform/contacts/pending-count').set(as(tokens.support))).body).toEqual({ count: 1 });
    const res = await request(app).post(`/api/platform/contacts/${contactId}/handled`).set(as(tokens.support));
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/platform/contacts/pending-count').set(as(tokens.support))).body).toEqual({ count: 0 });
    expect(systemDb.prepare("SELECT actor_user_id AS actor, details FROM audit_log WHERE action = 'funnel.contact-handled'").all()).toEqual([
      { actor: tokens.supportId, details: JSON.stringify({ contactId }) },
    ]);
    const detail = await request(app).get(`/api/platform/visitors/c-${contactId}`).set(as(tokens.root));
    expect((detail.body as FunnelVisitorDetail).contact).toMatchObject({ handledByName: 'Ana' });
    expect((await request(app).post('/api/platform/contacts/nada/handled').set(as(tokens.support))).status).toBe(404);
  });

  it('un usuario común no entra a ninguna', async () => {
    for (const path of ['/api/platform/funnel', '/api/platform/visitors', `/api/platform/visitors/c-${contactId}`, '/api/platform/contacts/pending-count']) {
      expect((await request(app).get(path).set(as(tokens.owner))).status).toBe(403);
    }
    expect((await request(app).post(`/api/platform/contacts/${contactId}/handled`).set(as(tokens.owner))).status).toBe(403);
  });
});
