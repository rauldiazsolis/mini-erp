import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DEMO_TENANT_IDS_SQL } from '../demo/demo-tenant-ids.ts';

const DAY_DIR = /^\d{4}-\d{2}-\d{2}$/;

/** `VACUUM INTO`: copia consistente aunque el servidor esté escribiendo. */
function copyDb(from: string, to: string): void {
  const db = new DatabaseSync(from, { readOnly: true, timeout: 10_000 });
  try {
    db.prepare('VACUUM INTO ?').run(to);
  } finally {
    db.close();
  }
}

/**
 * Backup nocturno (#3): `system.sqlite` y cada comercio real (las demos no) en `<backupDir>/<día>/`.
 * Reemplaza la carpeta del día y deja las últimas `keep`.
 */
export function backupAll(params: { dataDir: string; backupDir: string; now: Date; keep: number }): {
  dir: string;
  tenants: string[];
} {
  const systemPath = join(params.dataDir, 'system.sqlite');
  const system = new DatabaseSync(systemPath, { readOnly: true, timeout: 10_000 });
  const rows = system
    .prepare(`SELECT id FROM tenants WHERE id NOT IN ${DEMO_TENANT_IDS_SQL} ORDER BY id`)
    .all() as { id: string }[];
  system.close();

  const dir = join(params.backupDir, params.now.toISOString().slice(0, 10));
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(join(dir, 'tenants'), { recursive: true });
  copyDb(systemPath, join(dir, 'system.sqlite'));

  const tenants: string[] = [];
  for (const { id } of rows) {
    const file = join(params.dataDir, 'tenants', `${id}.sqlite`);
    if (existsSync(file)) {
      copyDb(file, join(dir, 'tenants', `${id}.sqlite`));
      tenants.push(id);
    }
  }

  const days = readdirSync(params.backupDir)
    .filter((d) => DAY_DIR.test(d))
    .sort();
  for (const old of days.slice(0, Math.max(0, days.length - params.keep))) {
    rmSync(join(params.backupDir, old), { recursive: true, force: true });
  }
  return { dir, tenants };
}
