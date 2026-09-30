# Demo y alta con el POS publicado 0.1.0: plan de implementación

> **Para agentes:** se ejecuta inline con `superpowers:executing-plans`, tarea por tarea, frenando al
> final de cada una para que el usuario la revise (AGENTS.md: nunca un subagente por tarea). Los
> pasos usan checkboxes (`- [ ]`).

**Objetivo:** el POS publicado 0.1.0 se usa de punta a punta contra el mini-erp: landing → demo
aislada → `/ALTA` → alta en el mini-erp → el POS vuelve configurado con `#connect`.

**Arquitectura:** del lado del servidor, un `DemoSessionService` de sistema (contenedor raíz) crea
tenants sin dueño marcados en `demo_sessions`, los mantiene vivos con `touch` desde el middleware de
key y los barre al vencer. `POST /connector/demo-sessions` va antes de la auth del Connector API. Del
lado del cliente, un signal de ruta (`/`, `/admin`, `/alta`) reparte un solo SPA entre landing, admin
y alta; el alta devuelve la conexión en el fragmento con una función pura.

**Stack:** Node 24 (strip de tipos), Express 4, `node:sqlite`, Hardwired 1.6.2, Zod 3, Preact +
signals, Tailwind v4, Vitest + supertest.

**Spec:** `docs/superpowers/specs/2026-09-30-demo-y-alta-pos-publicado-design.md`

## Restricciones globales

- Todo en español: código nuevo, comentarios, commits.
- TDD: el test primero, verlo fallar, lo mínimo para que pase.
- Cada tarea cierra con `pnpm lint && pnpm typecheck && pnpm test` en verde, más `pnpm build` si toca
  el cliente. **pnpm se corre desde PowerShell.**
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores, `unknown` solo en fronteras y
  validado con Zod. Opcionales como `x?: T | undefined` en entradas; en resultados, la propiedad se
  omite.
- Sin parameter properties ni `enum`; imports relativos con extensión `.ts`/`.tsx`.
- Cliente: solo signals, nada de `preact/hooks`.
- Commits convencionales en español, con heredoc (`git commit -F - <<'EOF'`), terminando en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rama: `claude/pos-demo-end-to-end-447803`.
- Valores fijos del contrato: `branch: 'CENTRAL'`, `pointOfSale: 'Caja 1'`,
  `label: 'Crear mi comercio'`, `code: 'unknown-template'`, `code: 'demo-capacity'`.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `src/server/middleware/private-network.ts` (nuevo) | Header de red privada en el preflight |
| `src/server/db/system-db.ts` | Tabla `demo_sessions`, esquema v3 |
| `src/server/seeds/index.ts` | `DEMO_TEMPLATES`, `isDemoTemplate`, `seedDemoSession`, `insertDemoCustomers` |
| `src/server/db/tenant-manager.ts` | `ownerUserId` opcional, `deleteTenant` |
| `src/server/auth/auth-service.ts` | `listUserTenants` sin demos |
| `src/server/demo/demo-config.ts` (nuevo) | Config de demos desde el entorno |
| `src/server/demo/demo-session-service.ts` (nuevo) | Crear, tocar, barrer y contar demos; `startDemoSweeper` |
| `src/server/di/container.ts` | `demoConfigDef`, `clockDef`, `demoSessionServiceDef` |
| `src/server/middleware/auth-middleware.ts` | Callback `onAuthenticated` en la auth del POS |
| `src/server/routes/connector-routes.ts` | `POST /demo-sessions`, `capabilities` en `/info` |
| `src/server/app.ts`, `src/server/server.ts` | Cableado y barrido periódico |
| `src/client/state/route-state.ts` (nuevo) | Ruta del SPA por path |
| `src/client/state/demo-link.ts` (nuevo) | `POS_VERSION` y `buildDemoUrl` |
| `src/client/components/landing/LandingView.tsx` (nuevo) | El landing |
| `src/client/state/connect-return.ts` (nuevo) | `buildConnectReturnUrl` |
| `src/client/state/merchant-onboarding-state.ts` | Parámetros de `/alta` y vuelta con `#connect` |
| `src/client/components/onboarding/MerchantOnboardingView.tsx` | Pantalla final nueva |
| `src/client/App.tsx`, `src/client/components/auth/AuthView.tsx` | Ruteo |
| `tsconfig.json` | `resolveJsonModule` para leer `contract.json` |
| `README.md`, `AGENTS.md`, `PLAN.md` | Documentación |

---

### Tarea 1: preflight de red privada

**Archivos:**
- Crear: `src/server/middleware/private-network.ts`
- Modificar: `src/server/app.ts` (antes de `app.use(cors())`)
- Test: `test/cors-private-network.test.ts`

**Interfaces:**
- Produce: `allowPrivateNetwork(req, res, next): void`.

- [ ] **Paso 1: el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';

function makeApp() {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  return createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) }).app;
}

function preflight(app: ReturnType<typeof makeApp>) {
  return request(app)
    .options('/connector/sync/pull')
    .set('Origin', 'https://offline-pos.pages.dev')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'authorization,content-type,x-pos-contract-version');
}

