# Deploy público en Lightsail: plan de implementación

> **Para agentes:** se ejecuta con superpowers:executing-plans, **inline y tarea por tarea** (nunca un
> subagente por tarea, AGENTS.md). Al terminar cada tarea: verificar, commitear y frenar para la
> revisión del usuario. Pasos con casillas (`- [ ]`).

**Objetivo:** publicar el mini-erp en AWS Lightsail con HTTPS como backend de la demo pública del POS,
cerrando antes el root por registro, el seed de desarrollo y los pedidos sin límite (#3).

**Arquitectura:** cambios chicos en la app (auth, arranque, rate limit, backup), todos con TDD; una
carpeta `deploy/` con el aprovisionamiento de la instancia (systemd + Caddy + `sslip.io`) y un
workflow de GitHub Actions que reusa el CI y despliega por SSH con vuelta atrás.

**Stack:** Node 24 (strip de tipos), Express 4, `node:sqlite`, Vitest + supertest, Playwright,
GitHub Actions, Ubuntu 24.04, systemd, Caddy 2.

**Spec:** [`docs/superpowers/specs/2026-09-30-deploy-publico-design.md`](../specs/2026-09-30-deploy-publico-design.md)

## Restricciones globales

- Todo en español: código, comentarios, commits, docs.
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores; `unknown` solo en fronteras y
  validado con Zod. Sin parameter properties. Imports relativos con extensión `.ts`.
- Opcionales con `exactOptionalPropertyTypes`: entradas `x?: T | undefined`; en resultados propios la
  propiedad se omite (`...(x === undefined ? {} : { x })`).
- Sin dependencias nuevas.
- Valores fijos: `DEMO_RATE_LIMIT` = 10 demos por hora por IP; `AUTH_RATE_LIMIT` = 20 pedidos cada 15
  minutos por IP (login y registro comparten contador); `DEMO_MAX_ACTIVE` = 200; backups: 7 días;
  versiones en el servidor: 5; contraseña del root: mínimo 12 caracteres.
- pnpm se corre desde **PowerShell**; git y gh desde Bash.
- Cada tarea cierra con `pnpm lint && pnpm typecheck && pnpm test` en verde, más `pnpm build` y
  `pnpm test:e2e` donde se indica. Commits convencionales en español con el co-autor.
- Credenciales, llaves y secretos los carga el usuario; el agente no los ve ni los escribe.

## Mapa de archivos

| Archivo | Tarea | Responsabilidad |
|---|---|---|
| `e2e/demo-onboarding.spec.ts` | 1 | e2e estable ante escrituras concurrentes y reintentos |
| `src/server/auth/auth-service.ts` | 2 | `register` siempre `user`; `ensureRoot` |
| `src/server/db/dev-seed.ts` | 2 | el admin de desarrollo con `ensureRoot` |
| `scripts/create-root.ts` | 2 | comando interactivo del root inicial |
| `src/server/bootstrap.ts` | 3 | arranque: barrido de demos y seed solo fuera de producción |
| `src/server/server.ts` | 3 | usa `bootstrap`; banner sin credenciales en producción |
| `src/server/demo/demo-session-service.ts` | 3 | el barrido loguea lo que borra |
| `src/server/middleware/rate-limit.ts` | 4 | limitador por IP y su config |
| `src/server/demo/demo-config.ts` | 4 | exporta `positiveInt` |
| `src/server/app.ts`, `routes/auth-routes.ts`, `routes/connector-routes.ts` | 4 | montaje del limitador y `trust proxy` |
| `src/server/backup/backup.ts`, `scripts/backup.ts` | 5 | copia nocturna con `VACUUM INTO` |
| `deploy/*` | 6 | aprovisionamiento, unidades, Caddy, activación de versiones |
| `.github/workflows/ci.yml`, `deploy.yml` | 7 | CI reusable y deploy |
| `README.md`, `AGENTS.md`, `PLAN.md`, `deploy/README.md` | 8 | documentación |

---

### Tarea 1: e2e estable

El último CI de `main` falló: `database is locked` al leer el SQLite mientras el servidor escribía, y
el reintento chocó con el email ya registrado.

**Archivos:** Modificar `e2e/demo-onboarding.spec.ts`.

- [ ] **Paso 1: abrir la base con espera.** En `query`:

```ts
function query<T>(file: string, sql: string, ...params: string[]): T[] {
  // timeout: si el servidor está escribiendo un lote, espera en lugar de fallar con "database is locked"
  const db = new DatabaseSync(join(E2E_DATA_DIR, file), { readOnly: true, timeout: 5000 });
```

- [ ] **Paso 2: email por intento y la demo más reciente.** Sacar la constante `EMAIL`; el test
  recibe `testInfo`:

```ts
test('landing → demo → venta → /ALTA → alta → el POS vuelve conectado al comercio nuevo', async ({ page }, testInfo) => {
  // Un reintento reusa el servidor y la base: email propio por intento
  const email = `e2e-alta-${String(testInfo.retry)}@local.test`;
```

  Reemplazar los usos de `EMAIL` por `email`, y la consulta de la demo por:

```ts
  const [demo] = query<{ tenant_id: string; template: string }>(
    'system.sqlite',
    'SELECT tenant_id, template FROM demo_sessions ORDER BY created_at DESC LIMIT 1',
  );
```

- [ ] **Paso 3: verificar.** En PowerShell: `pnpm lint; pnpm typecheck; pnpm exec playwright test --repeat-each 3`.
  Esperado: 3 pasadas en verde.
- [ ] **Paso 4: commit.** `test: e2e estable ante escrituras concurrentes y reintentos`.

---

### Tarea 2: root inicial por comando

**Archivos:**
- Modificar: `src/server/auth/auth-service.ts`, `src/server/db/dev-seed.ts`
- Crear: `scripts/create-root.ts`
- Tests: `test/auth-and-tenants.test.ts`, `test/root-bootstrap.test.ts` (nuevo)

**Interfaces que produce:**
`AuthService.ensureRoot(params: { email: string; password: string; name: string }): { user: UserSession; created: boolean }`

- [ ] **Paso 1: tests que fallan.** En `test/auth-and-tenants.test.ts`, reemplazar
  "asigna rol root al primer usuario…" por:

```ts
  it('registra siempre con rol "user", aunque sea el primer usuario', async () => {
    const res1 = await request(app)
      .post('/api/auth/register')
      .send({ email: 'primero@sistema.com', password: 'password123', name: 'Primero' });
    expect(res1.status).toBe(201);
    const body1 = res1.body as unknown as { user: { globalRole: string }; token: string };
    expect(body1.user.globalRole).toBe('user');
    expect(typeof body1.token).toBe('string');
  });
```

  En "el usuario root puede ver y acceder a todos los tenants", el root sale de `ensureRoot` y entra
  por login (guardar `authService` del bundle en el `beforeEach`):

```ts
    authService.ensureRoot({ email: 'root@sistema.com', password: 'password-root-123', name: 'Root' });
    const rootRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'root@sistema.com', password: 'password-root-123' });
    const rootToken = (rootRes.body as unknown as { token: string }).token;
```

  Nuevo `test/root-bootstrap.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';

describe('AuthService.ensureRoot (#3)', () => {
  let auth: AuthService;

  beforeEach(() => {
    const db = new DatabaseSync(':memory:');
    initSystemDb(db);
    auth = new AuthService(db);
  });

  it('crea el root si el email no existe', () => {
    const { user, created } = auth.ensureRoot({ email: 'Root@Erp.com ', password: 'una-clave-larga', name: 'Root' });
    expect(created).toBe(true);
    expect(user).toMatchObject({ email: 'root@erp.com', globalRole: 'root' });
    expect(auth.login({ email: 'root@erp.com', password: 'una-clave-larga' }).user.globalRole).toBe('root');
  });

  it('promueve a root un usuario existente y le pone la contraseña dada', () => {
    auth.register({ email: 'ana@erp.com', password: 'vieja123', name: 'Ana' });
    const { user, created } = auth.ensureRoot({ email: 'ana@erp.com', password: 'nueva-clave-larga', name: 'Ana' });
    expect(created).toBe(false);
    expect(user.globalRole).toBe('root');
    expect(() => auth.login({ email: 'ana@erp.com', password: 'vieja123' })).toThrow();
    expect(auth.login({ email: 'ana@erp.com', password: 'nueva-clave-larga' }).user.globalRole).toBe('root');
  });
});
```

- [ ] **Paso 2: ver que fallan.** `pnpm test -- test/auth-and-tenants.test.ts test/root-bootstrap.test.ts`:
  falla por `globalRole` `root` y por `ensureRoot` inexistente.
- [ ] **Paso 3: implementar.** En `register`, borrar el conteo y dejar
  `const globalRole: UserRole = 'user';` (con el comentario "El root sale de `ensureRoot` (#3)").
  Agregar:

```ts
  /** Root inicial (#3): crea el usuario como root o promueve uno existente con la contraseña dada. */
  ensureRoot(params: { email: string; password: string; name: string }): { user: UserSession; created: boolean } {
    const email = params.email.trim().toLowerCase();
    const name = params.name.trim();
    const passwordHash = hashPassword(params.password);
    const existing = this.systemDb
      .prepare('SELECT id, name FROM users WHERE email = ?')
      .get(email) as { id: string; name: string } | undefined;

    if (existing !== undefined) {
      this.systemDb
        .prepare("UPDATE users SET global_role = 'root', password_hash = ? WHERE id = ?")
        .run(passwordHash, existing.id);
      return { user: { id: existing.id, email, name: existing.name, globalRole: 'root' }, created: false };
    }

    const id = `usr_${randomUUID()}`;
    this.systemDb
      .prepare(
        'INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, email, passwordHash, name, 'root', new Date().toISOString());
    return { user: { id, email, name, globalRole: 'root' }, created: true };
  }
```

  En `dev-seed.ts`, dentro de `if (userRow === undefined)`, el `register` pasa a:

```ts
    // 1. Crear el admin de desarrollo como root (#3: el registro ya no da root)
    const { user } = params.authService.ensureRoot({
      email: DEV_ADMIN_EMAIL,
      password: DEV_ADMIN_PASS,
      name: 'Admin Demo',
    });
    ownerUserId = user.id;
```

- [ ] **Paso 4: el comando.** `scripts/create-root.ts`:

```ts
/**
 * Root inicial del mini-erp (#3). Se corre una vez en el servidor, con el entorno del servicio:
 *   sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
 * Pide email, nombre y contraseña (sin eco, dos veces). Si el email existe, lo promueve a root.
 */
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { dataDir } from '../src/server/db/data-dir.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';

const rootSchema = z.object({
  email: z.string().email('Email inválido'),
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres'),
  password: z.string().min(12, 'La contraseña del root debe tener al menos 12 caracteres'),
});

/** Lee una línea sin mostrarla. */
function askHidden(question: string): Promise<string> {
  const { stdin, stdout } = process;
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('create-root necesita una terminal'));
      return;
    }
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.setEncoding('utf8');
    stdin.resume();
    let value = '';
    const finish = (): void => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      stdout.write('\n');
    };
    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (ch === '\u0003') {
          finish();
          reject(new Error('Cancelado'));
          return;
        }
        value = ch === '\u007f' || ch === '\b' ? value.slice(0, -1) : value + ch;
      }
    };
    stdin.on('data', onData);
  });
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
const email = await rl.question('Email del root: ');
const name = await rl.question('Nombre: ');
rl.close();
const password = await askHidden('Contraseña (mínimo 12 caracteres): ');
const again = await askHidden('Repetila: ');
if (password !== again) {
  console.error('Las contraseñas no coinciden');
  process.exit(1);
}

const parsed = rootSchema.safeParse({ email, name, password });
if (!parsed.success) {
  console.error(parsed.error.errors[0]?.message ?? 'Datos inválidos');
  process.exit(1);
}

const db = openSystemDb(join(dataDir(), 'system.sqlite'));
const { user, created } = new AuthService(db).ensureRoot(parsed.data);
db.close();
console.log(`${created ? 'Root creado' : 'Usuario promovido a root'}: ${user.email}`);
```

- [ ] **Paso 5: verificar.** `pnpm lint; pnpm typecheck; pnpm test`. Probar el comando a mano en
  PowerShell con una base descartable: `$env:DATA_DIR='test-results/root-data'; node scripts/create-root.ts`
  (la contraseña no se ve; con contraseñas distintas sale con error), y borrar `test-results/root-data`.
  `pnpm test:e2e` (toca el alta: el registro ya no da root).
- [ ] **Paso 6: commit.** `feat: el root inicial sale de un comando; el registro crea siempre user`.

---

### Tarea 3: arranque sin seed de desarrollo en producción

**Archivos:**
- Crear: `src/server/bootstrap.ts`, `test/bootstrap.test.ts`
- Modificar: `src/server/server.ts`, `src/server/demo/demo-session-service.ts`,
  `test/demo-session-service.test.ts`

**Interfaces que produce:**

```ts
export type DevInfo = { email: string; rawKey: string };
export function bootstrap(params: {
  env: NodeJS.ProcessEnv;
  bundle: Pick<ReturnType<typeof createApp>, 'systemDb' | 'authService' | 'tenantManager' | 'demoSessions'>;
  sweepIntervalMs?: number | undefined;
}): { devInfo?: DevInfo; sweeper: NodeJS.Timeout };
```

- [ ] **Paso 1: tests que fallan.** `test/bootstrap.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { bootstrap } from '../src/server/bootstrap.ts';
import { DEV_ADMIN_EMAIL, DEV_POS_API_KEY, DEV_TENANT_ID } from '../src/server/db/dev-seed.ts';
import { hashApiKey } from '../src/server/auth/crypto.ts';

function boot(env: NodeJS.ProcessEnv) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const bundle = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) });
  const result = bootstrap({ env, bundle });
  clearInterval(result.sweeper);
  const count = (sql: string, param: string): number =>
    (systemDb.prepare(sql).get(param) as { n: number }).n;
  return {
    result,
    users: count('SELECT COUNT(*) AS n FROM users WHERE email = ?', DEV_ADMIN_EMAIL),
    tenants: count('SELECT COUNT(*) AS n FROM tenants WHERE id = ?', DEV_TENANT_ID),
    keys: count('SELECT COUNT(*) AS n FROM tenant_api_keys WHERE key_hash = ?', hashApiKey(DEV_POS_API_KEY)),
  };
}

describe('bootstrap (#3)', () => {
  it('en producción no siembra el admin, el tenant ni la key de desarrollo', () => {
    const { result, users, tenants, keys } = boot({ NODE_ENV: 'production' });
    expect(result.devInfo).toBeUndefined();
    expect([users, tenants, keys]).toEqual([0, 0, 0]);
  });

  it('fuera de producción siembra los datos de desarrollo', () => {
    const { result, users, tenants, keys } = boot({});
    expect(result.devInfo).toEqual({ email: DEV_ADMIN_EMAIL, rawKey: DEV_POS_API_KEY });
    expect([users, tenants, keys]).toEqual([1, 1, 1]);
  });
});
```

  En `test/demo-session-service.test.ts`, dentro de `describe('startDemoSweeper (#9)')`:

```ts
  it('loguea cuántas demos borró al arrancar', () => {
    const { service } = setup();
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const timer = startDemoSweeper(service, 1000);
    expect(log).toHaveBeenCalledWith('[demos] barrido: 0 demos vencidas borradas');
    clearInterval(timer);
    log.mockRestore();
  });
```

- [ ] **Paso 2: ver que fallan.** `pnpm test -- test/bootstrap.test.ts test/demo-session-service.test.ts`.
- [ ] **Paso 3: implementar.** En `demo-session-service.ts`:

```ts
/** Barre al arrancar y cada `intervalMs`, sin mantener vivo el proceso. Loguea lo que borra (#3). */
export function startDemoSweeper(service: DemoSessionService, intervalMs: number): NodeJS.Timeout {
  const sweep = (always: boolean): void => {
    const removed = service.sweepExpired();
    if (always || removed > 0) {
      console.log(`[demos] barrido: ${String(removed)} demos vencidas borradas`);
    }
  };
  sweep(true);
  const timer = setInterval(() => {
    sweep(false);
  }, intervalMs);
  timer.unref();
  return timer;
}
```

  `src/server/bootstrap.ts`:

```ts
import type { createApp } from './app.ts';
import { ensureDevData } from './db/dev-seed.ts';
import { startDemoSweeper } from './demo/demo-session-service.ts';

export type DevInfo = { email: string; rawKey: string };

type Bundle = Pick<ReturnType<typeof createApp>, 'systemDb' | 'authService' | 'tenantManager' | 'demoSessions'>;

const SWEEP_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Arranque del servidor: barrido de demos (#9) y, solo fuera de producción, los datos de desarrollo
 * (#3: en la web serían un root y una key con valores que están en el repo).
 */
export function bootstrap(params: {
  env: NodeJS.ProcessEnv;
  bundle: Bundle;
  sweepIntervalMs?: number | undefined;
}): { devInfo?: DevInfo; sweeper: NodeJS.Timeout } {
  const { bundle } = params;
  const sweeper = startDemoSweeper(bundle.demoSessions, params.sweepIntervalMs ?? SWEEP_INTERVAL_MS);
  if (params.env['NODE_ENV'] === 'production') {
    return { sweeper };
  }
  const devInfo = ensureDevData({
    systemDb: bundle.systemDb,
    authService: bundle.authService,
    tenantManager: bundle.tenantManager,
  });
  return { devInfo, sweeper };
}
```

  `server.ts`: reemplazar `startDemoSweeper(...)` y `ensureDevData(...)` por
  `const { devInfo } = bootstrap({ env: process.env, bundle });`, y en el banner:

```ts
bundle.app.listen(PORT, () => {
  const base = process.env['PUBLIC_URL']?.trim() ?? '';
  const url = base === '' ? `http://localhost:${String(PORT)}` : base;
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
```

- [ ] **Paso 4: verificar.** `pnpm lint; pnpm typecheck; pnpm test; pnpm build`. Arranque en
  producción con base descartable, en PowerShell:
  `$env:NODE_ENV='production'; $env:DATA_DIR='test-results/prod-data'; $env:PORT='4120'; node src/server/server.ts`
  → banner sin credenciales y `[demos] barrido: 0 …`; cortar y borrar `test-results/prod-data`.
  `pnpm test:e2e` (el e2e usa el seed de desarrollo fuera de producción).
- [ ] **Paso 5: commit.** `feat: en producción el arranque no siembra datos de desarrollo`.

---

### Tarea 4: límite de pedidos por IP

**Archivos:**
- Crear: `src/server/middleware/rate-limit.ts`, `test/rate-limit.test.ts`
- Modificar: `src/server/demo/demo-config.ts`, `src/server/app.ts`, `src/server/routes/auth-routes.ts`,
  `src/server/routes/connector-routes.ts`

**Interfaces que produce:**

```ts
export type RateLimitConfig = { demoPerHour: number; authPer15Min: number };
export function readRateLimitConfig(env: NodeJS.ProcessEnv): RateLimitConfig;
export function createRateLimit(options: { limit: number; windowMs: number; now: () => Date }): RequestHandler;
// createApp: deps.rateLimits?: RateLimitConfig | undefined
// createAuthRoutes(authService, requireAdmin, limit: RequestHandler)
// createConnectorRoutes(requirePosAuth, demoSessions, demoLimit: RequestHandler)
```

- [ ] **Paso 1: tests que fallan.** `test/rate-limit.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { readRateLimitConfig } from '../src/server/middleware/rate-limit.ts';

function makeApp() {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const clock = { now: new Date('2026-09-30T12:00:00.000Z') };
  const { app } = createApp({
    systemDb,
    tenantManager: new TenantManager(systemDb, { inMemory: true }),
    demoConfig: { enabled: true, ttlHours: 24, maxActive: 200 },
    rateLimits: { demoPerHour: 10, authPer15Min: 20 },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { app, advance };
}

const demo = (app: ReturnType<typeof makeApp>['app'], ip = '203.0.113.1') =>
  request(app).post('/connector/demo-sessions').set('X-POS-Contract-Version', '4.4.0').set('X-Forwarded-For', ip);

describe('límite de pedidos (#3)', () => {
  it('lee los límites del entorno, con 10 y 20 por defecto', () => {
    expect(readRateLimitConfig({})).toEqual({ demoPerHour: 10, authPer15Min: 20 });
    expect(readRateLimitConfig({ DEMO_RATE_LIMIT: '3', AUTH_RATE_LIMIT: 'x' })).toEqual({ demoPerHour: 3, authPer15Min: 20 });
  });

  it('la demo 11 de una IP en una hora da 429 con Retry-After; otra IP pasa', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) {
      expect((await demo(app)).status).toBe(201);
    }
    const blocked = await demo(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: 'rate-limited' });
    expect(blocked.headers['retry-after']).toBe('3600');
    expect((await demo(app, '198.51.100.7')).status).toBe(201);
  });

  it('al vencer la ventana vuelve a dejar pasar', async () => {
    const { app, advance } = makeApp();
    for (let i = 0; i < 10; i++) await demo(app);
    advance(30 * 60 * 1000);
    expect((await demo(app)).headers['retry-after']).toBe('1800');
    advance(30 * 60 * 1000);
    expect((await demo(app)).status).toBe(201);
  });

  it('login y registro comparten 20 pedidos cada 15 minutos por IP', async () => {
    const { app } = makeApp();
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email: 'x@y.com', password: 'nada' });
      await request(app).post('/api/auth/register').set('X-Forwarded-For', '203.0.113.9').send({});
    }
    const blocked = await request(app).post('/api/auth/login').set('X-Forwarded-For', '203.0.113.9').send({ email: 'x@y.com', password: 'nada' });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('900');
  });
});
```

- [ ] **Paso 2: ver que fallan.** `pnpm test -- test/rate-limit.test.ts` (no existe el módulo).
- [ ] **Paso 3: implementar.** En `demo-config.ts`, exportar `positiveInt` (`export function positiveInt`).
  `src/server/middleware/rate-limit.ts`:

```ts
import type { RequestHandler } from 'express';
import { positiveInt } from '../demo/demo-config.ts';

