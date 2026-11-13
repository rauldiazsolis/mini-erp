import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, afterAll, afterEach } from 'vitest';
import { createDatabase } from '../src/server/db/pg/database.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { DemoSessionService } from '../src/server/demo/demo-session-service.ts';
import {
  backupFileName,
  excludeSchemaArg,
  filesToDelete,
  parseBackupFileName,
  pgConnection,
  pgDumpArgs,
  runBackup,
  type BackupDeps,
} from '../src/server/backup/pg-backup.ts';
import { createDb, dropDb, TEST_DB_PREFIX, testDbUrl, withAdmin } from './helpers/pg-admin.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

const NOW = new Date('2026-11-13T03:30:07.123Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const dirs: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'minierp-backup-test-'));
  dirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of dirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('nombres de los backups', () => {
  it('lleva la fecha y la hora UTC, sin dos puntos ni milisegundos', () => {
    expect(backupFileName(NOW)).toBe('minierp-2026-11-13T03-30-07Z.dump');
  });

  it('se lee de vuelta, también el .tmp de una corrida a medias', () => {
    expect(parseBackupFileName('minierp-2026-11-13T03-30-07Z.dump')).toEqual({ at: new Date('2026-11-13T03:30:07Z'), partial: false });
    expect(parseBackupFileName('minierp-2026-11-13T03-30-07Z.dump.tmp')).toEqual({ at: new Date('2026-11-13T03:30:07Z'), partial: true });
  });

  it('ignora lo que no es un backup suyo', () => {
    for (const name of ['otro.dump', 'minierp-2026-11-13.dump', 'minierp-2026-11-13T03-30-07Z.sql', 'xminierp-2026-11-13T03-30-07Z.dump', 'minierp-2026-13-45T99-99-99Z.dump']) {
      expect(parseBackupFileName(name)).toBeUndefined();
    }
  });
});

describe('argumentos de pg_dump', () => {
  it('entrecomilla el esquema: el guion y los comodines no son patrones', () => {
    expect(excludeSchemaArg('tenant_demo-kiosco')).toBe('--exclude-schema="tenant_demo-kiosco"');
  });

  it('formato custom, al .tmp, un --exclude-schema por demo y la base al final', () => {
    expect(pgDumpArgs({ file: '/b/x.dump.tmp', dbname: 'postgres://u@h/db', excludeSchemas: ['tenant_demo-kiosco', 'tenant_demo-almacen'] })).toEqual([
      '--format=custom',
      '--file=/b/x.dump.tmp',
      '--exclude-schema="tenant_demo-kiosco"',
      '--exclude-schema="tenant_demo-almacen"',
      '--dbname=postgres://u@h/db',
    ]);
  });

  it('saca la contraseña de la URL y la pasa por PGPASSWORD (los argumentos los ve cualquiera con ps)', () => {
    expect(pgConnection('postgres://minierp:cl%40ve@localhost:5432/minierp')).toEqual({
      dbname: 'postgres://minierp@localhost:5432/minierp',
      env: { PGPASSWORD: 'cl@ve' },
    });
  });

  it('una URL sin contraseña (socket) pasa tal cual', () => {
    const url = 'postgres:///minierp?host=/var/run/postgresql';
    expect(pgConnection(url)).toEqual({ dbname: url, env: {} });
  });
});

describe('retención', () => {
  // El nombre va al segundo: la cuenta se hace desde un segundo justo
  const T = new Date('2026-11-13T03:30:07Z');
  const at = (ms: number) => backupFileName(new Date(T.getTime() - ms));

  it('borra los backups de más de 7 días y deja los demás', () => {
    const viejo = at(7 * DAY + 1000);
    const justo = at(7 * DAY);
    const nuevo = at(DAY);
    expect(filesToDelete([viejo, justo, nuevo], T)).toEqual([viejo]);
  });

  it('borra los .tmp de corridas fallidas de más de un día, no los recientes', () => {
    const tmpViejo = `${at(DAY + 1000)}.tmp`;
    const tmpReciente = `${at(HOUR)}.tmp`;
    expect(filesToDelete([tmpViejo, tmpReciente], T)).toEqual([tmpViejo]);
  });

  it('no toca otros archivos', () => {
    expect(filesToDelete(['notas.txt', 'minierp-viejo.dump', 'backup-2020-01-01T00-00-00Z.dump', '2020-01-01'], NOW)).toEqual([]);
  });
});

describe('runBackup con dependencias de prueba', () => {
  const logs: string[] = [];
  afterEach(() => logs.splice(0));

  function deps(backupDir: string, over: Partial<BackupDeps> = {}): BackupDeps {
    return {
      url: 'postgres://u:secreta@h/db',
      backupDir,
      now: () => NOW,
      demoTenantIds: () => Promise.resolve(['demo-kiosco', 'demo-almacen']),
      pgDump: (args) => {
        const file = args.find((a) => a.startsWith('--file='))?.slice('--file='.length) ?? '';
        writeFileSync(file, 'PGDMP falso');
        return Promise.resolve();
      },
      log: (line) => logs.push(line),
      ...over,
    };
  }

  it('escribe al .tmp, renombra, borra lo viejo y lo cuenta en el log', async () => {
    const dir = tempDir();
    const viejo = backupFileName(new Date(NOW.getTime() - 8 * DAY));
    writeFileSync(join(dir, viejo), 'x');
    writeFileSync(join(dir, 'otro.txt'), 'x');
    let seen: { args: string[]; env: Record<string, string> } | undefined;
    const result = await runBackup(
      deps(dir, {
        pgDump: (args, env) => {
          seen = { args, env };
          writeFileSync(join(dir, `${backupFileName(NOW)}.tmp`), 'PGDMP falso');
          return Promise.resolve();
        },
      }),
    );
    expect(result).toEqual({ file: join(dir, 'minierp-2026-11-13T03-30-07Z.dump'), bytes: 11, excludedSchemas: 2, deleted: [viejo] });
    expect(seen?.args).toContain('--exclude-schema="tenant_demo-kiosco"');
    expect(seen?.args).toContain('--dbname=postgres://u@h/db');
    expect(seen?.env).toEqual({ PGPASSWORD: 'secreta' });
    expect(readdirSync(dir).sort()).toEqual(['minierp-2026-11-13T03-30-07Z.dump', 'otro.txt']);
    expect(logs.join('\n')).toMatch(/\[backup\].*minierp-2026-11-13T03-30-07Z\.dump.*11 B.*2 esquemas demo/);
    expect(logs.join('\n')).toMatch(/\[backup\] retención: 1 borrado/);
  });

  it('si pg_dump falla, borra el .tmp, no toca los backups viejos y tira el error', async () => {
    const dir = tempDir();
    const viejo = backupFileName(new Date(NOW.getTime() - 8 * DAY));
    writeFileSync(join(dir, viejo), 'x');
    const failing = deps(dir, {
      pgDump: (args) => {
        const file = args.find((a) => a.startsWith('--file='))?.slice('--file='.length) ?? '';
        writeFileSync(file, 'a medias');
        return Promise.reject(new Error('pg_dump terminó con código 1'));
      },
    });
    await expect(runBackup(failing)).rejects.toThrow('pg_dump terminó con código 1');
    expect(readdirSync(dir)).toEqual([viejo]);
  });

  it('crea la carpeta si no existe', async () => {
    const dir = join(tempDir(), 'anidada', 'backups');
    await runBackup(deps(dir));
    expect(readdirSync(dir)).toEqual(['minierp-2026-11-13T03-30-07Z.dump']);
  });
});

/** pg_restore (de /usr/bin, como pg_dump), sin shell. */
function pgRestore(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync('pg_restore', args, { encoding: 'utf-8' });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('backup real contra PostgreSQL', () => {
  const restored = `${TEST_DB_PREFIX}restore_w${process.env.VITEST_POOL_ID ?? '0'}`;

  afterAll(async () => {
    await withAdmin((client) => dropDb(client, restored));
  });

  it('respalda el comercio real (aunque se llame demo-…), excluye los demo y se restaura en una base nueva', async () => {
    const tenantManager = new TenantManager(db());
    const sessions = new DemoSessionService({
      db: db().system,
      tenantManager,
      apiKeyService: new ApiKeyService(db().system),
      config: { enabled: true, ttlHours: 24, maxActive: 200, resetHour: 4 },
      now: () => new Date(),
    });
    await sessions.ensureDemoTenants();
    // Un comercio real cuyo id empieza con "demo-": no se excluye por prefijo
    await tenantManager.createTenant({ id: 'demo-plaza', slug: 'demo-plaza', name: 'Demo Plaza (real)', seedDemoData: true });
    const productos = await db().forTenant('demo-plaza').selectFrom('products').select(['id', 'name', 'price']).orderBy('id').execute();
    expect(productos.length).toBeGreaterThan(0);

    const dir = tempDir();
    const url = testDbUrl(`${TEST_DB_PREFIX}w${process.env.VITEST_POOL_ID ?? '0'}`);
    const result = await runBackup({
      url,
      backupDir: dir,
      now: () => new Date(),
      demoTenantIds: async () => (await db().system.selectFrom('demo_tenants').select('tenant_id').execute()).map((r) => r.tenant_id),
      log: () => undefined,
    });
    expect(result.excludedSchemas).toBe(3);
    expect(statSync(result.file).size).toBeGreaterThan(0);

    const list = pgRestore(['--list', result.file]);
    expect(list.status).toBe(0);
    expect(list.stdout).toMatch(/SCHEMA - tenant_demo-plaza /);
    expect(list.stdout).not.toMatch(/tenant_demo-kiosco|tenant_demo-almacen|tenant_demo-ferreteria/);
    expect(list.stdout).toMatch(/EXTENSION - unaccent/);

    await withAdmin((client) => createDb(client, restored, 'template0'));
    const restore = pgRestore(['--exit-on-error', '--no-owner', `--dbname=${testDbUrl(restored)}`, result.file]);
    expect(restore.stderr).toBe('');
    expect(restore.status).toBe(0);

    const copia = createDatabase({ connectionString: testDbUrl(restored), max: 1 });
    try {
      expect(await copia.forTenant('demo-plaza').selectFrom('products').select(['id', 'name', 'price']).orderBy('id').execute()).toEqual(productos);
      // Las filas de sistema de las demos van; sus esquemas, no
      const demos = await copia.system.selectFrom('demo_tenants').select('tenant_id').orderBy('tenant_id').execute();
      expect(demos.map((d) => d.tenant_id)).toEqual(['demo-almacen', 'demo-ferreteria', 'demo-kiosco']);
      const schemas = await withRestored(restored, "SELECT nspname FROM pg_namespace WHERE nspname LIKE 'tenant\\_%' ORDER BY 1");
      expect(schemas.rows).toEqual([{ nspname: 'tenant_demo-plaza' }]);
      // unaccent viene en el dump: la búsqueda sin tildes anda en la copia
      const { rows } = await withRestored(restored, "SELECT public.unaccent('Café') AS v");
      expect(rows).toEqual([{ v: 'Cafe' }]);
    } finally {
      await copia.destroy();
    }
  });
});

async function withRestored(dbName: string, query: string): Promise<{ rows: unknown[] }> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: testDbUrl(dbName) });
  await client.connect();
  try {
    return { rows: (await client.query(query)).rows };
  } finally {
    await client.end();
  }
}
