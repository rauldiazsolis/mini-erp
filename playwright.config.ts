import { defineConfig, devices } from '@playwright/test';

/**
 * e2e (#9): el mini-erp en desarrollo, en su propio puerto y con una base descartable, sirve la copia
 * local del canal del POS publicado en /pos/<canal>/. El recorrido de la demo corre entero en el mismo origen.
 */
export const E2E_PORT = 4110;
export const E2E_DATA_DIR = 'test-results/e2e-data';

export default defineConfig({
  testDir: './e2e',
  reporter: 'list',
  // Un reintento solo en CI: así `trace: 'on-first-retry'` deja la traza de un flake
  retries: process.env['CI'] ? 1 : 0,
  use: {
    baseURL: `http://localhost:${String(E2E_PORT)}`,
    trace: 'on-first-retry',
    // El POS es una PWA: en el e2e corre como una página común, sin service worker (#58)
    serviceWorkers: 'block',
  },
  // Solo Chromium, como offline-pos
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'node e2e/serve.ts',
    url: `http://localhost:${String(E2E_PORT)}/health`,
    // Todos los specs piden login, alta e invitaciones desde la misma IP: el límite de 20 cada 15
    // minutos (que prueba Vitest) los haría fallar según el orden de los workers (#81). Lo mismo con los
    // beacons y los contactos del embudo (#25)
    env: { PORT: String(E2E_PORT), DATA_DIR: E2E_DATA_DIR, AUTH_RATE_LIMIT: '1000', BEACON_RATE_LIMIT: '1000', CONTACT_RATE_LIMIT: '1000' },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
