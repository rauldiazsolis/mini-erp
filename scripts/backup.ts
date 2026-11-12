/**
 * Backup nocturno (#3); lo corre `mini-erp-backup.timer` con el entorno del servicio. Copia las bases
 * de SQLite de los comercios reales; la lista sale de la base de `DATABASE_URL`. El sistema
 * (PostgreSQL) va con `pg_dump`, en la fase 6 de la migración.
 */
import { backupAll } from '../src/server/backup/backup.ts';
import { dataDir } from '../src/server/db/data-dir.ts';
import { createDatabase, databaseUrl } from '../src/server/db/pg/database.ts';

const configured = process.env['BACKUP_DIR']?.trim() ?? '';
const backupDir = configured === '' ? 'backups' : configured;
const database = createDatabase({ connectionString: databaseUrl(), max: 1 });
try {
  const { dir, tenants } = await backupAll({ system: database.system, dataDir: dataDir(), backupDir, now: new Date(), keep: 7 });
  console.log(`[backup] ${dir}: ${String(tenants.length)} comercios (el sistema va con pg_dump)`);
} finally {
  await database.destroy();
}