/** Límites por IP (#3), leídos del entorno una vez al arrancar. */
export type RateLimitConfig = { demoPerHour: number; authPer15Min: number };

export function readRateLimitConfig(env: NodeJS.ProcessEnv): RateLimitConfig {
  return {
    demoPerHour: positiveInt(env['DEMO_RATE_LIMIT'], 10),
    authPer15Min: positiveInt(env['AUTH_RATE_LIMIT'], 20),
  };
}

type Window = { count: number; resetAt: number };

/**
 * Ventana fija por IP, en memoria: un reinicio la pone en cero. Pasado el límite responde 429 con
 * `Retry-After`. Las entradas vencidas se descartan al pasar, sin timers.
 */
export function createRateLimit(options: { limit: number; windowMs: number; now: () => Date }): RequestHandler {
  const windows = new Map<string, Window>();
  return (req, res, next) => {
    const now = options.now().getTime();
    for (const [key, w] of windows) {
      if (w.resetAt <= now) windows.delete(key);
    }
    const key = req.ip ?? 'desconocida';
    const current = windows.get(key) ?? { count: 0, resetAt: now + options.windowMs };
    current.count += 1;
    windows.set(key, current);
    if (current.count > options.limit) {
      res.setHeader('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
      res.status(429).json({ code: 'rate-limited', error: 'Demasiados pedidos; probá más tarde' });
      return;
    }
    next();
  };
}
```

  `app.ts`: `import { clockDef } from './di/container.ts'` (sumar al import existente) y
  `import { createRateLimit, readRateLimitConfig, type RateLimitConfig } from './middleware/rate-limit.ts';`.
  En `AppDependencies`: `rateLimits?: RateLimitConfig | undefined;`. Después de crear `app`:

```ts
  // Detrás de Caddy en la misma máquina (#3): req.ip es la del cliente y req.protocol, https
  app.set('trust proxy', 'loopback');
```

  Después de resolver los servicios:

```ts
  const now = rootContainer.use(clockDef);
  const limits = deps?.rateLimits ?? readRateLimitConfig(process.env);
  const demoLimit = createRateLimit({ limit: limits.demoPerHour, windowMs: 60 * 60 * 1000, now });
  const authLimit = createRateLimit({ limit: limits.authPer15Min, windowMs: 15 * 60 * 1000, now });
```

  y pasar `authLimit` a `createAuthRoutes(authService, requireAdmin, authLimit)` y `demoLimit` a
  `createConnectorRoutes(requirePos, demoSessions, demoLimit)`.

  `auth-routes.ts`: tercer parámetro `limit: RequestHandler` (importar el tipo de express);
  `router.post('/register', limit, (req, res) => {…})` y `router.post('/login', limit, …)`.

  `connector-routes.ts`: tercer parámetro `demoLimit: RequestHandler`;
  `router.post('/demo-sessions', checkContractVersion, demoLimit, (req, res) => {…})`.

- [ ] **Paso 4: verificar.** `pnpm lint; pnpm typecheck; pnpm test` (toda la suite: ningún test
  existente pasa los límites). `pnpm test:e2e`.
- [ ] **Paso 5: commit.** `feat: límite de pedidos por IP en demos, login y registro`.

---

### Tarea 5: backup nocturno por archivo

**Archivos:**
- Crear: `src/server/backup/backup.ts`, `scripts/backup.ts`, `test/backup.test.ts`

**Interfaces que produce:**

```ts
export function backupAll(params: { dataDir: string; backupDir: string; now: Date; keep: number }): { dir: string; tenants: string[] };
```

- [ ] **Paso 1: test que falla.** `test/backup.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { backupAll } from '../src/server/backup/backup.ts';

let root = '';

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function seed(): { dataDir: string; backupDir: string } {
  root = mkdtempSync(join(tmpdir(), 'mini-erp-backup-'));
  const dataDir = join(root, 'data');
  const systemDb = openSystemDb(join(dataDir, 'system.sqlite'));
  const tenants = new TenantManager(systemDb, { baseDir: join(dataDir, 'tenants') });
  tenants.createTenant({ id: 'kiosco-real', slug: 'kiosco-real', name: 'Kiosco real' });
  tenants.createTenant({ id: 'demo-abc', slug: 'demo-abc', name: 'Demo' });
  const at = new Date().toISOString();
  systemDb
    .prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
    .run('demo-abc', 'kiosco', at, at);
  tenants.closeAll();
  systemDb.close();
  return { dataDir, backupDir: join(root, 'backups') };
}

describe('backupAll (#3)', () => {
  it('copia system y los comercios reales, sin las demos', () => {
    const { dataDir, backupDir } = seed();
    const result = backupAll({ dataDir, backupDir, now: new Date('2026-10-01T03:30:00Z'), keep: 7 });
    expect(result.dir).toBe(join(backupDir, '2026-10-01'));
    expect(result.tenants).toEqual(['kiosco-real']);
    expect(existsSync(join(result.dir, 'system.sqlite'))).toBe(true);
    expect(existsSync(join(result.dir, 'tenants', 'kiosco-real.sqlite'))).toBe(true);
    expect(existsSync(join(result.dir, 'tenants', 'demo-abc.sqlite'))).toBe(false);
    const copy = new DatabaseSync(join(result.dir, 'system.sqlite'), { readOnly: true });
    expect((copy.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number }).n).toBe(2);
    copy.close();
  });

  it('deja solo las últimas `keep` carpetas y reemplaza la del día', () => {
    const { dataDir, backupDir } = seed();
    for (const day of ['2026-09-20', '2026-09-21', '2026-09-22']) {
      mkdirSync(join(backupDir, day), { recursive: true });
    }
    backupAll({ dataDir, backupDir, now: new Date('2026-10-01T03:30:00Z'), keep: 2 });
    backupAll({ dataDir, backupDir, now: new Date('2026-10-01T04:00:00Z'), keep: 2 });
    expect(readdirSync(backupDir).sort()).toEqual(['2026-09-22', '2026-10-01']);
  });
});
```

- [ ] **Paso 2: ver que falla.** `pnpm test -- test/backup.test.ts`.
- [ ] **Paso 3: implementar.** `src/server/backup/backup.ts`:

```ts
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

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
    .prepare('SELECT id FROM tenants WHERE id NOT IN (SELECT tenant_id FROM demo_sessions) ORDER BY id')
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

  const days = readdirSync(params.backupDir).filter((d) => DAY_DIR.test(d)).sort();
  for (const old of days.slice(0, Math.max(0, days.length - params.keep))) {
    rmSync(join(params.backupDir, old), { recursive: true, force: true });
  }
  return { dir, tenants };
}
```

  `scripts/backup.ts`:

```ts
/** Backup nocturno (#3); lo corre `mini-erp-backup.timer` con el entorno del servicio. */
import { backupAll } from '../src/server/backup/backup.ts';
import { dataDir } from '../src/server/db/data-dir.ts';

