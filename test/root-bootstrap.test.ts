import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';

describe('AuthService.ensureRoot (#3)', () => {
  let auth: AuthService;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    initSystemDb(db);
    auth = new AuthService(db);
  });

  it('crea el root si el email no existe', async () => {
    const { user, created } = await auth.ensureRoot({ email: 'Root@Erp.com ', password: 'una-clave-larga', name: 'Root' });
    expect(created).toBe(true);
    expect(user).toMatchObject({ email: 'root@erp.com', globalRole: 'root' });
    expect((await auth.login({ email: 'root@erp.com', password: 'una-clave-larga' })).user.globalRole).toBe('root');
  });

  it('promueve a root un usuario existente y le pone la contraseña dada', async () => {
    await auth.createUser({ email: 'ana@erp.com', password: 'vieja123', name: 'Ana' });
    const { user, created } = await auth.ensureRoot({ email: 'ana@erp.com', password: 'nueva-clave-larga', name: 'Ana' });
    expect(created).toBe(false);
    expect(user.globalRole).toBe('root');
    await expect(auth.login({ email: 'ana@erp.com', password: 'vieja123' })).rejects.toThrow();
    expect((await auth.login({ email: 'ana@erp.com', password: 'nueva-clave-larga' })).user.globalRole).toBe('root');
  });
});
