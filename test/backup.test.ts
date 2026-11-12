import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { backupAll } from '../src/server/backup/backup.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

let root = '';

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

async function seed(): Promise<{ dataDir: string; backupDir: string }> {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-backup-'));
  const dataDir = join(root, 'data');
  const tenants = new TenantManager(db().system, { baseDir: join(dataDir, 'tenants') });
  await tenants.createTenant({ id: 'kiosco-real', slug: 'kiosco-real', name: 'Kiosco real' });
  await tenants.createTenant({ id: 'demo-abc', slug: 'demo-abc', name: 'Demo' });
  const at = new Date().toISOString();
  await db().system.insertInto('demo_tenants').values({ tenant_id: 'demo-abc', template: 'kiosco', last_full_reset_at: at }).execute();
  tenants.closeAll();
  return { dataDir, backupDir: join(root, 'backups') };
}

describe('backupAll (#3)', () => {
  it('copia los comercios reales, sin las demos ni lo de sistema (eso es PostgreSQL)', async () => {
    const { dataDir, backupDir } = await seed();
    const result = await backupAll({ system: db().system, dataDir, backupDir, now: new Date('2026-10-01T03:30:00Z'), keep: 7 });
    expect(result.dir).toBe(join(backupDir, '2026-10-01'));
    expect(result.tenants).toEqual(['kiosco-real']);
    expect(existsSync(join(result.dir, 'system.sqlite'))).toBe(false);
    expect(existsSync(join(result.dir, 'tenants', 'kiosco-real.sqlite'))).toBe(true);
    expect(existsSync(join(result.dir, 'tenants', 'demo-abc.sqlite'))).toBe(false);
  });

  it('deja solo las últimas `keep` carpetas y reemplaza la del día', async () => {
    const { dataDir, backupDir } = await seed();
    for (const day of ['2026-09-20', '2026-09-21', '2026-09-22']) {
      mkdirSync(join(backupDir, day), { recursive: true });
    }
    await backupAll({ system: db().system, dataDir, backupDir, now: new Date('2026-10-01T03:30:00Z'), keep: 2 });
    await backupAll({ system: db().system, dataDir, backupDir, now: new Date('2026-10-01T04:00:00Z'), keep: 2 });
    expect(readdirSync(backupDir).sort()).toEqual(['2026-09-22', '2026-10-01']);
  });
});
