import { createApp } from './app.ts';
import { DEV_ADMIN_PASS, DEV_BRANCH, DEV_POS } from './db/dev-seed.ts';
import { setupClient } from './client-middleware.ts';
import { bootstrap } from './bootstrap.ts';

const PORT = process.env['PORT'] ? Number(process.env['PORT']) : 4100;

const bundle = createApp();

// Barrido de demos (#9) y datos de desarrollo solo fuera de producción (#3)
const { devInfo } = bootstrap({ env: process.env, bundle });

await setupClient(bundle.app);

bundle.app.listen(PORT, () => {
  const publicUrl = process.env['PUBLIC_URL']?.trim() ?? '';
  const url = publicUrl === '' ? `http://localhost:${String(PORT)}` : publicUrl;
  console.log(`\n==================================================`);
  console.log(`🚀 [mini-erp] Servidor iniciado en ${url}`);
  console.log(`🧪 Landing y demo:    ${url}/`);
  console.log(`🔧 Admin:             ${url}/admin`);
  console.log(`📡 Connector API POS: ${url}/connector`);
  console.log(`🔧 Admin API:         ${url}/api`);
  if (devInfo !== undefined) {
    console.log(`\n✨ Credenciales de desarrollo:`);
    console.log(`   - Admin:    ${devInfo.email} (password: ${DEV_ADMIN_PASS})`);
    console.log(`   - POS Key:  ${devInfo.rawKey}`);
    console.log(`   - Sucursal: ${DEV_BRANCH}`);
    console.log(`   - Caja:     ${DEV_POS}`);
  }
  console.log(`\n(Servidor en ejecución, presiona Ctrl+C para detener)`);
  console.log(`==================================================\n`);
});