const configured = process.env['BACKUP_DIR']?.trim() ?? '';
const backupDir = configured === '' ? 'backups' : configured;
const { dir, tenants } = backupAll({ dataDir: dataDir(), backupDir, now: new Date(), keep: 7 });
console.log(`[backup] ${dir}: system y ${String(tenants.length)} comercios`);
```

  Sumar `backups` al `.gitignore`.
- [ ] **Paso 4: verificar.** `pnpm lint; pnpm typecheck; pnpm test`. A mano:
  `$env:BACKUP_DIR='test-results/backups'; node scripts/backup.ts` con la base de desarrollo → copia
  `tienda-demo` y ninguna demo.
- [ ] **Paso 5: commit.** `feat: backup nocturno de las bases reales con VACUUM INTO`.

---

### Tarea 6: carpeta `deploy/` (servidor)

**Archivos (crear):** `deploy/provision.sh`, `deploy/deploy.sh`, `deploy/mini-erp.service`,
`deploy/mini-erp-backup.service`, `deploy/mini-erp-backup.timer`, `deploy/Caddyfile`,
`deploy/env.example`, `deploy/README.md`.

- [ ] **Paso 1: `deploy/env.example`**

```bash
# /etc/mini-erp/env: entorno del servicio (lo crea provision.sh la primera vez). Sin secretos.
NODE_ENV=production
PORT=4100
DATA_DIR=/var/lib/mini-erp
BACKUP_DIR=/var/lib/mini-erp-backups
PUBLIC_URL=https://__SITE_ADDRESS__
DEMO_SESSIONS=on
DEMO_TTL_HOURS=24
DEMO_MAX_ACTIVE=200
DEMO_RATE_LIMIT=10
AUTH_RATE_LIMIT=20
```

- [ ] **Paso 2: `deploy/Caddyfile`**

```
# /etc/caddy/Caddyfile (lo instala provision.sh con el host real). HTTPS automático.
__SITE_ADDRESS__ {
	encode gzip
	reverse_proxy localhost:4100
}
```

- [ ] **Paso 3: unidades de systemd.** `deploy/mini-erp.service`:

```ini
[Unit]
Description=mini-erp (Connector API, admin y alta)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=minierp
Group=minierp
WorkingDirectory=/opt/mini-erp/current
EnvironmentFile=/etc/mini-erp/env
ExecStart=/usr/bin/node src/server/server.ts
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=/var/lib/mini-erp /var/lib/mini-erp-backups

