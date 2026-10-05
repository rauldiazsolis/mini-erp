import { createApp } from './app.ts';
import { DEV_BRANCH } from './seeds/dev-fixtures.ts';
import { setupClient } from './client-middleware.ts';
import { bootstrap, type DevInfo } from './bootstrap.ts';
import { dataDir } from './db/data-dir.ts';
import { runMigrationsInWorker } from './db/migrations/worker-runner.ts';
import { readDemoConfig } from './demo/demo-config.ts';
import { startServer } from './startup.ts';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4100;
const publicUrl = process.env['PUBLIC_URL']?.trim() ?? '';
const url = publicUrl === '' ? `http://localhost:${String(PORT)}` : publicUrl;

let devInfo: DevInfo | undefined;

// Arranque en dos fases (#47): mantenimiento mientras migra, después el app completo
const started = await startServer({
  port: PORT,
  dataDir: dataDir(),
  demos: readDemoConfig(process.env).enabled,
  runner: runMigrationsInWorker,
  createReadyHandler: async () => {
    const bundle = createApp();
    let sweepers: NodeJS.Timeout[] = [];
    try {
      // Barridos de demos (#9), de cobro (#21) y del embudo (#25), y datos de desarrollo solo fuera de producción (#3)
      const booted = bootstrap({ env: process.env, bundle });
      sweepers = [booted.sweeper, booted.billingSweeper, booted.funnelSweeper];
      devInfo = booted.devInfo;
      await setupClient(bundle.app);
      return bundle.app;
    } catch (err: unknown) {
      for (const timer of sweepers) clearInterval(timer);
      bundle.tenantManager.closeAll();
      bundle.systemDb.close();
      throw err;
    }
  },
});

console.log(`[mini-erp] escuchando en ${url}: en mantenimiento hasta terminar las migraciones`);

if ((await started.ready) === 'ready') {
  console.log(`\n==================================================`);
  console.log(`🚀 [mini-erp] Servidor iniciado en ${url}`);
  console.log(`🧪 Landing y demo:    ${url}/`);
  console.log(`🔧 Admin:             ${url}/admin`);
  console.log(`📡 Connector API POS: ${url}/connector`);
  console.log(`🔧 Admin API:         ${url}/api`);
  if (devInfo !== undefined) {
    console.log(`\n✨ Usuarios de desarrollo (contraseña: ${devInfo.password}):`);
    for (const u of devInfo.users) console.log(`   - ${u.email.padEnd(24)} ${u.label}`);
    console.log(`\n🔑 Keys del POS (sucursal ${DEV_BRANCH}):`);
    for (const k of devInfo.keys) console.log(`   - ${k.rawKey.padEnd(28)} ${k.label}`);
  }
  console.log(`\n(Servidor en ejecución, presiona Ctrl+C para detener)`);
  console.log(`==================================================\n`);
}
