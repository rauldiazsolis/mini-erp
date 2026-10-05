import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { backupAll } from '../src/server/backup/backup.ts';

let root = '';

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seed(): { dataDir: string; backupDir: string } {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-backup-'));
  const dataDir = join(root, 'data');
  const systemDb = openSystemDb(join(dataDir, 'system.sqlite'));
  const tenants = new TenantManager(systemDb, { baseDir: join(dataDir, 'tenants') });
  tenants.createTenant({ id: 'kiosco-real', slug: 'kiosco-real', name: 'Kiosco real' });
  tenants.createTenant({ id: 'demo-abc', slug: 'demo-abc', name: 'Demo' });
  const at = new Date().toISOString();
  systemDb
    .prepare('INSERT INTO demo_tenants (tenant_id, template, last_full_reset_at) VALUES (?, ?, ?)')
    .run('demo-abc', 'kiosco', at);
  tenants.closeAll();
  systemDb.close();
  return { dataDir, backupDir: join(root, 'backups') };
}

describe('backupAll (#3)', () => {
  it('copia system y los comercios reales, sin las demos', () => {
    const { dataDir, backupDir } = seed();
    const result = backupAll({ dataDir, backupDir, now: new Date('2026-10-01T03:30:00Z'), keep: 7 });
    expect(result.dir).toBe(join(backupDir, '2026-10-01'));
    expect(result.tenants).toEqual(['kiosco-real']);
    expect(existsSync(join(result.dir, 'system.sqlite'))).toBe(true);
    expect(existsSync(join(result.dir, 'tenants', 'kiosco-real.sqlite'))).toBe(true);
    expect(existsSync(join(result.dir, 'tenants', 'demo-abc.sqlite'))).toBe(false);
    const copy = new DatabaseSync(join(result.dir, 'system.sqlite'), { readOnly: true });
    expect((copy.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number }).n).toBe(2);
    copy.close();
  });

  it('deja solo las últimas `keep` carpetas y reemplaza la del día', () => {
    const { dataDir, backupDir } = seed();
    for (const day of ['2026-09-20', '2026-09-21', '2026-09-22']) {
      mkdirSync(join(backupDir, day), { recursive: true });
    }
    backupAll({ dataDir, backupDir, now: new Date('2026-10-01T03:30:00Z'), keep: 2 });
    backupAll({ dataDir, backupDir, now: new Date('2026-10-01T04:00:00Z'), keep: 2 });
    expect(readdirSync(backupDir).sort()).toEqual(['2026-09-22', '2026-10-01']);
  });
});
