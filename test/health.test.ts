import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';

describe('App Scaffolding & Healthcheck', () => {
  it('responde 200 OK en /health con el status correcto', async () => {
    const app = createApp();
    const res = await request(app).get('/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', service: 'mini-erp' });
  });
});
