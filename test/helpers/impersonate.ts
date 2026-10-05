import request from 'supertest';
import type { Express } from 'express';

/** Abre una impersonación (#23) con la sesión de soporte o root y devuelve su token. */
export async function impersonate(app: Express, staffToken: string, userId: string, tenantSlug?: string): Promise<string> {
  const res = await request(app)
    .post('/api/impersonations')
    .set('Authorization', `Bearer ${staffToken}`)
    .send(tenantSlug === undefined ? { userId } : { userId, tenantSlug });
  if (res.status !== 201) throw new Error(`No se pudo impersonar: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return (res.body as { token: string }).token;
}
