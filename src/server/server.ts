import { createApp } from './app.ts';
import { ensureDevData, DEV_BRANCH, DEV_POS } from './db/dev-seed.ts';
import { setupClient } from './client-middleware.ts';
import { startDemoSweeper } from './demo/demo-session-service.ts';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4100;

const bundle = createApp();

// Demos aisladas (#9): barrer las vencidas al arrancar y cada 15 minutos
startDemoSweeper(bundle.demoSessions, 15 * 60 * 1000);

const devInfo = ensureDevData({
  systemDb: bundle.systemDb,
  authService: bundle.authService,
  tenantManager: bundle.tenantManager,
});

await setupClient(bundle.app);

bundle.app.listen(PORT, () => {
  console.log(`\n==================================================`);
  console.log(`🚀 [mini-erp] Servidor iniciado en http://localhost:${String(PORT)}`);
  console.log(`🧪 Landing y demo:    http://localhost:${String(PORT)}/`);
  console.log(`🔧 Admin:             http://localhost:${String(PORT)}/admin`);
  console.log(`📡 Connector API POS: http://localhost:${String(PORT)}/connector`);
  console.log(`🔧 Admin API:         http://localhost:${String(PORT)}/api`);
  console.log(`\n✨ Credenciales de desarrollo:`);
  console.log(`   - Admin:    ${devInfo.email} (password: admin123)`);
  console.log(`   - POS Key:  ${devInfo.rawKey}`);
  console.log(`   - Sucursal: ${DEV_BRANCH}`);
  console.log(`   - Caja:     ${DEV_POS}`);
  console.log(`\n(Servidor en ejecución, presiona Ctrl+C para detener)`);
  console.log(`==================================================\n`);
});