[Install]
WantedBy=multi-user.target
```

  `deploy/mini-erp-backup.service`:

```ini
[Unit]
Description=Backup nocturno del mini-erp

[Service]
Type=oneshot
User=minierp
Group=minierp
WorkingDirectory=/opt/mini-erp/current
EnvironmentFile=/etc/mini-erp/env
ExecStart=/usr/bin/node scripts/backup.ts
```

  `deploy/mini-erp-backup.timer`:

```ini
[Unit]
Description=Backup nocturno del mini-erp (03:30)

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Paso 4: `deploy/provision.sh`**

```bash
#!/usr/bin/env bash
# Prepara una instancia Ubuntu 24.04 de Lightsail para el mini-erp (#3). Idempotente.
# Uso: sudo bash deploy/provision.sh <ip>.sslip.io "<clave pública de deploy>"
set -euo pipefail

SITE="${1:?Falta el host, ej. 203-0-113-10.sslip.io}"
PUBKEY="${2:?Falta la clave pública de deploy}"
HERE="$(cd "$(dirname "$0")" && pwd)"
[ "$(id -u)" -eq 0 ] || { echo "Correr con sudo" >&2; exit 1; }

# Swap de 1 GB: la instancia tiene 512 MB
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

apt-get update
apt-get install -y ca-certificates curl gnupg debian-keyring debian-archive-keyring apt-transport-https

# Node 24 (NodeSource) y pnpm por corepack (la versión del packageManager)
if ! node -v 2>/dev/null | grep -q '^v24\.'; then
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
corepack enable

# Caddy (repo oficial)
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update
  apt-get install -y caddy
fi

# Usuarios: minierp corre el servicio; deploy recibe las versiones desde GitHub Actions
id minierp >/dev/null 2>&1 || useradd --system --home-dir /var/lib/mini-erp --shell /usr/sbin/nologin minierp
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
printf '%s\n' "$PUBKEY" > /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
chmod 600 /home/deploy/.ssh/authorized_keys

# deploy solo puede reiniciar el servicio
echo 'deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart mini-erp' > /etc/sudoers.d/mini-erp-deploy
chmod 440 /etc/sudoers.d/mini-erp-deploy
visudo -cf /etc/sudoers.d/mini-erp-deploy

# Carpetas
install -d -o deploy -g deploy /opt/mini-erp /opt/mini-erp/releases
install -d -m 750 -o minierp -g minierp /var/lib/mini-erp /var/lib/mini-erp-backups
install -d -m 755 /etc/mini-erp
if [ ! -f /etc/mini-erp/env ]; then
  sed "s/__SITE_ADDRESS__/$SITE/" "$HERE/env.example" > /etc/mini-erp/env
fi
chown root:minierp /etc/mini-erp/env
chmod 640 /etc/mini-erp/env

# systemd: el servicio arranca con el primer deploy (todavía no hay /opt/mini-erp/current)
install -m 644 "$HERE/mini-erp.service" "$HERE/mini-erp-backup.service" "$HERE/mini-erp-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable mini-erp
systemctl enable --now mini-erp-backup.timer

# Caddy con el host real
sed "s/__SITE_ADDRESS__/$SITE/" "$HERE/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "Listo. Falta el primer deploy desde GitHub Actions y crear el root (deploy/README.md)."
```

