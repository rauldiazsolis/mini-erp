/**
 * Backup de la base (#3): `pg_dump -Fc` de `DATABASE_URL` sin los esquemas de los comercios demo, a
 * `BACKUP_DIR`, con 7 días de retención (`src/server/backup/pg-backup.ts`). Lo corre
 * `mini-erp-backup.timer` cada noche y `deploy.sh` antes de activar una versión
 * (`systemctl start mini-erp-backup.service`), con el entorno del servicio. Sale con error si algo falla.
 */
import { runBackup } from '../src/server/backup/pg-backup.ts';
import { createDatabase, databaseUrl } from '../src/server/db/pg/database.ts';
import { demoTenantIds } from '../src/server/demo/demo-tenant-ids.ts';

async function main(): Promise<void> {
  const url = databaseUrl();
  const configured = process.env['BACKUP_DIR']?.trim() ?? '';
  const backupDir = configured === '' ? 'backups' : configured;
  const database = createDatabase({ connectionString: url, max: 1 });
  try {
    await runBackup({
      url,
      backupDir,
      now: () => new Date(),
      demoTenantIds: async () => (await demoTenantIds(database.system).execute()).map((row) => row.tenant_id),
    });
  } finally {
    await database.destroy();
  }
}

try {
  await main();
} catch (err: unknown) {
  console.error(`[backup] falló: ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