describe('CORS y red privada (#9)', () => {
  it('acepta el origen del POS publicado', async () => {
    const res = await preflight(makeApp());
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });

  it('contesta el preflight de red privada de Chrome', async () => {
    const res = await preflight(makeApp()).set('Access-Control-Request-Private-Network', 'true');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-private-network']).toBe('true');
  });

  it('no agrega el header si no lo piden', async () => {
    const res = await preflight(makeApp());
    expect(res.headers['access-control-allow-private-network']).toBeUndefined();
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

`pnpm vitest run test/cors-private-network.test.ts`: falla solo "contesta el preflight de red
privada".

- [ ] **Paso 3: implementar**

`src/server/middleware/private-network.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';

/**
 * Preflight de red privada de Chrome: una página pública (el POS en pages.dev) que llama a
 * `localhost` lo manda con `Access-Control-Request-Private-Network: true`. Va antes de `cors()`,
 * que es el que termina el preflight.
 */
export function allowPrivateNetwork(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'OPTIONS' && req.headers['access-control-request-private-network'] === 'true') {
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
  }
  next();
}
```

En `src/server/app.ts`, importarlo y reemplazar `app.use(cors());` por:

```ts
  app.use(allowPrivateNetwork);
  app.use(cors());
```

- [ ] **Paso 4: la suite completa**

`pnpm lint && pnpm typecheck && pnpm test`: todo en verde.

- [ ] **Paso 5: commit**

```bash
git add src/server/middleware/private-network.ts src/server/app.ts test/cors-private-network.test.ts
git commit -F - <<'EOF'
feat: contestar el preflight de red privada de Chrome

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 2: tenants de demo (esquema, seeds, alta sin dueño y borrado)

**Archivos:**
- Modificar: `src/server/db/system-db.ts`, `src/server/seeds/index.ts`,
  `src/server/db/tenant-manager.ts`, `src/server/auth/auth-service.ts`
- Test: `test/demo-tenants.test.ts`

**Interfaces:**
- Produce:
  - `DEMO_TEMPLATES: readonly ['kiosco', 'almacen', 'ferreteria']`, `type DemoTemplate`,
    `DEFAULT_DEMO_TEMPLATE: DemoTemplate` (`'kiosco'`), `isDemoTemplate(value: string): value is
    DemoTemplate`.
  - `seedDemoSession(db: DatabaseSync, template: DemoTemplate): void`.
  - `CreateTenantParams.ownerUserId?: string | undefined`.
  - `TenantManager.deleteTenant(id: string): void`.
  - Tabla `demo_sessions (tenant_id, template, created_at, last_used_at)`.

- [ ] **Paso 1: los tests que fallan**

```ts
import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import {
  DEMO_CUSTOMERS,
  DEMO_TEMPLATES,
  isDemoTemplate,
  seedDemoSession,
} from '../src/server/seeds/index.ts';

function systemDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  initSystemDb(db);
  return db;
}

function count(db: DatabaseSync, sql: string, ...params: string[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

describe('Templates de demo', () => {
  it('son los presets', () => {
    expect([...DEMO_TEMPLATES]).toEqual(['kiosco', 'almacen', 'ferreteria']);
    expect(isDemoTemplate('almacen')).toBe(true);
    expect(isDemoTemplate('panaderia')).toBe(false);
  });

  it('seedDemoSession siembra el catálogo del preset y los clientes demo, sin historial', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    manager.createTenant({ id: 'demo-a', slug: 'demo-a', name: 'Demo Almacen' });
    const db = manager.getTenantDb('demo-a');
    seedDemoSession(db, 'almacen');
    expect(count(db, 'SELECT COUNT(*) AS n FROM products WHERE sku = ?', 'ALM-001')).toBe(1);
    expect(count(db, 'SELECT COUNT(*) AS n FROM products WHERE sku LIKE ?', 'KIO-%')).toBe(0);
    expect(count(db, 'SELECT COUNT(*) AS n FROM customers')).toBe(DEMO_CUSTOMERS.length);
    expect(count(db, 'SELECT COUNT(*) AS n FROM sales')).toBe(0);
  });
});

describe('TenantManager y demos', () => {
  it('crea un tenant sin dueño', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    manager.createTenant({ id: 'demo-b', slug: 'demo-b', name: 'Demo' });
    expect(manager.tenantExists('demo-b')).toBe(true);
    expect(count(sys, 'SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?', 'demo-b')).toBe(0);
  });

  it('deleteTenant borra el tenant, sus keys, membresías y su fila de demo', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    const auth = new AuthService(sys);
    const { user } = auth.register({ email: 'a@b.com', password: 'secreta1', name: 'A' });
    manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: user.id });
    const keys = new ApiKeyService(sys);
    const { rawKey } = keys.createApiKey({ tenantId: 'tienda', name: 'Caja', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    sys
      .prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .run('tienda', 'kiosco', new Date().toISOString(), new Date().toISOString());

    manager.deleteTenant('tienda');

    expect(manager.tenantExists('tienda')).toBe(false);
    expect(keys.validateApiKey(rawKey)).toBeUndefined();
    expect(count(sys, 'SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ?', 'tienda')).toBe(0);
    expect(count(sys, 'SELECT COUNT(*) AS n FROM demo_sessions WHERE tenant_id = ?', 'tienda')).toBe(0);
  });

  it('deleteTenant borra el archivo de la base', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mini-erp-demo-'));
    try {
      const manager = new TenantManager(systemDb(), { baseDir: dir });
      manager.createTenant({ id: 'demo-c', slug: 'demo-c', name: 'Demo' });
      const file = join(dir, 'demo-c.sqlite');
      expect(existsSync(file)).toBe(true);
      manager.deleteTenant('demo-c');
      expect(existsSync(file)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('las demos no aparecen en la lista de comercios, ni para root', () => {
    const sys = systemDb();
    const manager = new TenantManager(sys, { inMemory: true });
    const auth = new AuthService(sys);
    const { user } = auth.register({ email: 'root@b.com', password: 'secreta1', name: 'Root' });
    manager.createTenant({ id: 'tienda', slug: 'tienda', name: 'Tienda', ownerUserId: user.id });
    manager.createTenant({ id: 'demo-d', slug: 'demo-d', name: 'Demo' });
    sys
      .prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .run('demo-d', 'kiosco', new Date().toISOString(), new Date().toISOString());

    const ids = auth.listUserTenants(user.id, 'root').map((t) => t.tenantId);
    expect(ids).toEqual(['tienda']);
  });
});
```

Antes de correrlo, confirmar en `src/server/auth/auth-service.ts` que `register` devuelve `{ user }`
con `user.id`. Si la forma es otra, ajustar el test, no el servicio.

- [ ] **Paso 2: correrlo y ver que falla**

`pnpm vitest run test/demo-tenants.test.ts`: fallan los imports (`DEMO_TEMPLATES`,
`seedDemoSession`), `ownerUserId` requerido y `deleteTenant` inexistente.

- [ ] **Paso 3: implementar**

`src/server/db/system-db.ts`: `SYSTEM_SCHEMA_VERSION = 3` y, al final de `SYSTEM_SCHEMA`:

```sql
CREATE TABLE IF NOT EXISTS demo_sessions (
  tenant_id TEXT PRIMARY KEY,
  template TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
```

`src/server/seeds/index.ts`: sacar el bloque "2. Clientes iniciales" de `seedDemoTenant` a una función
y reemplazarlo por `insertDemoCustomers(db, now);`. Sumar:

```ts
/** Templates de `POST /demo-sessions` (#9): son los presets del mini-erp. */
export const DEMO_TEMPLATES = ['kiosco', 'almacen', 'ferreteria'] as const satisfies readonly BusinessPreset[];
export type DemoTemplate = (typeof DEMO_TEMPLATES)[number];
export const DEFAULT_DEMO_TEMPLATE: DemoTemplate = 'kiosco';

export function isDemoTemplate(value: string): value is DemoTemplate {
  return (DEMO_TEMPLATES as readonly string[]).includes(value);
}

function insertDemoCustomers(db: DatabaseSync, now: string): void {
  // (el bloque movido tal cual desde seedDemoTenant: insertCust + movimientos de saldo inicial)
}

/** Datos de una demo: el catálogo del preset y los clientes demo, sin historial (el POS no lo ve). */
export function seedDemoSession(db: DatabaseSync, template: DemoTemplate): void {
  applyPreset(db, template);
  insertDemoCustomers(db, new Date().toISOString());
}
```

(`insertDemoCustomers` lleva **el código existente**, movido sin cambios; no queda un comentario en
su lugar.)

`src/server/db/tenant-manager.ts`:
- `ownerUserId?: string | undefined` en `CreateTenantParams`, y el `INSERT INTO memberships` solo
  `if (params.ownerUserId !== undefined)`.
- Importar `rmSync` de `node:fs` y sumar:

```ts
  /**
   * Borra un tenant entero: cierra su base, borra sus filas de sistema y su archivo. Lo usa el
   * barrido de demos vencidas (#9). No depende de `PRAGMA foreign_keys`.
   */
  deleteTenant(id: string): void {
    const db = this.cache.get(id);
    if (db !== undefined) {
      try {
        db.close();
      } catch {
        // Ignorar si ya estaba cerrada
      }
      this.cache.delete(id);
    }

    this.systemDb.exec('BEGIN');
    try {
      this.systemDb.prepare('DELETE FROM tenant_api_keys WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM memberships WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM demo_sessions WHERE tenant_id = ?').run(id);
      this.systemDb.prepare('DELETE FROM tenants WHERE id = ?').run(id);
      this.systemDb.exec('COMMIT');
    } catch (err: unknown) {
      this.systemDb.exec('ROLLBACK');
      throw err;
    }

    if (!this.inMemory) {
      const file = join(this.baseDir, `${id}.sqlite`);
      for (const path of [file, `${file}-wal`, `${file}-shm`]) {
        rmSync(path, { force: true });
      }
    }
  }
```

`src/server/auth/auth-service.ts`, en la consulta de `root`/`support` de `listUserTenants`:

```sql
SELECT id, slug, name, status FROM tenants
WHERE id NOT IN (SELECT tenant_id FROM demo_sessions)
ORDER BY created_at DESC
```

- [ ] **Paso 4: la suite completa**

`pnpm lint && pnpm typecheck && pnpm test`: todo en verde. El test de import/seeds existente sigue
pasando: `seedDemoTenant` siembra lo mismo.

- [ ] **Paso 5: commit**

```bash
git add src/server/db/system-db.ts src/server/seeds/index.ts src/server/db/tenant-manager.ts src/server/auth/auth-service.ts test/demo-tenants.test.ts
git commit -F - <<'EOF'
feat: tenants de demo sin dueño, con templates y borrado completo

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 3: `DemoSessionService`, config y barrido

**Archivos:**
- Crear: `src/server/demo/demo-config.ts`, `src/server/demo/demo-session-service.ts`
- Modificar: `src/server/di/container.ts`
- Test: `test/demo-session-service.test.ts`

**Interfaces:**
- Consume: `TenantManager.createTenant`/`deleteTenant`/`getTenantDb`,
  `ApiKeyService.createApiKey`, `seedDemoSession`, `DemoTemplate` (tarea 2).
- Produce:
  - `type DemoConfig = { enabled: boolean; ttlHours: number; maxActive: number; publicUrl?: string }`.
  - `readDemoConfig(env: NodeJS.ProcessEnv): DemoConfig`.
  - `DEMO_BRANCH = 'CENTRAL'`, `DEMO_POINT_OF_SALE = 'Caja 1'`.
  - `type DemoSession = { tenantId: string; apiKey: string; branch: string; pointOfSale: string;
    template: DemoTemplate }`.
  - `class DemoSessionService` con `enabled(): boolean`, `publicUrl(): string | undefined`,
    `create(template: DemoTemplate): DemoSession`, `touch(tenantId: string): void`,
    `sweepExpired(): number`, `countActive(): number` e `isFull(): boolean`.
  - `startDemoSweeper(service: DemoSessionService, intervalMs: number): NodeJS.Timeout`.
  - En el contenedor: `demoConfigDef`, `clockDef`, `demoSessionServiceDef`; y
    `ContainerDependencies.demoConfig?` y `now?`.

- [ ] **Paso 1: los tests que fallan**

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { readDemoConfig, type DemoConfig } from '../src/server/demo/demo-config.ts';
import { DemoSessionService, startDemoSweeper } from '../src/server/demo/demo-session-service.ts';

const HOUR = 60 * 60 * 1000;

function setup(overrides: Partial<DemoConfig> = {}) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const tenantManager = new TenantManager(systemDb, { inMemory: true });
  const apiKeyService = new ApiKeyService(systemDb);
  const clock = { now: new Date('2026-09-30T12:00:00.000Z') };
  const service = new DemoSessionService({
    systemDb,
    tenantManager,
    apiKeyService,
    config: { enabled: true, ttlHours: 24, maxActive: 200, ...overrides },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { service, tenantManager, apiKeyService, advance };
}

describe('readDemoConfig', () => {
  it('usa los valores por defecto', () => {
    expect(readDemoConfig({})).toEqual({ enabled: true, ttlHours: 24, maxActive: 200 });
  });

  it('lee el entorno', () => {
    expect(
      readDemoConfig({
        DEMO_SESSIONS: 'off',
        DEMO_TTL_HOURS: '2',
        DEMO_MAX_ACTIVE: '5',
        PUBLIC_URL: 'https://erp.example.com/',
      }),
    ).toEqual({ enabled: false, ttlHours: 2, maxActive: 5, publicUrl: 'https://erp.example.com' });
  });

  it('ignora números inválidos', () => {
    expect(readDemoConfig({ DEMO_TTL_HOURS: 'x', DEMO_MAX_ACTIVE: '-3' })).toMatchObject({ ttlHours: 24, maxActive: 200 });
  });
});

describe('DemoSessionService', () => {
  it('crea una demo aislada con su key, sembrada con el template', () => {
    const { service, tenantManager, apiKeyService } = setup();
    const session = service.create('almacen');

    expect(session).toMatchObject({ branch: 'CENTRAL', pointOfSale: 'Caja 1', template: 'almacen' });
    expect(session.tenantId).toMatch(/^demo-/);
    expect(apiKeyService.validateApiKey(session.apiKey)).toEqual({
      tenantId: session.tenantId,
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
    });
    const row = tenantManager
      .getTenantDb(session.tenantId)
      .prepare('SELECT COUNT(*) AS n FROM products WHERE sku = ?')
      .get('ALM-001') as { n: number };
    expect(row.n).toBe(1);
    expect(service.countActive()).toBe(1);
  });

  it('dos demos son dos tenants distintos', () => {
    const { service } = setup();
    expect(service.create('kiosco').tenantId).not.toBe(service.create('kiosco').tenantId);
  });

  it('barre solo las demos sin uso por más del vencimiento', () => {
    const { service, tenantManager, advance } = setup();
    const vieja = service.create('kiosco');
    const usada = service.create('kiosco');
    advance(23 * HOUR);
    service.touch(usada.tenantId);
    advance(2 * HOUR);

    expect(service.sweepExpired()).toBe(1);
    expect(tenantManager.tenantExists(vieja.tenantId)).toBe(false);
    expect(tenantManager.tenantExists(usada.tenantId)).toBe(true);
    expect(service.countActive()).toBe(1);
  });

  it('touch sobre un tenant que no es demo no hace nada', () => {
    const { service } = setup();
    service.touch('tienda-real');
    expect(service.countActive()).toBe(0);
  });

  it('avisa cuando llega al tope', () => {
    const { service } = setup({ maxActive: 2 });
    service.create('kiosco');
    expect(service.isFull()).toBe(false);
    service.create('kiosco');
    expect(service.isFull()).toBe(true);
  });
});

describe('startDemoSweeper', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('barre al arrancar y en cada intervalo', () => {
    vi.useFakeTimers();
    const { service } = setup();
    const sweep = vi.spyOn(service, 'sweepExpired');
    const timer = startDemoSweeper(service, 1000);
    expect(sweep).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    expect(sweep).toHaveBeenCalledTimes(3);
    clearInterval(timer);
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

`pnpm vitest run test/demo-session-service.test.ts`: fallan los imports.

- [ ] **Paso 3: implementar**

`src/server/demo/demo-config.ts`:

```ts
/** Config de las demos (#9), leída del entorno una vez al arrancar. */
export type DemoConfig = {
  enabled: boolean;
  ttlHours: number;
  maxActive: number;
  /** URL pública del mini-erp, sin barra final. Ausente = el origen del request. */
  publicUrl?: string;
};

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function readDemoConfig(env: NodeJS.ProcessEnv): DemoConfig {
  const publicUrl = env['PUBLIC_URL']?.trim().replace(/\/+$/, '') ?? '';
  return {
    enabled: env['DEMO_SESSIONS'] !== 'off',
    ttlHours: positiveInt(env['DEMO_TTL_HOURS'], 24),
    maxActive: positiveInt(env['DEMO_MAX_ACTIVE'], 200),
    ...(publicUrl === '' ? {} : { publicUrl }),
  };
}
```

`src/server/demo/demo-session-service.ts`:

```ts
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import { seedDemoSession, type DemoTemplate } from '../seeds/index.ts';
import type { DemoConfig } from './demo-config.ts';

export const DEMO_BRANCH = 'CENTRAL';
export const DEMO_POINT_OF_SALE = 'Caja 1';

const HOUR_MS = 60 * 60 * 1000;

export type DemoSession = {
  tenantId: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  template: DemoTemplate;
};

export type DemoSessionDeps = {
  systemDb: DatabaseSync;
  tenantManager: TenantManager;
  apiKeyService: ApiKeyService;
  config: DemoConfig;
  now: () => Date;
};

/**
 * Demos aisladas (#9): un tenant sin dueño por cada `POST /demo-sessions`, marcado en
 * `demo_sessions`. Vence a las `ttlHours` del último uso y lo borra `sweepExpired`.
 */
export class DemoSessionService {
  private deps: DemoSessionDeps;

  constructor(deps: DemoSessionDeps) {
    this.deps = deps;
  }

  enabled(): boolean {
    return this.deps.config.enabled;
  }

  publicUrl(): string | undefined {
    return this.deps.config.publicUrl;
  }

  create(template: DemoTemplate): DemoSession {
    const { systemDb, tenantManager, apiKeyService } = this.deps;
    const id = `demo-${randomUUID().slice(0, 8)}`;
    const title = `${template.charAt(0).toUpperCase()}${template.slice(1)}`;
    const tenant = tenantManager.createTenant({ id, slug: id, name: `Demo ${title}` });
    seedDemoSession(tenantManager.getTenantDb(tenant.id), template);
    const { rawKey } = apiKeyService.createApiKey({
      tenantId: tenant.id,
      name: 'Demo',
      branch: DEMO_BRANCH,
      pointOfSale: DEMO_POINT_OF_SALE,
    });
    const at = this.deps.now().toISOString();
    systemDb
      .prepare('INSERT INTO demo_sessions (tenant_id, template, created_at, last_used_at) VALUES (?, ?, ?, ?)')
      .run(tenant.id, template, at, at);
    return { tenantId: tenant.id, apiKey: rawKey, branch: DEMO_BRANCH, pointOfSale: DEMO_POINT_OF_SALE, template };
  }

  /** Corre el vencimiento de una demo en uso. En un tenant real no hace nada. */
  touch(tenantId: string): void {
    this.deps.systemDb
      .prepare('UPDATE demo_sessions SET last_used_at = ? WHERE tenant_id = ?')
      .run(this.deps.now().toISOString(), tenantId);
  }

  /** Borra las demos sin uso por más de `ttlHours`. Devuelve cuántas borró. */
  sweepExpired(): number {
    const cutoff = new Date(this.deps.now().getTime() - this.deps.config.ttlHours * HOUR_MS).toISOString();
    const rows = this.deps.systemDb
      .prepare('SELECT tenant_id FROM demo_sessions WHERE last_used_at < ?')
      .all(cutoff) as { tenant_id: string }[];
    for (const row of rows) {
      this.deps.tenantManager.deleteTenant(row.tenant_id);
    }
    return rows.length;
  }

  countActive(): number {
    const row = this.deps.systemDb.prepare('SELECT COUNT(*) AS n FROM demo_sessions').get() as { n: number };
    return row.n;
  }

  isFull(): boolean {
    return this.countActive() >= this.deps.config.maxActive;
  }
}

/** Barre al arrancar y cada `intervalMs`, sin mantener vivo el proceso. */
export function startDemoSweeper(service: DemoSessionService, intervalMs: number): NodeJS.Timeout {
  service.sweepExpired();
  const timer = setInterval(() => {
    service.sweepExpired();
  }, intervalMs);
  timer.unref();
  return timer;
}
```

`src/server/di/container.ts`: importar `readDemoConfig`, `DemoConfig` y `DemoSessionService`, y
sumar:

```ts
// --- DEMOS (#9) ---

export const demoConfigDef = fn.singleton((): DemoConfig => readDemoConfig(process.env));
export const clockDef = fn.singleton((): (() => Date) => () => new Date());
export const demoSessionServiceDef = fn.singleton(
  (c) =>
    new DemoSessionService({
      systemDb: c.use(systemDbDef),
      tenantManager: c.use(tenantManagerDef),
      apiKeyService: c.use(apiKeyServiceDef),
      config: c.use(demoConfigDef),
      now: c.use(clockDef),
    }),
);
```

En `ContainerDependencies`, sumar `demoConfig?: DemoConfig | undefined;` y
`now?: (() => Date) | undefined;`, con sus `bindCascading(...).toValue(...)` en
`createRootContainer`, igual que `systemDb`.

- [ ] **Paso 4: la suite completa**

`pnpm lint && pnpm typecheck && pnpm test`: todo en verde.

- [ ] **Paso 5: commit**

```bash
git add src/server/demo src/server/di/container.ts test/demo-session-service.test.ts
git commit -F - <<'EOF'
feat: servicio de demos aisladas con vencimiento y barrido

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 4: `POST /connector/demo-sessions`, capacidad y cableado

**Archivos:**
- Modificar: `src/server/middleware/auth-middleware.ts`, `src/server/routes/connector-routes.ts`,
  `src/server/app.ts`, `src/server/server.ts`
- Test: `test/demo-sessions-api.test.ts`

**Interfaces:**
- Consume: `DemoSessionService`, `demoSessionServiceDef`, `startDemoSweeper`,
  `DEMO_TEMPLATES`, `DEFAULT_DEMO_TEMPLATE`, `isDemoTemplate`.
- Produce:
  - `createPosAuthMiddleware(apiKeyService, tenantManager, rootContainer?, onAuthenticated?:
    (tenantId: string) => void)`.
  - `createConnectorRoutes(requirePosAuth, demoSessions: DemoSessionService)`.
  - `AppDependencies.demoConfig?` y `now?`; `createApp` devuelve además `demoSessions`.

- [ ] **Paso 1: los tests que fallan**

```ts
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { DatabaseSync } from 'node:sqlite';
import { createApp } from '../src/server/app.ts';
import { initSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import type { DemoConfig } from '../src/server/demo/demo-config.ts';

const HOUR = 60 * 60 * 1000;

type DemoBody = {
  apiKey: string;
  branch: string;
  pointOfSale: string;
  template: string;
  onboarding: { url: string; label: string };
  baseUrl?: string;
};

function makeApp(overrides: Partial<DemoConfig> = {}) {
  const systemDb = new DatabaseSync(':memory:');
  initSystemDb(systemDb);
  const clock = { now: new Date('2026-09-30T12:00:00.000Z') };
  const bundle = createApp({
    systemDb,
    tenantManager: new TenantManager(systemDb, { inMemory: true }),
    demoConfig: { enabled: true, ttlHours: 24, maxActive: 200, ...overrides },
    now: () => clock.now,
  });
  const advance = (ms: number): void => {
    clock.now = new Date(clock.now.getTime() + ms);
  };
  return { ...bundle, advance };
}

function startDemo(app: ReturnType<typeof makeApp>['app'], body?: object) {
  const req = request(app).post('/connector/demo-sessions').set('X-POS-Contract-Version', '4.4.0');
  return body === undefined ? req : req.send(body);
}

describe('POST /connector/demo-sessions (#9)', () => {
  it('crea una demo sin autenticación con el template por defecto', async () => {
    const { app } = makeApp();
    const res = await startDemo(app);
    expect(res.status).toBe(201);
    const body = res.body as DemoBody;
    expect(body).toMatchObject({ branch: 'CENTRAL', pointOfSale: 'Caja 1', template: 'kiosco' });
    expect(body.onboarding.label).toBe('Crear mi comercio');
    expect(body.onboarding.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/alta\?template=kiosco$/);
    expect(body).not.toHaveProperty('baseUrl');
  });

  it('usa PUBLIC_URL para la página de alta', async () => {
    const { app } = makeApp({ publicUrl: 'https://erp.example.com' });
    const res = await startDemo(app, { template: 'almacen' });
    expect((res.body as DemoBody).onboarding.url).toBe('https://erp.example.com/alta?template=almacen');
  });

  it('la key de la demo sincroniza el catálogo del template y declara la capacidad', async () => {
    const { app } = makeApp();
    const { apiKey } = (await startDemo(app, { template: 'ferreteria' })).body as DemoBody;

    const pull = await request(app)
      .post('/connector/sync/pull')
      .set('Authorization', `Bearer ${apiKey}`)
      .set('X-POS-Contract-Version', '4.4.0')
      .send({ cursors: {}, pendingLotIds: [] });
    expect(pull.status).toBe(200);
    const skus = (pull.body as { products: { items: { sku: string }[] } }).products.items.map((p) => p.sku);
    expect(skus).toContain('FER-001');

    const info = await request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);
    expect((info.body as { capabilities?: string[] }).capabilities).toEqual(['demo-sessions']);
  });

  it('422 con la lista si el template no existe', async () => {
    const { app } = makeApp();
    const res = await startDemo(app, { template: 'panaderia' });
    expect(res.status).toBe(422);
    expect(res.body).toEqual({ code: 'unknown-template', templates: ['kiosco', 'almacen', 'ferreteria'] });
  });

  it('400 si el body no tiene la forma', async () => {
    const { app } = makeApp();
    expect((await startDemo(app, { template: 5 })).status).toBe(400);
  });

  it('409 con otro major del contrato', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/connector/demo-sessions').set('X-POS-Contract-Version', '5.0.0');
    expect(res.status).toBe(409);
  });

  it('404 si las demos están apagadas', async () => {
    const { app } = makeApp({ enabled: false });
    expect((await startDemo(app)).status).toBe(404);
  });

  it('503 al llegar al tope', async () => {
    const { app } = makeApp({ maxActive: 1 });
    expect((await startDemo(app)).status).toBe(201);
    const res = await startDemo(app);
    expect(res.status).toBe(503);
    expect((res.body as { code: string }).code).toBe('demo-capacity');
  });

  it('una demo en uso no vence; una sin uso sí', async () => {
    const { app, advance, demoSessions } = makeApp();
    const { apiKey } = (await startDemo(app)).body as DemoBody;
    const info = () => request(app).get('/connector/info').set('Authorization', `Bearer ${apiKey}`);

    advance(23 * HOUR);
    expect((await info()).status).toBe(200); // el request la toca
    advance(23 * HOUR);
    demoSessions.sweepExpired();
    expect((await info()).status).toBe(200);

    advance(25 * HOUR);
    demoSessions.sweepExpired();
    expect((await info()).status).toBe(401);
  });

  it('sin demos, /info no declara capacidades', async () => {
    const { app } = makeApp({ enabled: false });
    const reg = await request(app).post('/api/auth/register').send({ email: 'a@b.com', password: 'secreta1', name: 'A' });
    const token = (reg.body as { token: string }).token;
    await request(app).post('/api/tenants').set('Authorization', `Bearer ${token}`).send({ id: 'tienda', slug: 'tienda', name: 'Tienda' });
    const key = await request(app)
      .post('/api/tenants/tienda/api-keys')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    const info = await request(app).get('/connector/info').set('Authorization', `Bearer ${(key.body as { rawKey: string }).rawKey}`);
    expect(info.status).toBe(200);
    expect(info.body).not.toHaveProperty('capabilities');
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

`pnpm vitest run test/demo-sessions-api.test.ts`: falla el tipo de `createApp` (`demoConfig`, `now`,
`demoSessions`) y la ruta da 401.

- [ ] **Paso 3: implementar**

`src/server/middleware/auth-middleware.ts`: sumar el parámetro
`onAuthenticated?: (tenantId: string) => void` a `createPosAuthMiddleware`, y llamarlo justo después
de validar la key (`onAuthenticated?.(validated.tenantId);`).

`src/server/routes/connector-routes.ts`:
- Importar `DemoSessionService`, `DEMO_TEMPLATES`, `DEFAULT_DEMO_TEMPLATE` e `isDemoTemplate`.
- Firma `createConnectorRoutes(requirePosAuth, demoSessions: DemoSessionService)`.
- Antes de `router.use(requirePosAuth)`:

```ts
const demoSessionRequestSchema = z.object({ template: z.string().optional() }).passthrough();

  // POST /demo-sessions (4.4.0, #9): el único endpoint sin key; sí valida la versión del contrato
  router.post('/demo-sessions', checkContractVersion, (req: Request, res: Response) => {
    if (!demoSessions.enabled()) {
      res.status(404).json({ error: 'Este backend no ofrece demos' });
      return;
    }
    const body: unknown = req.body ?? {};
    const parsed = demoSessionRequestSchema.safeParse(body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Payload inválido' });
      return;
    }
    const template = parsed.data.template ?? DEFAULT_DEMO_TEMPLATE;
    if (!isDemoTemplate(template)) {
      res.status(422).json({ code: 'unknown-template', templates: [...DEMO_TEMPLATES] });
      return;
    }
    demoSessions.sweepExpired();
    if (demoSessions.isFull()) {
      res.status(503).json({ code: 'demo-capacity', error: 'No hay lugar para más demos; probá más tarde' });
      return;
    }
    const session = demoSessions.create(template);
    const origin = demoSessions.publicUrl() ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
    res.status(201).json({
      apiKey: session.apiKey,
      branch: session.branch,
      pointOfSale: session.pointOfSale,
      template: session.template,
      onboarding: {
        url: `${origin}/alta?template=${encodeURIComponent(session.template)}`,
        label: 'Crear mi comercio',
      },
    });
  });
```

  (`checkContractVersion` pasa a recibir `Request`: ya lo usa con `AuthenticatedPosRequest`, que la
  extiende.)
- En `/info`, sumar `...(demoSessions.enabled() ? { capabilities: ['demo-sessions'] } : {})`.
- Actualizar el comentario "Connector API 4.2.0" donde corresponda a "4.2.0 más `demo-sessions`".

`src/server/app.ts`:
- `AppDependencies` suma `demoConfig?: DemoConfig | undefined; now?: (() => Date) | undefined;` y se
  los pasa a `createRootContainer`.
- `const demoSessions = rootContainer.use(demoSessionServiceDef);`
- `createPosAuthMiddleware(apiKeyService, tenantManager, rootContainer, (tenantId) => { demoSessions.touch(tenantId); })`.
- `app.use('/connector', createConnectorRoutes(requirePos, demoSessions));`
- Devolver `demoSessions` en el bundle (con su tipo en la firma).

`src/server/server.ts`, después de `createApp()`:

```ts
startDemoSweeper(bundle.demoSessions, 15 * 60 * 1000);
```

y sumar a la consola una línea `🧪 Landing y demo:    http://localhost:${String(PORT)}/` y
`🔧 Admin:             http://localhost:${String(PORT)}/admin`.

- [ ] **Paso 4: la suite completa**

`pnpm lint && pnpm typecheck && pnpm test`: todo en verde, incluidos `connector-api` y el e2e de
sync.

- [ ] **Paso 5: prueba con curl**

Con `pnpm dev` corriendo (PowerShell, en segundo plano):

```bash
curl -s -X POST http://localhost:4100/connector/demo-sessions -H "X-POS-Contract-Version: 4.4.0" -H "Content-Type: application/json" -d '{"template":"almacen"}'
```

Se espera un `201` con `onboarding.url` `http://localhost:4100/alta?template=almacen`.

- [ ] **Paso 6: commit**

```bash
git add src/server/middleware/auth-middleware.ts src/server/routes/connector-routes.ts src/server/app.ts src/server/server.ts test/demo-sessions-api.test.ts
git commit -F - <<'EOF'
feat: POST /demo-sessions y la capacidad demo-sessions en /info

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 5: ruteo del cliente y landing

**Archivos:**
- Crear: `src/client/state/route-state.ts`, `src/client/state/demo-link.ts`,
  `src/client/components/landing/LandingView.tsx`
- Modificar: `src/client/App.tsx`, `src/client/state/merchant-onboarding-state.ts` (solo
  `openMerchantOnboarding`, `closeMerchantOnboarding`, `enterDashboardFromOnboarding` y la detección
  de `/alta` en `initMerchantOnboardingFromUrl`), `tsconfig.json`, `src/client/index.html`
  (`<title>`)
- Test: `test/route-and-landing.test.ts`

**Interfaces:**
- Produce:
  - `type AppRoute = 'landing' | 'admin' | 'alta'`, `routeFromPath(pathname: string): AppRoute`,
    `canonicalPath(pathname: string): string | undefined`, `routeSignal`, `navigate(path: string):
    void` e `initRouting(): void`.
  - `POS_VERSION: string` y `buildDemoUrl(posVersion: string, origin: string): string`.

- [ ] **Paso 1: los tests que fallan**

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalPath, routeFromPath, navigate, routeSignal } from '../src/client/state/route-state.ts';
import { POS_VERSION, buildDemoUrl } from '../src/client/state/demo-link.ts';

describe('Ruteo del SPA (#9)', () => {
  it.each([
    ['/', 'landing'],
    ['/admin', 'admin'],
    ['/admin/', 'admin'],
    ['/admin/lo-que-sea', 'admin'],
    ['/alta', 'alta'],
    ['/onboarding', 'alta'],
    ['/no-existe', 'landing'],
  ] as const)('%s → %s', (path, route) => {
    expect(routeFromPath(path)).toBe(route);
  });

  it('/onboarding se reescribe a /alta', () => {
    expect(canonicalPath('/onboarding')).toBe('/alta');
    expect(canonicalPath('/alta')).toBeUndefined();
  });

  it('navigate cambia la ruta', () => {
    navigate('/admin');
    expect(routeSignal.value).toBe('admin');
    navigate('/');
    expect(routeSignal.value).toBe('landing');
  });
});

describe('Link de demo del landing', () => {
  it('la versión del POS sale de contract.json', () => {
    const contract = JSON.parse(readFileSync('contract.json', 'utf-8')) as { posVersion: string };
    expect(POS_VERSION).toBe(contract.posVersion);
  });

  it('abre el POS publicado en demo contra este Connector API', () => {
    const url = new URL(buildDemoUrl('0.1.0', 'http://localhost:4100'));
    expect(`${url.origin}${url.pathname}`).toBe('https://offline-pos.pages.dev/0.1.0/');
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('http://localhost:4100/connector');
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

`pnpm vitest run test/route-and-landing.test.ts`: fallan los imports.

- [ ] **Paso 3: implementar**

`tsconfig.json`: sumar `"resolveJsonModule": true`.

`src/client/state/route-state.ts`:

```ts
import { signal } from '@preact/signals';

/** Un solo SPA (#9): landing en `/`, admin en `/admin`, alta en `/alta`. */
export type AppRoute = 'landing' | 'admin' | 'alta';

function normalize(pathname: string): string {
  const clean = pathname.toLowerCase().replace(/\/+$/, '');
  return clean === '' ? '/' : clean;
}

export function routeFromPath(pathname: string): AppRoute {
  const path = normalize(pathname);
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/alta' || path === '/onboarding') return 'alta';
  return 'landing';
}

/** La ruta vieja del alta (`/onboarding`) se reescribe a `/alta`. */
export function canonicalPath(pathname: string): string | undefined {
  return normalize(pathname) === '/onboarding' ? '/alta' : undefined;
}

export const routeSignal = signal<AppRoute>(
  typeof window === 'undefined' ? 'landing' : routeFromPath(window.location.pathname),
);

export function navigate(path: string): void {
  if (typeof window !== 'undefined') {
    window.history.pushState(null, '', path);
  }
  routeSignal.value = routeFromPath(new URL(path, 'http://localhost').pathname);
}

export function initRouting(): void {
  const canonical = canonicalPath(window.location.pathname);
  if (canonical !== undefined) {
    window.history.replaceState(null, '', `${canonical}${window.location.search}${window.location.hash}`);
  }
  routeSignal.value = routeFromPath(window.location.pathname);
  window.addEventListener('popstate', () => {
    routeSignal.value = routeFromPath(window.location.pathname);
  });
}
```

`src/client/state/demo-link.ts`:

```ts
import contract from '../../../contract.json' with { type: 'json' };

/** La versión publicada del POS contra la que se probó el mini-erp (la mueve `pnpm contract:update`). */
export const POS_VERSION: string = contract.posVersion;

/** Link de "Probar la demo": el POS publicado, en demo contra el Connector API de este mini-erp. */
export function buildDemoUrl(posVersion: string, origin: string): string {
  const url = new URL(`https://offline-pos.pages.dev/${posVersion}/`);
  url.searchParams.set('demo', 'true');
  url.searchParams.set('backend', `${origin}/connector`);
  return url.toString();
}
```

Si Vite o `tsc` rechazan el import con atributos, frenar y consultar antes de cambiar de enfoque.

`src/client/components/landing/LandingView.tsx`:

```tsx
import { ThemeToggle } from '../ui/ThemeToggle.tsx';
import { POS_VERSION, buildDemoUrl } from '../../state/demo-link.ts';

export function LandingView() {
  const origin = typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
  const demoUrl = buildDemoUrl(POS_VERSION, origin);
  const isLocal = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(origin);

  return (
    <div class="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      <header class="px-4 sm:px-6 py-4 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
        <div class="font-bold tracking-tight">Mini-ERP</div>
        <div class="flex items-center gap-3">
          <ThemeToggle compact />
          <a href="/admin" class="text-sm text-indigo-600 dark:text-indigo-400 hover:underline">
            Entrar al admin
          </a>
        </div>
      </header>
      <main class="flex-1 flex items-center justify-center px-4 py-12">
        <div class="max-w-xl text-center space-y-6">
          <h1 class="text-3xl sm:text-4xl font-bold tracking-tight">
            Tu comercio, con un POS que vende aunque se corte internet
          </h1>
          <p class="text-slate-600 dark:text-slate-400">
            Mini-ERP es el backend de ejemplo de offline-pos: catálogo, stock por sucursal, clientes y
            cuentas corrientes. Probá el POS con datos de ejemplo y, cuando quieras, creá tu comercio.
          </p>
          <a
            href={demoUrl}
            class="inline-flex items-center justify-center px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-lg shadow-indigo-600/25"
          >
            Probar la demo
          </a>
          <p class="text-xs text-slate-500 dark:text-slate-400">
            Abre el POS {POS_VERSION} publicado en offline-pos.pages.dev, conectado a este mini-erp.
            {isLocal && ' Como el mini-erp corre en tu equipo, Chrome te va a pedir permiso de red local la primera vez.'}
          </p>
        </div>
      </main>
    </div>
  );
}
```

`src/client/App.tsx`:
- Reemplazar la inicialización por:

```ts
if (typeof window !== 'undefined') {
  initRouting();
  initMerchantOnboardingFromUrl();
}
```

- Al principio de `App()`: `if (routeSignal.value === 'landing') { return <LandingView />; }` (el
  resto queda igual: alta si `merchantOnboardingActiveSignal`, login o shell).

`src/client/state/merchant-onboarding-state.ts` (solo el ruteo en esta tarea):
- `initMerchantOnboardingFromUrl`: la activación pasa a
  `if (routeFromPath(url.pathname) === 'alta') merchantOnboardingActiveSignal.value = true;` y se
  sacan `pathname.includes('/onboarding')`, `hash.includes('onboarding')` y `isOnboardingParam`.
- `openMerchantOnboarding`: al final, `navigate('/alta');`.
- `closeMerchantOnboarding` y `enterDashboardFromOnboarding`: reemplazar el bloque
  `if (typeof window !== 'undefined' && window.location.pathname.includes('/onboarding')) { window.history.pushState(null, '', '/'); }`
  por `navigate('/admin');`.

`src/client/index.html`: `<title>Mini-ERP</title>`.

- [ ] **Paso 4: la suite completa y el build**

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`: todo en verde. `merchant-onboarding.test.ts`
sigue pasando (en Node `navigate` solo cambia el signal).

- [ ] **Paso 5: verificación manual**

Con `pnpm dev`, en el navegador:
- `/` muestra el landing y el botón apunta a
  `https://offline-pos.pages.dev/0.1.0/?demo=true&backend=http%3A%2F%2Flocalhost%3A4100%2Fconnector`.
- "Entrar al admin" lleva a `/admin` con el login.
- `/onboarding?return_url=x` queda como `/alta?return_url=x` y muestra el alta.
- Atrás y adelante del navegador cambian de vista.

- [ ] **Paso 6: commit**

```bash
git add tsconfig.json src/client/state/route-state.ts src/client/state/demo-link.ts src/client/components/landing/LandingView.tsx src/client/App.tsx src/client/state/merchant-onboarding-state.ts src/client/index.html test/route-and-landing.test.ts
git commit -F - <<'EOF'
feat: landing en la raíz con "Probar la demo" y admin en /admin

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 6: el alta vuelve al POS con `#connect`

**Archivos:**
- Crear: `src/client/state/connect-return.ts`
- Modificar: `src/client/state/merchant-onboarding-state.ts`,
  `src/client/components/onboarding/MerchantOnboardingView.tsx`
- Test: `test/connect-return.test.ts`; modificar `test/merchant-onboarding.test.ts`

**Interfaces:**
- Consume: `navigate` (tarea 5).
- Produce:
  - `type PosConnection = { baseUrl: string; apiKey: string; branch: string; pointOfSale: string;
    wipeKey?: string | undefined }`.
  - `buildConnectReturnUrl(returnUrl: string, connection: PosConnection): string | undefined`.
  - `readAltaParams(href: string): { returnUrl: string | null; wipeKey: string | null; template:
    AltaTemplate | null }` y `type AltaTemplate = 'kiosco' | 'almacen' | 'ferreteria'`.
  - `MerchantProvisionResult` pierde `returnWithParamsUrl` y suma `connectReturnUrl: string | null` y
    `returnHost: string | null`.

- [ ] **Paso 1: los tests que fallan**

`test/connect-return.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildConnectReturnUrl } from '../src/client/state/connect-return.ts';

const connection = {
  baseUrl: 'http://localhost:4100/connector',
  apiKey: 'mpos_abc',
  branch: 'CENTRAL',
  pointOfSale: 'Caja 1',
};

function decode(url: string): unknown {
  const hash = new URL(url).hash;
  expect(hash.startsWith('#connect=')).toBe(true);
  return JSON.parse(Buffer.from(hash.slice('#connect='.length), 'base64url').toString('utf-8'));
}

describe('buildConnectReturnUrl (#9)', () => {
  it('pone la conexión en el fragmento, con el wipeKey recibido', () => {
    const url = buildConnectReturnUrl('https://offline-pos.pages.dev/0.1.0/', { ...connection, wipeKey: 'wk-1' });
    expect(url?.startsWith('https://offline-pos.pages.dev/0.1.0/#connect=')).toBe(true);
    expect(decode(url ?? '')).toEqual({ ...connection, wipeKey: 'wk-1' });
  });

  it('sin wipeKey no lo manda', () => {
    const url = buildConnectReturnUrl('https://offline-pos.pages.dev/0.1.0/', { ...connection, wipeKey: undefined });
    expect(decode(url ?? '')).toEqual(connection);
  });

  it('nunca pone la conexión en la query y conserva la que había', () => {
    const url = buildConnectReturnUrl('https://pos.example.com/app/?x=1#viejo', connection) ?? '';
    const parsed = new URL(url);
    expect(parsed.search).toBe('?x=1');
    expect(parsed.hash.startsWith('#connect=')).toBe(true);
    expect(url).not.toContain('mpos_abc');
  });

  it('base64url sin relleno ni caracteres de base64 común', () => {
    const url = buildConnectReturnUrl('https://pos.example.com/', { ...connection, apiKey: '???>>>~~~ñ' }) ?? '';
    expect(new URL(url).hash.slice('#connect='.length)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decode(url)).toMatchObject({ apiKey: '???>>>~~~ñ' });
  });

  it.each(['javascript:alert(1)', 'data:text/html,hola', 'no es una url', ''])('rechaza %j', (bad) => {
    expect(buildConnectReturnUrl(bad, connection)).toBeUndefined();
  });
});
```

En `test/merchant-onboarding.test.ts`:
- Sumar `wipeKeySignal` y `readAltaParams` a los imports.
- Agregar:

```ts
  describe('Parámetros de /alta', () => {
    it('lee return_url, wipe_key y template', () => {
      expect(
        readAltaParams('http://localhost:4100/alta?template=almacen&return_url=https%3A%2F%2Foffline-pos.pages.dev%2F0.1.0%2F&wipe_key=wk-9'),
      ).toEqual({ returnUrl: 'https://offline-pos.pages.dev/0.1.0/', wipeKey: 'wk-9', template: 'almacen' });
    });

    it('ignora un template desconocido y los parámetros viejos', () => {
      expect(readAltaParams('http://localhost:4100/alta?template=panaderia&returnUrl=x&preset=almacen')).toEqual({
        returnUrl: null,
        wipeKey: null,
        template: null,
      });
    });
  });
```

- En el test de aprovisionamiento, poner `wipeKeySignal.value = 'wk-123';` junto a
  `returnUrlSignal.value = …` y reemplazar el bloque "Verificar que la URL de retorno incluya las
  credenciales…" por:

```ts
      const connectUrl = merchantResultSignal.value?.connectReturnUrl ?? '';
      expect(connectUrl.startsWith('http://localhost:5173/#connect=')).toBe(true);
      expect(connectUrl).not.toContain('api_key=');
      const payload: unknown = JSON.parse(
        Buffer.from(new URL(connectUrl).hash.slice('#connect='.length), 'base64url').toString('utf-8'),
      );
      expect(payload).toEqual({
        baseUrl: 'http://localhost:4100/connector',
        apiKey: 'pos_live_merchant_xyz',
        branch: 'CENTRAL',
        pointOfSale: 'Caja 1',
        wipeKey: 'wk-123',
      });
      expect(merchantResultSignal.value?.returnHost).toBe('localhost:5173');
```

- [ ] **Paso 2: correrlos y ver que fallan**

`pnpm vitest run test/connect-return.test.ts test/merchant-onboarding.test.ts`: fallan el import de
`connect-return`, `readAltaParams` y `connectReturnUrl`.

- [ ] **Paso 3: implementar**

`src/client/state/connect-return.ts`:

```ts
/** La conexión que el alta le devuelve al POS (contrato 4.4.0, "Vuelta del onboarding"). */
export type PosConnection = {
  baseUrl: string;
  apiKey: string;
  branch: string;
  pointOfSale: string;
  wipeKey?: string | undefined;
};

function toBase64Url(text: string): string {
  let binary = '';
  for (const byte of new TextEncoder().encode(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * `<return_url>#connect=<base64url de JSON>`: la conexión va siempre en el fragmento (el navegador
 * no se lo manda al servidor del POS), nunca en la query. `wipeKey` va solo si vino, sin modificar.
 * Devuelve `undefined` si `return_url` no es una URL `http:` o `https:`.
 */
export function buildConnectReturnUrl(returnUrl: string, connection: PosConnection): string | undefined {
  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return undefined;
  }
  const { baseUrl, apiKey, branch, pointOfSale, wipeKey } = connection;
  const payload = {
    baseUrl,
    apiKey,
    branch,
    pointOfSale,
    ...(wipeKey === undefined || wipeKey === '' ? {} : { wipeKey }),
  };
  url.hash = `connect=${toBase64Url(JSON.stringify(payload))}`;
  return url.toString();
}
```

`src/client/state/merchant-onboarding-state.ts`:
- Sumar:

```ts
export type AltaTemplate = 'kiosco' | 'almacen' | 'ferreteria';
const ALTA_TEMPLATES: readonly AltaTemplate[] = ['kiosco', 'almacen', 'ferreteria'];

function isAltaTemplate(value: string): value is AltaTemplate {
  return (ALTA_TEMPLATES as readonly string[]).includes(value);
}

/** Lo que el POS (o el link de una demo) le pasa a `/alta`: `return_url`, `wipe_key` y `template`. */
export function readAltaParams(href: string): {
  returnUrl: string | null;
  wipeKey: string | null;
  template: AltaTemplate | null;
} {
  const params = new URL(href).searchParams;
  const template = params.get('template');
  return {
    returnUrl: params.get('return_url') || null,
    wipeKey: params.get('wipe_key') || null,
    template: template !== null && isAltaTemplate(template) ? template : null,
  };
}
```

- `initMerchantOnboardingFromUrl`: después de la activación por ruta, usar
  `readAltaParams(window.location.href)` para `returnUrlSignal`, `wipeKeySignal` y
  `selectedMerchantPresetSignal` (este último solo si `template !== null`). Se borran las lecturas
  viejas (`returnUrl`, `redirect_uri`, `wipeKey`, `preset`).
- `MerchantProvisionResult`: sacar `returnWithParamsUrl` y sumar `connectReturnUrl: string | null` y
  `returnHost: string | null`.
- En `executeMerchantProvisioning`, reemplazar el bloque "Armar URL de retorno con credenciales…"
  (el `try` con `searchParams.set`) por:

```ts
    const rawReturnUrl = returnUrlSignal.value;
    const connectReturnUrl =
      rawReturnUrl === null
        ? undefined
        : buildConnectReturnUrl(rawReturnUrl, {
            baseUrl: connectorUrl,
            apiKey,
            branch: branchCode,
            pointOfSale: posTerminalName,
            wipeKey: wipeKeySignal.value ?? undefined,
          });
```

  y en `merchantResultSignal.value` usar
  `connectReturnUrl: connectReturnUrl ?? null` y
  `returnHost: connectReturnUrl === undefined ? null : new URL(connectReturnUrl).host`.
- `returnToPosWithCredentials`: usar `res?.connectReturnUrl`.

`src/client/components/onboarding/MerchantOnboardingView.tsx`, en el paso 4:
- La condición `result.returnWithParamsUrl ?` pasa a `result.connectReturnUrl ?`.
- El texto bajo "Vincular con tu Punto de Venta (POS)" pasa a
  `Vas a volver a {result.returnHost}. Tu caja queda conectada a tu comercio nuevo y se borran los datos de la demo.`
- El botón principal pasa a `Volver al POS`.
- Se borra el bloque del link "Compartir configuración por WhatsApp" (el `<div class="pt-2 border-t …">`
  con el `<a href={`https://api.whatsapp.com/…`}>`).

Revisar con `grep -rn "returnWithParamsUrl\|whatsapp" src test` que no quede nada.

- [ ] **Paso 4: la suite completa y el build**

`pnpm lint && pnpm typecheck && pnpm test && pnpm build`: todo en verde.

- [ ] **Paso 5: verificación manual**

Con `pnpm dev`, abrir
`http://localhost:4100/alta?template=almacen&return_url=https%3A%2F%2Fexample.com%2F&wipe_key=wk-1`,
registrar un usuario y crear un comercio:
- El rubro sale preseleccionado en Almacén.
- La pantalla final dice "Vas a volver a example.com".
- "Volver al POS" navega a `https://example.com/#connect=…`.

- [ ] **Paso 6: commit**

```bash
git add src/client/state/connect-return.ts src/client/state/merchant-onboarding-state.ts src/client/components/onboarding/MerchantOnboardingView.tsx test/connect-return.test.ts test/merchant-onboarding.test.ts
git commit -F - <<'EOF'
feat: el alta vuelve al POS con la conexión en #connect

Saca el armado viejo con credenciales en la query string y el link
de WhatsApp, que el POS ya no lee.

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 7: documentación

**Archivos:**
- Modificar: `README.md`, `AGENTS.md`, `PLAN.md`

- [ ] **Paso 1: README**
  - "Levantarlo": el landing en `/`, el admin en `/admin`, el alta en `/alta`, su API en `/api` y el
    Connector API en `/connector`.
  - Una sección "Probar la demo con el POS publicado": `pnpm dev`, abrir `http://localhost:4100/` en
    Chrome, "Probar la demo", aceptar el permiso de red local, `/ALTA` y el alta.
  - Una tabla con `DEMO_SESSIONS`, `DEMO_TTL_HOURS`, `DEMO_MAX_ACTIVE` y `PUBLIC_URL`.
  - "Contrato": "Implementa el Connector API **4.2.0** más la capacidad `demo-sessions` de 4.4.0".

- [ ] **Paso 2: AGENTS.md**
  - "Contrato implementado": 4.2.0 más `demo-sessions` (`POST /connector/demo-sessions`, la vuelta
    con `#connect` desde `/alta`), y lo que falta de 4.4.0 (#2).
  - En "Arquitectura": `demo_sessions` en `system.sqlite`, `DemoSessionService` de sistema,
    vencimiento por último uso y barrido; CORS `*` con red privada; el ruteo del SPA (`/`, `/admin`,
    `/alta`).
  - "Estado": #9 hecho y lo que sigue.

- [ ] **Paso 3: PLAN.md**

Una fase nueva ("Fase 9: demo y alta con el POS publicado"), con el mismo formato que las
anteriores y links a la spec y a este plan.

- [ ] **Paso 4: chequeos y commit**

`pnpm lint && pnpm typecheck && pnpm test` en verde.

```bash
git add README.md AGENTS.md PLAN.md
git commit -F - <<'EOF'
docs: demo, alta con #connect y rutas nuevas en README, AGENTS.md y PLAN.md

Refs #9

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
```

---

### Tarea 8: prueba de punta a punta con el POS publicado

Sin código: el recorrido real, con capturas para el informe.

- [ ] **Paso 1:** base limpia (`data/` de la worktree) y `pnpm dev` en segundo plano (PowerShell).
- [ ] **Paso 2:** en Chrome, `http://localhost:4100/` → captura del landing → "Probar la demo".
- [ ] **Paso 3:** Chrome pide permiso de red local: **lo acepta el usuario** (se le avisa con una
  notificación). Captura del POS con la marca DEMO y "Crear mi comercio (/ALTA)".
- [ ] **Paso 4:** vender un producto del catálogo kiosco (efectivo). Captura.
- [ ] **Paso 5:** `/ALTA` → la página `/alta` del mini-erp con Kiosco preseleccionado → registrar
  un usuario de prueba y crear el comercio. Captura de la pantalla final ("Vas a volver a
  offline-pos.pages.dev").
- [ ] **Paso 6:** "Volver al POS" → el POS queda conectado sin DEMO y sin la venta de práctica.
  Captura.
- [ ] **Paso 7:** una venta nueva y `/SINCRONIZAR`. En `/admin`, con el usuario del alta, el comercio
  nuevo con esa venta y sin la de la demo. Captura.
- [ ] **Paso 8:** en `data/system.sqlite`, la demo sigue en `demo_sessions` y no figura en la lista
  del admin.
- [ ] **Paso 9:** lo que aparezca del lado del POS se anota como issue en `rauldiazsolis/offline-pos`
  sin tocarlo.
- [ ] **Paso 10:** el informe final con la prueba manual paso a paso y las capturas. Frenar para la
  revisión del usuario.

Después de la revisión, y solo con su aprobación: push, PR con "Closes #9" (merge commit), verificar
que #9 se cierre y tildar el ítem en rauldiazsolis/offline-pos#166.

---

## Addendum: POS híbrido y e2e (tareas 9 a 13, aprobadas el 2026-09-30)

Ver el addendum de la spec. Se ejecutaron inline con checkpoints, igual que las anteriores.

- **Tarea 9**: `pnpm pos:mirror`. `src/server/pos-mirror/pos-assets.ts` (referencias del `index.html`
  y de los bundles, sin salirse de la carpeta), `src/server/pos-mirror/mirror.ts` (`mirrorPos`,
  `isPosMirrored`, `contractPosVersion`; valida `version.json` y arma la copia en una carpeta temporal),
  `scripts/pos-mirror.ts`. `vendor/` en `.gitignore` y en el lint. Tests: `test/pos-mirror.test.ts`.
- **Tarea 10**: `src/server/pos-mirror/serve.ts` (`mountPosMirror`, `ensurePosMirror`), montado en
  `client-middleware.ts` solo fuera de producción; `posBaseUrl` en `src/client/state/demo-link.ts` y el
  landing con `import.meta.env.DEV`; `DATA_DIR` (`src/server/db/data-dir.ts`) en el contenedor. Tests:
  `test/pos-local-copy.test.ts`.
- **Tarea 11**: `@playwright/test` 1.63.0, `playwright.config.ts`, `e2e/serve.ts` (base vacía,
  nunca la de desarrollo), `e2e/demo-onboarding.spec.ts`, `pnpm test:e2e` y el paso en el CI.
- **Tarea 12**: README, AGENTS.md, PLAN.md y estos addenda.
- **Tarea 13**: actualizar el PR #10.