- [ ] **Paso 5: `deploy/deploy.sh`**

```bash
#!/usr/bin/env bash
# Activa una versión ya descomprimida en /opt/mini-erp/releases/<sha> (#3). Lo llama deploy.yml por
# SSH como el usuario deploy. Si /health no responde, vuelve a la versión anterior.
set -euo pipefail

SHA="${1:?Falta el sha}"
BASE=/opt/mini-erp
RELEASE="$BASE/releases/$SHA"
PREVIOUS="$(readlink -f "$BASE/current" 2>/dev/null || true)"

activate() {
  ln -sfn "$1" "$BASE/current.new"
  mv -Tf "$BASE/current.new" "$BASE/current"
  sudo systemctl restart mini-erp
}

healthy() {
  for _ in $(seq 1 30); do
    if curl -fsS http://localhost:4100/health >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  return 1
}

cd "$RELEASE"
COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --prod --frozen-lockfile
activate "$RELEASE"

if ! healthy; then
  echo "La versión $SHA no respondió /health" >&2
  if [ -n "$PREVIOUS" ] && [ -d "$PREVIOUS" ] && [ "$PREVIOUS" != "$RELEASE" ]; then
    activate "$PREVIOUS"
    echo "Volví a $(basename "$PREVIOUS")" >&2
  fi
  exit 1
fi

rm -f "$BASE/releases/$SHA.tar.gz"
# Deja las últimas 5 versiones (la activa es la más nueva)
ls -1dt "$BASE"/releases/*/ | tail -n +6 | xargs -r rm -rf
echo "Versión $SHA activa"
```

