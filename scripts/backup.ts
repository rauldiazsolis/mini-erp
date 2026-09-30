/** Backup nocturno (#3); lo corre `mini-erp-backup.timer` con el entorno del servicio. */
import { backupAll } from '../src/server/backup/backup.ts';
import { dataDir } from '../src/server/db/data-dir.ts';

const configured = process.env['BACKUP_DIR']?.trim() ?? '';
const backupDir = configured === '' ? 'backups' : configured;
const { dir, tenants } = backupAll({ dataDir: dataDir(), backupDir, now: new Date(), keep: 7 });
console.log(`[backup] ${dir}: system y ${String(tenants.length)} comercios`);
