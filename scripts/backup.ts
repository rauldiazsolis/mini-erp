/**
 * Backup nocturno (#3); lo corre `mini-erp-backup.timer` con el entorno del servicio. Hasta la fase 6
 * de la migración a PostgreSQL (`pg_dump -Fc`, sin los esquemas de demo, 7 días) no respalda nada y
 * sale con error a propósito: un backup que no copia nada no puede terminar en verde.
 */
console.error('[backup] pendiente: pg_dump (fase 6)');
process.exitCode = 1;