- [ ] **Paso 6: `deploy/README.md`** con, en este orden:
  1. **Lightsail** (consola): instancia Ubuntu 24.04, plan de US$5; IP estática asignada; en
     Networking abrir 80 y 443; en Snapshots activar los automáticos.
  2. **Llave de deploy** (en tu máquina): `ssh-keygen -t ed25519 -f mini-erp-deploy -N "" -C deploy@mini-erp`.
  3. **Aprovisionar** (SSH como `ubuntu`):
     `git clone -b <rama o main> https://github.com/rauldiazsolis/mini-erp.git /tmp/mini-erp`
     y `sudo bash /tmp/mini-erp/deploy/provision.sh <ip-con-guiones>.sslip.io "$(cat mini-erp-deploy.pub)"`
     (pegando el contenido de la `.pub`).
  4. **GitHub** → Settings → Environments → `production`: secretos `SSH_HOST` (la IP),
     `SSH_USER` (`deploy`), `SSH_PRIVATE_KEY` (contenido de `mini-erp-deploy`), `SSH_KNOWN_HOSTS`
     (salida de `ssh-keyscan -t ed25519 <ip>`); variable `PUBLIC_HOST` (`<ip-con-guiones>.sslip.io`).
  5. **Deploy**: push de un tag `v*` (o "Run workflow" en Actions, desde `main`).
  6. **Root inicial** (una vez, como `ubuntu`):
     `sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'`.
  7. **Operación**: `journalctl -u mini-erp -f`; `systemctl list-timers mini-erp-backup.timer`;
     cambiar `/etc/mini-erp/env` y `sudo systemctl restart mini-erp`.
  8. **Restaurar un backup**: `sudo systemctl stop mini-erp`; copiar
     `/var/lib/mini-erp-backups/<día>/system.sqlite` y/o `tenants/<id>.sqlite` sobre
     `/var/lib/mini-erp/`; `sudo chown -R minierp:minierp /var/lib/mini-erp`; `sudo systemctl start mini-erp`.
     Si se perdió la instancia: crear una nueva desde el snapshot de Lightsail y reasignarle la IP estática.
- [ ] **Paso 7: verificar.** Desde Bash: `bash -n deploy/provision.sh && bash -n deploy/deploy.sh`, y
  `shellcheck deploy/*.sh` si está instalado. Confirmar con `git ls-files --eol deploy/` que los `.sh`
  quedan con LF. `pnpm lint; pnpm typecheck; pnpm test` (sin cambios de código).
- [ ] **Paso 8: commit.** `build: aprovisionamiento de Lightsail con systemd, Caddy y backups`.

---

### Tarea 7: workflows de CI y deploy

**Archivos:** Modificar `.github/workflows/ci.yml`; crear `.github/workflows/deploy.yml`.

- [ ] **Paso 1: CI reusable.** En `ci.yml`, sumar `workflow_call:` a `on:`.
- [ ] **Paso 2: `deploy.yml`**

```yaml
name: Deploy

# #3: por tag v* o a mano. Corre el CI entero y después despliega en Lightsail por SSH.
on:
  push:
    tags: ['v*']
  workflow_dispatch:

concurrency:
  group: deploy
  cancel-in-progress: false

jobs:
  ci:
    uses: ./.github/workflows/ci.yml

  deploy:
    needs: ci
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v7

      - uses: pnpm/action-setup@v5

      - uses: actions/setup-node@v7
        with:
          node-version: '24'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile

      - run: pnpm build

      - name: Armar la versión
        run: tar -czf release.tar.gz dist src scripts deploy package.json pnpm-lock.yaml contract.json

      - name: Llave SSH
        env:
          SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
          SSH_KNOWN_HOSTS: ${{ secrets.SSH_KNOWN_HOSTS }}
        run: |
          install -m 700 -d ~/.ssh
          printf '%s\n' "$SSH_PRIVATE_KEY" > ~/.ssh/id_deploy
          chmod 600 ~/.ssh/id_deploy
          printf '%s\n' "$SSH_KNOWN_HOSTS" > ~/.ssh/known_hosts

      - name: Subir y activar
        env:
          SSH_HOST: ${{ secrets.SSH_HOST }}
          SSH_USER: ${{ secrets.SSH_USER }}
        run: |
          scp -i ~/.ssh/id_deploy release.tar.gz "$SSH_USER@$SSH_HOST:/opt/mini-erp/releases/$GITHUB_SHA.tar.gz"
          ssh -i ~/.ssh/id_deploy "$SSH_USER@$SSH_HOST" \
            "set -e; R=/opt/mini-erp/releases/$GITHUB_SHA; rm -rf \$R; mkdir -p \$R; tar -xzf \$R.tar.gz -C \$R; bash \$R/deploy/deploy.sh $GITHUB_SHA"

      - name: Chequeo público
        run: curl -fsS --retry 5 --retry-delay 3 "https://${{ vars.PUBLIC_HOST }}/health"
```

- [ ] **Paso 3: verificar.** Revisar el YAML (indentación, nombres de secretos iguales a
  `deploy/README.md`). `pnpm lint; pnpm typecheck; pnpm test`.
- [ ] **Paso 4: commit.** `ci: deploy a Lightsail por tag o manual, reusando el CI`.

---

### Tarea 8: documentación

**Archivos:** Modificar `README.md`, `AGENTS.md`, `PLAN.md`.

- [ ] **Paso 1: README.** Sección "Producción" (enlace a `deploy/README.md`, URL pública, root por
  comando); "Al arrancar crea datos de desarrollo" pasa a "Fuera de producción…"; tabla de variables
  con `DEMO_RATE_LIMIT`, `AUTH_RATE_LIMIT`, `BACKUP_DIR`, `NODE_ENV`, `DATA_DIR`.
- [ ] **Paso 2: AGENTS.md.** Auth: el registro crea `user`; el root sale de `scripts/create-root.ts`.
  Arquitectura: `trust proxy`, límite por IP (`middleware/rate-limit.ts`), `bootstrap.ts`, backups.
  Sección de deploy (Lightsail, Caddy + `sslip.io`, `deploy/`, `deploy.yml` por tag). Estado: #3
  hecho; sigue #2.
- [ ] **Paso 3: PLAN.md.** Fase 10: deploy público.
- [ ] **Paso 4: verificar y commit.** `pnpm lint; pnpm typecheck; pnpm test`.
  `docs: producción, deploy y root por comando en README, AGENTS.md y PLAN.md`.

---

### Tarea 9: aprovisionar y primer deploy (con el usuario)

Nada de código. El usuario hace los pasos de consola y de secretos; el agente guía y verifica desde
afuera.

- [ ] **Paso 1:** push de la rama. El usuario sigue `deploy/README.md` pasos 1 a 4 (clonando la rama).
- [ ] **Paso 2:** el agente crea y pushea el tag `v0.1.0-rc.1` en la rama (el workflow corre desde el
  commit del tag, sin estar en `main`). Si falla, se lee el log con `gh run view --log-failed`.
- [ ] **Paso 3:** el usuario corre `create-root` (paso 6 del README).
- [ ] **Paso 4: chequeos del agente** (Bash, `H=https://<host>`):
  - `curl -fsS $H/health` → `{"status":"ok",…}`.
  - `curl -fsS $H/connector/info` → `capabilities: ["demo-sessions"]`.
  - login con `admin@local.test`/`admin123` → 401.
  - registro de un usuario de prueba → `globalRole: "user"` (anotar el email para borrarlo después
    si hace falta).
  - 11 `POST $H/connector/demo-sessions` con `X-POS-Contract-Version: 4.4.0` → el 11.º da 429 con
    `Retry-After`. (Deja 10 demos que vencen solas en 24 h.)
  - El usuario confirma por SSH: `journalctl -u mini-erp | grep demos` y
    `systemctl list-timers mini-erp-backup.timer`.

---

### Tarea 10: prueba real, informe y PR

- [ ] **Paso 1: recorrido con el navegador integrado** (no la extensión de Chrome), con capturas:
  `https://<host>/` → "Probar la demo" (abre `https://offline-pos.pages.dev/0.1.0/?demo=true&backend=https://<host>/connector`)
  → marca DEMO → vender un producto y `/SINCRONIZAR` → `/ALTA` → alta en `https://<host>/alta` →
  "Volver al POS" → POS sin DEMO, conectado al comercio nuevo, sin la venta de la demo. El usuario
  ingresa los datos del alta si el agente no debe (email y contraseña de prueba generados).
- [ ] **Paso 2:** informe final con la prueba manual paso a paso y las capturas (SendUserFile).
- [ ] **Paso 3:** tras la revisión del usuario, PR con "Closes #3" (merge commit). Después del
  merge: tag `v0.1.0` en `main` (redeploy), verificar que #3 se cerró (si no, cerrarlo con
  referencia al PR) y tildar el ítem en rauldiazsolis/offline-pos#166.
