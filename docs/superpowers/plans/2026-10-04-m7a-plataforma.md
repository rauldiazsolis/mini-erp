# M7a · Panel de plataforma, soporte y suspensión: plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **tarea por tarea en esta misma
> conversación** (nunca un subagente por tarea, AGENTS.md). Al terminar cada tarea: verificación,
> commit y se frena para que el usuario la revise. Pasos con checkbox (`- [ ]`).

**Objetivo:** el panel de plataforma de M7 (comercios con estado y cobro, usuarios, soporte, registro),
suspender comercios, desactivar usuarios, invitar a soporte y el arreglo de #68, sin sacar nada de lo
que hay (la membresía implícita y la impersonación de comercio siguen hasta M7b).

**Arquitectura:** servicios de sistema nuevos en `src/server/platform/` (contenedor raíz, reloj
inyectable), una migración de sistema v7 y un router `platform-admin-routes.ts` montado junto al de
cobro en `/api/platform`. En el cliente, `/plataforma` suma solapas y un detalle de comercio; la barra
de cobro se muda de Uso y pagos al detalle.

**Stack:** Node 24 (strip de tipos), Express, `node:sqlite`, Hardwired 1.6.2, Zod 4 desde
`src/shared/zod.ts`, Preact + signals, TanStack Query core, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-04-m7-plataforma-design.md` (parte M7a).

## Restricciones globales

- Todo en español: textos, comentarios, commits (`feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `build:`).
- TDD: el test primero, verlo fallar, lo mínimo para que pase. Antes de cada commit:
  `pnpm lint && pnpm typecheck && pnpm test` (desde PowerShell); `pnpm build` si se toca el cliente.
- Sin `any`, sin `as` ni `!` para callar a `exactOptionalPropertyTypes`; `unknown` solo en fronteras,
  validado con Zod en la línea siguiente. Zod siempre desde `src/shared/zod.ts`.
- Sin parameter properties; imports relativos con extensión `.ts`/`.tsx`.
- Ninguna migración toca la línea de base; `up` no abre transacciones.
- Cliente: sin hooks de React; overlays solo con `Modal`/`Drawer`; fechas y números con `src/client/format.ts`;
  navegación solo con `route-state.ts`; consultas con `createSignalQuery` y mutaciones con `invalidateAfter`.
- Errores de negocio con `DomainError` (`src/server/errors.ts`); toda acción de plataforma queda en `audit_log`.
- Commits con el pie `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `src/client/api/query-client.ts` | #68: placeholder solo si la consulta anterior sigue en la caché |
| `src/server/db/migrations/system/v7-plataforma.ts` | migración v7 |
| `src/server/platform/suspensions.ts` | `isSuspended`, `suspendedDays` (SQL puro sobre `tenant_suspensions`) |
| `src/server/platform/suspension-service.ts` | suspender y reactivar, con auditoría |
| `src/server/platform/user-status-service.ts` | desactivar y reactivar usuarios, con sus reglas |
| `src/server/platform/staff-invitation-service.ts` | invitaciones de soporte |
| `src/server/platform/platform-query-service.ts` | listados del panel: comercios, detalle, usuarios, equipo |
| `src/server/routes/platform-admin-routes.ts` | rutas nuevas de `/api/platform` |
| `src/server/routes/link-routes.ts` | `+ createStaffInvitationLinkRoutes` |
| `src/shared/platform-types.ts` | tipos de la API del panel |
| `src/client/routing/admin-routes.ts` | solapas, detalle y filtros de `/plataforma` |
| `src/client/state/platform-state.ts` | acciones de cobro con `tenantId` explícito |
| `src/client/state/platform-panel-state.ts` | consultas y acciones del panel |
| `src/client/components/platform/*.tsx` | vistas de las solapas y del detalle |
| `src/client/components/shell/SuspendedNotice.tsx` | "Este comercio está suspendido" |
| `e2e/platform.spec.ts` | e2e de M7a |

---

### Tarea 1: #68, el placeholder solo con la consulta anterior en la caché

**Archivos:**
- Modificar: `src/client/api/query-client.ts` (el `placeholderData` de `createSignalQuery`)
- Test: `test/signal-query.test.ts`

- [ ] **Paso 1: test que falla.** Al final del `describe` principal de `test/signal-query.test.ts`
  (seguir el armado de los tests de "placeholder solo en el mismo comercio" que ya están ahí: misma
  forma de crear la consulta con `keepPrevious` y de resolver el `fn` a mano):

```ts
it('después de clear(), la misma clave con otra sesión no muestra el dato anterior (#68)', async () => {
  let token = 'tok-a';
  const pending: Array<(v: string) => void> = [];
  const keySignal = signal<readonly unknown[]>(['t', 'kiosco', 'billing-status', token]);
  const q = createSignalQuery<string>({
    source: () => ({ key: keySignal.value, fn: () => new Promise<string>((resolve) => { pending.push(resolve); }) }),
    keepPrevious: (prev, next) => prev[0] === 't' && next[0] === 't' && prev[1] === next[1],
  });
  pending.shift()?.('dato de A');
  await vi.waitFor(() => { expect(q.data.value).toBe('dato de A'); });

  queryClient.clear();
  token = 'tok-b';
  keySignal.value = ['t', 'kiosco', 'billing-status', token];
  expect(q.data.value).toBeUndefined();
  pending.shift()?.('dato de B');
  await vi.waitFor(() => { expect(q.data.value).toBe('dato de B'); });
  q.dispose();
});
```

  (La clave de los stores reales no lleva el token: el test lo agrega para forzar una clave distinta
  que conserve el comercio, que es lo que pasa cuando `clear()` borra la consulta y el observer
  todavía la recuerda. Si la suite ya tiene un helper para esto, usarlo.)

- [ ] **Paso 2:** `pnpm vitest run test/signal-query.test.ts` → FALLA (`data` es `'dato de A'`).
- [ ] **Paso 3: implementación** en `createSignalQuery`:

```ts
placeholderData: (previous, previousQuery) =>
  source !== null &&
  previousQuery !== undefined &&
  // Después de un clear() (cambio de sesión) la consulta anterior ya no está: nada de placeholder (#68)
  queryClient.getQueryCache().find({ queryKey: previousQuery.queryKey, exact: true }) === previousQuery &&
  options.keepPrevious?.(previousQuery.queryKey, source.key) === true
    ? previous
    : undefined,
```

- [ ] **Paso 4:** `pnpm vitest run test/signal-query.test.ts test/credits-client.test.ts` → PASA.
- [ ] **Paso 5:** `pnpm lint && pnpm typecheck && pnpm test` y commit
  `fix: el admin no muestra el dato de la sesión anterior en el mismo comercio (#68)`.

---

### Tarea 2: migración de sistema v7

**Archivos:**
- Crear: `src/server/db/migrations/system/v7-plataforma.ts`
- Modificar: `src/server/db/migrations/system.ts` (import y `migrations: [v5…, v6…, v7Plataforma]`)
- Test: `test/system-migration-v7.test.ts`

**Produce:** `users.status`, `staff_invitations`, `tenant_suspensions`, `password_resets.tenant_id`
nullable, `audit_log.impersonator_user_id`, `idx_audit_at`.

- [ ] **Paso 1: test que falla** (`test/system-migration-v7.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

describe('migración de sistema v7 plataforma (#23)', () => {
  it('suma estado de usuarios, suspensiones, invitaciones de soporte y el impersonador de la auditoría sin perder datos', () => {
    const db = createDbAtVersion(SYSTEM_SCHEMA, 6);
    const at = '2026-10-01T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'a@x.com', 'h', 'Ana', 'user', ?)").run(at);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES ('k', 'k', 'Kiosco', ?, 'u1')").run(at);
    db.prepare("INSERT INTO password_resets (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at) VALUES ('r1', 'u1', 'th', 'u1', 'k', ?, ?)").run(at, at);
    db.prepare("INSERT INTO audit_log (id, at, actor_user_id, tenant_id, action, details) VALUES ('a1', ?, 'u1', 'k', 'tenant.created', '{}')").run(at);

    migrateDb(db, SYSTEM_SCHEMA);

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 7 });
    expect(db.prepare('SELECT id, status FROM users').all()).toEqual([{ id: 'u1', status: 'active' }]);
    expect(db.prepare('SELECT id, tenant_id, token_hash FROM password_resets').all()).toEqual([{ id: 'r1', tenant_id: 'k', token_hash: 'th' }]);
    db.prepare("INSERT INTO password_resets (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at) VALUES ('r2', 'u1', 'th2', 'u1', NULL, ?, ?)").run(at, at);
    expect(db.prepare('SELECT id, impersonator_user_id FROM audit_log').all()).toEqual([{ id: 'a1', impersonator_user_id: null }]);
    db.prepare("INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES ('s1', 'k', ?, NULL, 'Pedido', 'u1')").run(at);
    db.prepare("INSERT INTO staff_invitations (id, email, token_hash, created_by, created_at, expires_at) VALUES ('i1', 's@x.com', 'h1', 'u1', ?, ?)").run(at, at);
    const indices = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name IN ('idx_audit_at', 'idx_tenant_suspensions_tenant')").all() as { name: string }[]).map((r) => r.name).sort();
    expect(indices).toEqual(['idx_audit_at', 'idx_tenant_suspensions_tenant']);
  });
});
```

- [ ] **Paso 2:** `pnpm vitest run test/system-migration-v7.test.ts` → FALLA (`user_version` 6).
- [ ] **Paso 3: la migración** (`v7-plataforma.ts`):

```ts
import type { Migration } from '../types.ts';

/**
 * Plataforma (#23, M7a): estado de los usuarios, períodos de suspensión de los comercios,
 * invitaciones de soporte (sin comercio), restablecimientos sin comercio (desde la plataforma) y el
 * impersonador en la auditoría (se llena desde M7b).
 */
export const v7Plataforma: Migration = {
  version: 7,
  name: 'plataforma',
  up: (db) => {
    db.exec(`
ALTER TABLE users ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE audit_log ADD COLUMN impersonator_user_id TEXT;
CREATE INDEX idx_audit_at ON audit_log (at);

CREATE TABLE tenant_suspensions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  from_at TEXT NOT NULL,
  to_at TEXT,
  reason TEXT NOT NULL,
  created_by TEXT NOT NULL,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);
CREATE INDEX idx_tenant_suspensions_tenant ON tenant_suspensions (tenant_id, from_at);

CREATE TABLE staff_invitations (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  revoked_at TEXT
);

CREATE TABLE password_resets_v7 (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  tenant_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
INSERT INTO password_resets_v7 (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at, used_at)
  SELECT id, user_id, token_hash, created_by, tenant_id, created_at, expires_at, used_at FROM password_resets;
DROP TABLE password_resets;
ALTER TABLE password_resets_v7 RENAME TO password_resets;
`);
  },
};
```

  Antes de escribirla, verificar con `grep -n "password_resets" src/server/db/migrations/system.ts`
  que la línea de base no crea índices sobre `password_resets` (si los crea, recrearlos al final).

- [ ] **Paso 4:** `pnpm vitest run test/system-migration-v7.test.ts test/migrations.test.ts test/run-migrations.test.ts` → PASA
  (si `migrations.test.ts` fija la versión actual del sistema, actualizarla a 7).
- [ ] **Paso 5:** suite completa y commit `feat: migración de sistema v7 para la plataforma (#23)`.

---

### Tarea 3: suspender y reactivar comercios

**Archivos:**
- Crear: `src/server/platform/suspensions.ts`, `src/server/platform/suspension-service.ts`
- Modificar: `src/server/middleware/tenant-context-middleware.ts`, `src/server/billing/billing-service.ts`
  (`charge`), `src/server/audit/audit-log.ts` (acciones), `src/server/di/container.ts`
  (`suspensionServiceDef`), `src/server/app.ts`
- Crear: `src/server/routes/platform-admin-routes.ts` (con las dos rutas de esta tarea)
- Test: `test/tenant-suspension.test.ts`

**Produce:**
- `isSuspended(db, tenantId): boolean`, `currentSuspension(db, tenantId): { since: string; reason: string } | null`,
  `suspendedDays(db, tenantId, days: readonly string[]): Set<string>`.
- `SuspensionService.suspend({ tenantId, reason, actorUserId })`, `.reactivate({ tenantId, actorUserId })`
  (tiran `DomainError` 404 si el comercio no existe o es demo, 409 si ya está en ese estado).
- `createPlatformAdminRoutes(deps: PlatformAdminDeps): Router` y el helper `auditedAction`.
- `AuditAction` suma: `'tenant.suspended' | 'tenant.reactivated' | 'user.disabled' | 'user.enabled' |
  'staff.invited' | 'staff.invitation_revoked' | 'staff.joined'`.

- [ ] **Paso 1: tests que fallan** (`test/tenant-suspension.test.ts`). Armado como `test/platform-api.test.ts`
  (root, soporte y owner con `createApp`, reloj fijo `2026-10-05T15:00:00.000Z`, comercio `kiosco` con
  una caja y su key: copiar el armado de caja y key de `test/billing-push.test.ts`):

```ts
it('soporte suspende con motivo: el owner recibe 403 tenant-suspended salvo Uso y pagos, billing-status y exportar', async () => {
  const s = await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('support')).send({ reason: 'Pedido del dueño' });
  expect(s.status).toBe(200);
  const blocked = await request(app).get('/api/tenants/kiosco/products').set(as('owner'));
  expect(blocked.status).toBe(403);
  expect(blocked.body).toMatchObject({ code: 'tenant-suspended' });
  expect((await request(app).get('/api/tenants/kiosco/credits').set(as('owner'))).status).toBe(200);
  expect((await request(app).get('/api/tenants/kiosco/billing-status').set(as('owner'))).status).toBe(200);
  expect((await request(app).get('/api/tenants/kiosco/export/products').set(as('owner'))).status).toBe(200);
  // Root y soporte siguen mirando (hasta M7b, como owners implícitos)
  expect((await request(app).get('/api/tenants/kiosco/products').set(as('support'))).status).toBe(200);
  expect(audit('tenant.suspended')).toEqual([{ tenant_id: 'kiosco', details: JSON.stringify({ reason: 'Pedido del dueño' }) }]);
});

it('/auth/me muestra el comercio suspendido y reactivar lo devuelve a la normalidad', async () => {
  await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('root')).send({ reason: 'x' });
  const me = await request(app).get('/api/auth/me').set(as('owner'));
  expect((me.body as { tenants: { status: string }[] }).tenants[0]?.status).toBe('suspended');
  expect((await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('root')).send({ reason: 'x' })).status).toBe(409);
  expect((await request(app).post('/api/platform/tenants/kiosco/reactivate').set(as('root')).send({})).status).toBe(200);
  expect((await request(app).get('/api/tenants/kiosco/products').set(as('owner'))).status).toBe(200);
  expect((await request(app).post('/api/platform/tenants/kiosco/reactivate').set(as('root')).send({})).status).toBe(409);
});

it('el POS sigue sincronizando y los días suspendidos no se cobran', async () => {
  await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('root')).send({ reason: 'x' });
  const push = await pushSaleOn('2026-10-05'); // helper local: push de una venta con la key de la caja
  expect(push.status).toBe(200);
  expect(chargesFor('kiosco')).toEqual([]);
});

it('suspendedDays mira el día argentino', () => {
  systemDb.prepare("INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES ('s', 'kiosco', '2026-10-03T02:00:00.000Z', '2026-10-04T04:00:00.000Z', 'x', 'u')").run();
  // 02:00Z del 3 es el 2 argentino; 04:00Z del 4 es el 4 argentino
  expect([...suspendedDays(systemDb, 'kiosco', ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'])].sort())
    .toEqual(['2026-10-02', '2026-10-03', '2026-10-04']);
});

it('motivo obligatorio; una demo o un comercio inexistente no se suspenden; un owner no entra', async () => {
  expect((await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('root')).send({})).status).toBe(400);
  expect((await request(app).post('/api/platform/tenants/nada/suspend').set(as('root')).send({ reason: 'x' })).status).toBe(404);
  expect((await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('owner')).send({ reason: 'x' })).status).toBe(403);
});
```

- [ ] **Paso 2:** `pnpm vitest run test/tenant-suspension.test.ts` → FALLA (404 en las rutas).
- [ ] **Paso 3: `suspensions.ts`**:

```ts
import type { DatabaseSync } from 'node:sqlite';

const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** El período abierto de suspensión del comercio, si lo hay (#23). */
export function currentSuspension(db: DatabaseSync, tenantId: string): { since: string; reason: string } | null {
  const row = db
    .prepare('SELECT from_at, reason FROM tenant_suspensions WHERE tenant_id = ? AND to_at IS NULL ORDER BY from_at DESC LIMIT 1')
    .get(tenantId) as { from_at: string; reason: string } | undefined;
  return row === undefined ? null : { since: row.from_at, reason: row.reason };
}

export function isSuspended(db: DatabaseSync, tenantId: string): boolean {
  return currentSuspension(db, tenantId) !== null;
}

/** Los días argentinos de `days` que tocan algún período de suspensión: no se cobran (#23). */
export function suspendedDays(db: DatabaseSync, tenantId: string, days: readonly string[]): Set<string> {
  const periods = db
    .prepare('SELECT from_at, to_at FROM tenant_suspensions WHERE tenant_id = ?')
    .all(tenantId) as { from_at: string; to_at: string | null }[];
  const out = new Set<string>();
  for (const day of days) {
    const start = Date.parse(`${day}T00:00:00.000Z`) + OFFSET_MS;
    const end = start + DAY_MS;
    if (periods.some((p) => Date.parse(p.from_at) < end && (p.to_at === null || Date.parse(p.to_at) > start))) out.add(day);
  }
  return out;
}
```

- [ ] **Paso 4: `SuspensionService`** (de sistema, con `db`, `audit` y `now`):

```ts
/** Suspender y reactivar comercios (#23): corta el admin, el POS sigue y no se cobran esos días. */
export class SuspensionService {
  private db: DatabaseSync;
  private audit: AuditLog;
  private now: () => Date;
  constructor(deps: { db: DatabaseSync; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  suspend(p: { tenantId: string; reason: string; actorUserId: string }): void {
    this.requireRealTenant(p.tenantId);
    if (isSuspended(this.db, p.tenantId)) throw new DomainError(409, 'El comercio ya está suspendido');
    const at = this.now().toISOString();
    this.db.prepare('INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES (?, ?, ?, NULL, ?, ?)')
      .run(`sus_${randomUUID()}`, p.tenantId, at, p.reason, p.actorUserId);
    this.db.prepare("UPDATE tenants SET status = 'suspended' WHERE id = ?").run(p.tenantId);
    this.audit.record({ actorUserId: p.actorUserId, tenantId: p.tenantId, action: 'tenant.suspended', details: { reason: p.reason } });
  }

  reactivate(p: { tenantId: string; actorUserId: string }): void {
    this.requireRealTenant(p.tenantId);
    if (!isSuspended(this.db, p.tenantId)) throw new DomainError(409, 'El comercio no está suspendido');
    const at = this.now().toISOString();
    this.db.prepare('UPDATE tenant_suspensions SET to_at = ? WHERE tenant_id = ? AND to_at IS NULL').run(at, p.tenantId);
    this.db.prepare("UPDATE tenants SET status = 'active' WHERE id = ?").run(p.tenantId);
    this.audit.record({ actorUserId: p.actorUserId, tenantId: p.tenantId, action: 'tenant.reactivated' });
  }

  private requireRealTenant(tenantId: string): void {
    const row = this.db.prepare('SELECT 1 FROM tenants WHERE id = ? AND id NOT IN (SELECT tenant_id FROM demo_sessions)').get(tenantId);
    if (row === undefined) throw new DomainError(404, 'Comercio no encontrado');
  }
}
```

  Las dos escrituras van juntas: envolver cada método en `BEGIN`/`COMMIT` con `ROLLBACK` en el
  `catch`, como hace `BillingService` con sus escrituras (copiar su helper si tiene uno).

- [ ] **Paso 5: el bloqueo**, en `createTenantContextMiddleware`, después de resolver el rol:

```ts
// Comercio suspendido (#23): sus usuarios solo ven Uso y pagos, el estado de cobro y exportar
if (req.user.globalRole === 'user' && isSuspended(systemDb, tenantId) && !OPEN_WHEN_BLOCKED.test(tenantPath(req))) {
  res.status(403).json({ code: 'tenant-suspended', error: 'Este comercio está suspendido: escribile a soporte' });
  return;
}
```

  Mover `OPEN` y `tenantPath` de `billing-restriction-middleware.ts` a un módulo
  `src/server/middleware/tenant-path.ts` (`OPEN_WHEN_BLOCKED`, `tenantPath`) que usan los dos. El
  middleware recibe `systemDb` como parámetro nuevo (actualizar la llamada en `app.ts`).

- [ ] **Paso 6: el cargo.** En `BillingService.charge`, antes del bucle:

```ts
const skip = suspendedDays(this.db, p.tenantId, p.days);
for (const day of [...new Set(p.days)].filter((d) => !skip.has(d)).sort()) {
```

- [ ] **Paso 7: rutas** (`platform-admin-routes.ts`), montadas en `app.ts` después del router de
  cobro: `app.use('/api/platform', requireAdmin, createPlatformAdminRoutes({ ... }))`.

```ts
const reasonSchema = z.object({ reason: z.string().trim().min(1, 'Falta el motivo').max(200) });

export type PlatformAdminDeps = { suspensions: SuspensionService };

/** Panel de plataforma (#23, M7a), para root y soporte. Lo de cobro sigue en platform-routes.ts. */
export function createPlatformAdminRoutes(deps: PlatformAdminDeps): Router {
  const router = Router();
  const staff = requirePlatformRole('root', 'support');
  const actorOf = (req: AuthenticatedAdminRequest): string => req.user?.id ?? '';

  router.post('/tenants/:tenantId/suspend', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = reasonSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      deps.suspensions.suspend({ tenantId: req.params['tenantId'] ?? '', reason: parsed.data.reason, actorUserId: actorOf(req) });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/tenants/:tenantId/reactivate', staff, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      deps.suspensions.reactivate({ tenantId: req.params['tenantId'] ?? '', actorUserId: actorOf(req) });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

  `suspensionServiceDef` en `di/container.ts`, como `billingServiceDef` (singleton de sistema con `clockDef`).

- [ ] **Paso 8:** `pnpm vitest run test/tenant-suspension.test.ts test/billing-restriction.test.ts test/billing-charges.test.ts test/permissions-api.test.ts` → PASA.
- [ ] **Paso 9:** suite completa y commit `feat: suspender y reactivar comercios desde la plataforma (#23)`.

---

### Tarea 4: desactivar usuarios y restablecer desde la plataforma

**Archivos:**
- Crear: `src/server/platform/user-status-service.ts`
- Modificar: `src/server/auth/auth-service.ts` (`login`, `validateSession`), `src/server/users/password-reset-service.ts`
  (`createFromPlatform`, `tenant_id` nullable), `src/server/routes/platform-admin-routes.ts`,
  `src/server/di/container.ts`, `src/server/app.ts`
- Test: `test/platform-users-api.test.ts`

**Produce:**
- `UserStatusService.setStatus({ actor: { id: string; globalRole: UserRole }, targetUserId: string, status: 'active' | 'disabled' }): void`
- `PasswordResetService.createFromPlatform({ actorUserId, targetUserId }): { token: string; expiresAt: string }`
- Rutas `POST /api/platform/users/:userId/disable|enable` y `POST /api/platform/users/:userId/password-reset`.

- [ ] **Paso 1: tests que fallan** (`test/platform-users-api.test.ts`, mismo armado que
  `platform-api.test.ts`, más un segundo soporte `soporte2@x.com`):

```ts
it('soporte desactiva a un usuario: no puede entrar, sus sesiones se cierran y reactivarlo lo deja entrar', async () => {
  expect((await request(app).post(`/api/platform/users/${ownerId}/disable`).set(as('support')).send({})).status).toBe(200);
  expect((await request(app).get('/api/auth/me').set(as('owner'))).status).toBe(401);
  const login = await request(app).post('/api/auth/login').send({ email: 'owner@x.com', password: 'password123' });
  expect(login.status).toBe(401);
  expect(login.body).toEqual({ error: 'Cuenta desactivada: escribile a soporte' });
  expect((await request(app).post(`/api/platform/users/${ownerId}/enable`).set(as('support')).send({})).status).toBe(200);
  expect((await request(app).post('/api/auth/login').send({ email: 'owner@x.com', password: 'password123' })).status).toBe(200);
  expect(actions()).toEqual(['user.disabled', 'user.enabled']);
});

it('nadie desactiva a root ni a sí mismo; soporte no toca a soporte; root sí', async () => {
  expect((await request(app).post(`/api/platform/users/${rootId}/disable`).set(as('support')).send({})).status).toBe(403);
  expect((await request(app).post(`/api/platform/users/${supportId}/disable`).set(as('support')).send({})).status).toBe(403);
  expect((await request(app).post(`/api/platform/users/${support2Id}/disable`).set(as('support')).send({})).status).toBe(403);
  expect((await request(app).post(`/api/platform/users/${support2Id}/disable`).set(as('root')).send({})).status).toBe(200);
  expect((await request(app).post(`/api/platform/users/${rootId}/disable`).set(as('root')).send({})).status).toBe(403);
  expect((await request(app).post('/api/platform/users/nadie/disable').set(as('root')).send({})).status).toBe(404);
});

it('root y soporte generan un link de restablecimiento sin comercio para un usuario, no para el equipo', async () => {
  const res = await request(app).post(`/api/platform/users/${ownerId}/password-reset`).set(as('support')).send({});
  expect(res.status).toBe(201);
  const { token } = res.body as { token: string };
  expect((await request(app).post('/api/password-resets/complete').send({ token, password: 'nueva-clave-1' })).status).toBe(200);
  expect(systemDb.prepare("SELECT tenant_id FROM audit_log WHERE action = 'password.reset'").all()).toEqual([{ tenant_id: null }]);
  expect((await request(app).post(`/api/platform/users/${support2Id}/password-reset`).set(as('root')).send({})).status).toBe(403);
});

it('un owner no usa estas rutas', async () => {
  expect((await request(app).post(`/api/platform/users/${support2Id}/disable`).set(as('owner')).send({})).status).toBe(403);
});
```

- [ ] **Paso 2:** `pnpm vitest run test/platform-users-api.test.ts` → FALLA.
- [ ] **Paso 3: `AuthService`.** `login` lee `status`; si es `disabled`, `throw new Error('Cuenta desactivada: escribile a soporte')`
  (la ruta ya responde 401 con el mensaje). `validateSession` suma `AND u.status = 'active'` al `WHERE`.
- [ ] **Paso 4: `UserStatusService`** (de sistema; `db`, `auth`, `audit`):

```ts
/** Desactivar y reactivar cuentas desde la plataforma (#23). */
export class UserStatusService {
  // campos y constructor como el resto de los servicios de sistema

  setStatus(p: { actor: { id: string; globalRole: UserRole }; targetUserId: string; status: 'active' | 'disabled' }): void {
    const target = this.db.prepare('SELECT global_role, status FROM users WHERE id = ?').get(p.targetUserId) as
      | { global_role: string; status: string }
      | undefined;
    if (target === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (p.targetUserId === p.actor.id) throw new DomainError(403, 'No podés cambiar tu propia cuenta');
    if (target.global_role === 'root') throw new DomainError(403, 'Root no se desactiva');
    if (target.global_role === 'support' && p.actor.globalRole !== 'root') throw new DomainError(403, 'Solo root maneja al equipo de soporte');
    if (target.status === p.status) return;
    this.db.prepare('UPDATE users SET status = ? WHERE id = ?').run(p.status, p.targetUserId);
    if (p.status === 'disabled') this.auth.revokeSessions(p.targetUserId);
    this.audit.record({
      actorUserId: p.actor.id,
      tenantId: null,
      action: p.status === 'disabled' ? 'user.disabled' : 'user.enabled',
      targetUserId: p.targetUserId,
    });
  }
}
```

- [ ] **Paso 5: `PasswordResetService.createFromPlatform`.** Extraer de `create` la parte que inserta y
  audita a un `private issue(targetUserId, actorUserId, tenantId: string | null)`; `create` la llama
  con el comercio y `createFromPlatform` con `null`, después de verificar que el usuario existe (404)
  y que es `global_role = 'user'` (si no, 403 "El equipo de soporte restablece su contraseña con root").
  `ResetRow.tenant_id` pasa a `string | null`.
- [ ] **Paso 6: rutas** en `platform-admin-routes.ts` (`PlatformAdminDeps` suma `userStatus` y `resets`):

```ts
for (const [path, status] of [['disable', 'disabled'], ['enable', 'active']] as const) {
  router.post(`/users/:userId/${path}`, staff, (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      if (req.user === undefined) throw new DomainError(401, 'No autorizado');
      deps.userStatus.setStatus({ actor: { id: req.user.id, globalRole: req.user.globalRole }, targetUserId: req.params['userId'] ?? '', status });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });
}

router.post('/users/:userId/password-reset', staff, (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    res.status(201).json(deps.resets.createFromPlatform({ actorUserId: actorOf(req), targetUserId: req.params['userId'] ?? '' }));
  } catch (err: unknown) {
    sendError(res, err, 500);
  }
});
```

- [ ] **Paso 7:** `pnpm vitest run test/platform-users-api.test.ts test/passwords-api.test.ts test/auth-and-tenants.test.ts` → PASA.
- [ ] **Paso 8:** suite completa y commit `feat: desactivar usuarios y restablecer contraseñas desde la plataforma (#23)`.

---

### Tarea 5: invitar a soporte

**Archivos:**
- Crear: `src/server/platform/staff-invitation-service.ts`
- Modificar: `src/server/routes/link-routes.ts` (`createStaffInvitationLinkRoutes`),
  `src/server/routes/platform-admin-routes.ts`, `src/server/di/container.ts`, `src/server/app.ts`
  (`app.use('/api/staff-invitations', createStaffInvitationLinkRoutes(staffInvitations, authLimit))`)
- Test: `test/staff-invitations-api.test.ts`

**Produce:**
- `StaffInvitationService`: `create({ actorUserId, email }): { id; token; expiresAt }`,
  `revoke({ actorUserId, invitationId })`, `listPending(): StaffInvitationItem[]`,
  `lookup(token): StaffInvitationInfo`, `accept({ token, password, name? }): { token: string; user: UserSession }`.
- Tipos en `src/shared/platform-types.ts`:

```ts
export type StaffInvitationItem = { id: string; email: string; createdAt: string; expiresAt: string; invitedByName: string };
export type StaffInvitationInfo = { email: string; invitedByName: string; accountExists: boolean; expiresAt: string };
```

- [ ] **Paso 1: tests que fallan** (`test/staff-invitations-api.test.ts`):

```ts
it('root invita a soporte; con un mail nuevo nace una cuenta de soporte con sesión', async () => {
  const inv = await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email: 'Nueva@X.com' });
  expect(inv.status).toBe(201);
  const { token } = inv.body as { token: string };
  const info = await request(app).post('/api/staff-invitations/lookup').send({ token });
  expect(info.body).toMatchObject({ email: 'nueva@x.com', invitedByName: 'Root', accountExists: false });
  const acc = await request(app).post('/api/staff-invitations/accept').send({ token, password: 'clave-nueva-1', name: 'Ana' });
  expect(acc.status).toBe(200);
  expect((acc.body as { user: { globalRole: string } }).user.globalRole).toBe('support');
  expect((await request(app).post('/api/staff-invitations/accept').send({ token, password: 'clave-nueva-1', name: 'Ana' })).status).toBe(410);
  expect(actions()).toEqual(['staff.invited', 'staff.joined']);
});

it('una cuenta existente sin comercios se promueve con su contraseña; con comercios, 409', async () => {
  const sin = authService.createUser({ email: 'libre@x.com', password: 'password123', name: 'Libre' });
  const t1 = ((await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email: 'libre@x.com' })).body as { token: string }).token;
  expect((await request(app).post('/api/staff-invitations/accept').send({ token: t1, password: 'mala' })).status).toBe(401);
  expect((await request(app).post('/api/staff-invitations/accept').send({ token: t1, password: 'password123' })).status).toBe(200);
  expect(systemDb.prepare('SELECT global_role FROM users WHERE id = ?').get(sin.user.id)).toEqual({ global_role: 'support' });

  const t2 = ((await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email: 'owner@x.com' })).body as { token: string }).token;
  const conComercio = await request(app).post('/api/staff-invitations/accept').send({ token: t2, password: 'password123' });
  expect(conComercio.status).toBe(409);
  expect(conComercio.body).toEqual({ error: 'Esa cuenta es de un comercio: usá otro mail' });
});

it('solo root invita, lista y revoca', async () => {
  expect((await request(app).post('/api/platform/staff/invitations').set(as('support')).send({ email: 'a@x.com' })).status).toBe(403);
  const inv = await request(app).post('/api/platform/staff/invitations').set(as('root')).send({ email: 'a@x.com' });
  const list = await request(app).get('/api/platform/staff').set(as('root'));
  expect((list.body as { invitations: { email: string }[] }).invitations.map((i) => i.email)).toEqual(['a@x.com']);
  expect((await request(app).delete(`/api/platform/staff/invitations/${(inv.body as { id: string }).id}`).set(as('root'))).status).toBe(200);
  expect((await request(app).post('/api/staff-invitations/lookup').send({ token: (inv.body as { token: string }).token })).status).toBe(410);
});

it('vence a las 48 h', async () => { /* reloj inyectado: crear, avanzar 48 h + 1 ms, lookup → 410 */ });
```

  Para el de vencimiento, armar la app con un reloj mutable (`let now = new Date(...)`;
  `createApp({ ..., now: () => now })`), como `test/invitations-api.test.ts` si ya lo hace.

- [ ] **Paso 2:** `pnpm vitest run test/staff-invitations-api.test.ts` → FALLA.
- [ ] **Paso 3: `StaffInvitationService`**, siguiendo `InvitationService` (mismo `generateLinkToken`,
  `hashLinkToken`, `LINK_TTL_MS` y `LINK_GONE_MESSAGE`; una invitación nueva al mismo mail revoca la
  pendiente). Diferencias:
  - `create`: el mail ya del equipo (`global_role` `root` o `support`) → 409 "Esa cuenta ya es del equipo".
  - `accept` con cuenta existente: si tiene alguna fila en `memberships` → 409 "Esa cuenta es de un
    comercio: usá otro mail"; contraseña incorrecta → 401 "Contraseña incorrecta"; si no,
    `UPDATE users SET global_role = 'support'` y una sesión nueva (`auth.createSession`).
  - `accept` con mail nuevo: nombre de al menos 2 caracteres; `auth.createUser(...)` y después
    `UPDATE users SET global_role = 'support'`; devolver el `user` con `globalRole: 'support'`.
  - Auditoría con `tenantId: null`: `staff.invited` (`details: { email }`), `staff.invitation_revoked`,
    `staff.joined` (`actorUserId` = quien acepta).
- [ ] **Paso 4: rutas.** En `link-routes.ts`, `createStaffInvitationLinkRoutes` igual que
  `createInvitationLinkRoutes` (con `passwordSchema` para cuentas nuevas). En `platform-admin-routes.ts`
  (`rootOnly = requirePlatformRole('root')`):
  - `GET /staff` → `{ members: StaffMemberItem[], invitations: StaffInvitationItem[] }`. Esta tarea crea
    `PlatformQueryService` con solo `listStaff()`
    (`SELECT id, name, email, global_role, status FROM users WHERE global_role IN ('root','support') ORDER BY created_at`);
    la Tarea 6 le suma el resto. `StaffMemberItem` se declara ya en `platform-types.ts` (forma en la Tarea 6).
  - `POST /staff/invitations` `{ email }` (`z.string().trim().pipe(z.email('Email inválido'))`) → 201.
  - `DELETE /staff/invitations/:invitationId` → 200.
- [ ] **Paso 5:** `pnpm vitest run test/staff-invitations-api.test.ts test/invitations-api.test.ts` → PASA.
- [ ] **Paso 6:** suite completa y commit `feat: root invita a soporte por link (#23)`.

---

### Tarea 6: listados del panel y tabla de permisos de plataforma

**Archivos:**
- Crear: `src/server/platform/platform-query-service.ts`
- Modificar: `src/server/audit/audit-log.ts` (`listPlatform`), `src/server/routes/platform-admin-routes.ts`,
  `src/shared/platform-types.ts`, `src/server/di/container.ts`
- Test: `test/platform-panel-api.test.ts`, `test/platform-permissions.test.ts`

**Produce** (en `src/shared/platform-types.ts`):

```ts
import type { BillingState, BillingSummary, GiftItem } from './credits-types.ts';
import type { TenantRole } from './permissions.ts';

export type TenantStatus = 'active' | 'maintenance' | 'suspended';
export type PlatformTenantItem = {
  id: string; slug: string; name: string; status: TenantStatus; businessType: string | null;
  holder: { id: string; name: string } | null; billingState: BillingState; members: number; createdAt: string;
};
export type PlatformMemberItem = { userId: string; name: string; email: string; role: TenantRole; status: 'active' | 'disabled' };
export type PlatformTenantDetail = {
  tenant: PlatformTenantItem;
  suspension: { since: string; reason: string } | null;
  credits: BillingSummary;
  gifts: GiftItem[];
  members: PlatformMemberItem[];
};
export type PlatformUserItem = {
  id: string; name: string; email: string; whatsapp: string | null; globalRole: 'root' | 'support' | 'user';
  status: 'active' | 'disabled'; createdAt: string;
  tenants: Array<{ id: string; slug: string; name: string; role: TenantRole; status: 'active' | 'disabled' }>;
};
export type StaffMemberItem = { id: string; name: string; email: string; globalRole: 'root' | 'support'; status: 'active' | 'disabled' };
export type PlatformAuditItem = {
  id: string; at: string; action: string; actorName: string; targetName: string | null;
  tenantId: string | null; tenantName: string | null; details: Record<string, unknown>;
};
```

- `PlatformQueryService` (de sistema; `db`, `billing`, `members: MembershipService`):
  `listTenants(q?: string): PlatformTenantItem[]`, `tenantDetail(tenantId): PlatformTenantDetail` (404),
  `listUsers(q?: string): PlatformUserItem[]`, `listStaff(): StaffMemberItem[]`.
- `AuditLog.listPlatform(p: { tenantId?: string | undefined; limit?: number }): PlatformAuditItem[]`.
- Rutas: `GET /tenants?q=`, `GET /tenants/:tenantId`, `GET /users?q=`, `GET /audit?tenantId=`.

- [ ] **Paso 1: tests que fallan** (`test/platform-panel-api.test.ts`): con dos comercios (`kiosco`
  de owner, `ferre` de otro owner) y una demo creada con `demoSessions`:

```ts
it('lista los comercios reales con titular, estado, estado de cobro y miembros, y filtra por texto', async () => {
  const res = await request(app).get('/api/platform/tenants').set(as('support'));
  expect(res.status).toBe(200);
  const items = res.body as PlatformTenantItem[];
  expect(items.map((t) => t.slug).sort()).toEqual(['ferre', 'kiosco']); // sin demos
  expect(items.find((t) => t.slug === 'kiosco')).toMatchObject({ holder: { name: 'Owner' }, status: 'active', billingState: 'ok', members: 1 });
  const filtered = await request(app).get('/api/platform/tenants?q=FERR').set(as('support'));
  expect((filtered.body as PlatformTenantItem[]).map((t) => t.slug)).toEqual(['ferre']);
});

it('el detalle trae suspensión, créditos, bonos y miembros', async () => {
  await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('root')).send({ reason: 'Prueba' });
  const res = await request(app).get('/api/platform/tenants/kiosco').set(as('support'));
  expect(res.body).toMatchObject({
    tenant: { slug: 'kiosco', status: 'suspended' },
    suspension: { reason: 'Prueba' },
    members: [{ name: 'Owner', role: 'owner', status: 'active' }],
  });
  expect((res.body as PlatformTenantDetail).credits).toHaveProperty('paidBalance');
  expect((await request(app).get('/api/platform/tenants/nada').set(as('support'))).status).toBe(404);
});

it('lista usuarios con sus comercios y busca por nombre o mail', async () => {
  const res = await request(app).get('/api/platform/users?q=owner@x').set(as('support'));
  expect(res.body).toMatchObject([{ email: 'owner@x.com', globalRole: 'user', status: 'active', tenants: [{ slug: 'kiosco', role: 'owner' }] }]);
});

it('el registro de plataforma muestra todo y filtra por comercio', async () => {
  await request(app).post('/api/platform/tenants/kiosco/suspend').set(as('root')).send({ reason: 'x' });
  await request(app).post(`/api/platform/users/${otherOwnerId}/disable`).set(as('root')).send({});
  const all = (await request(app).get('/api/platform/audit').set(as('support'))).body as PlatformAuditItem[];
  expect(all.map((a) => a.action)).toEqual(expect.arrayContaining(['tenant.suspended', 'user.disabled']));
  const kiosco = (await request(app).get('/api/platform/audit?tenantId=kiosco').set(as('support'))).body as PlatformAuditItem[];
  expect(kiosco.every((a) => a.tenantId === 'kiosco')).toBe(true);
  expect(kiosco[0]).toMatchObject({ action: 'tenant.suspended', actorName: 'Root', tenantName: 'Kiosco' });
});
```

  Y `test/platform-permissions.test.ts`, con la tabla de **todas** las rutas de `/api/platform` (las
  de cobro y las nuevas) y el rol mínimo; para cada una, un owner recibe 403, soporte 403 en las de
  root, y la cantidad de rutas registradas en los dos routers coincide con la tabla (leer
  `router.stack` como hace `test/permissions-api.test.ts` con la cadena del comercio):

```ts
const RUTAS: Record<string, 'root' | 'staff'> = {
  'POST /tenants/:tenantId/payments': 'staff',
  'POST /tenants/:tenantId/gift-credits': 'staff',
  'DELETE /tenants/:tenantId/gift-credits/:creditId': 'staff',
  'POST /tenants/:tenantId/grace': 'staff',
  'POST /tenants/:tenantId/refunds': 'root',
  'PUT /tenants/:tenantId/holder': 'staff',
  'POST /payments/import': 'staff',
  'GET /payments': 'staff',
  'GET /settings': 'staff',
  'PUT /settings': 'root',
  'GET /tenants': 'staff',
  'GET /tenants/:tenantId': 'staff',
  'POST /tenants/:tenantId/suspend': 'staff',
  'POST /tenants/:tenantId/reactivate': 'staff',
  'GET /users': 'staff',
  'POST /users/:userId/disable': 'staff',
  'POST /users/:userId/enable': 'staff',
  'POST /users/:userId/password-reset': 'staff',
  'GET /staff': 'root',
  'POST /staff/invitations': 'root',
  'DELETE /staff/invitations/:invitationId': 'root',
  'GET /audit': 'staff',
};
```

- [ ] **Paso 2:** `pnpm vitest run test/platform-panel-api.test.ts test/platform-permissions.test.ts` → FALLA.
- [ ] **Paso 3: `PlatformQueryService`.**
  - `listTenants`: `SELECT t.id, t.slug, t.name, t.status, t.business_type, t.created_at, t.holder_user_id, h.name AS holder_name,
    (SELECT COUNT(*) FROM memberships m WHERE m.tenant_id = t.id AND m.status = 'active') AS members
    FROM tenants t LEFT JOIN users h ON h.id = t.holder_user_id
    WHERE t.id NOT IN (SELECT tenant_id FROM demo_sessions)
      AND (? = '' OR lower(t.name) LIKE ? OR lower(t.slug) LIKE ?)
    ORDER BY t.created_at DESC`, con `%q%` en minúsculas; `billingState` = `billing.summary(id).state`.
  - `tenantDetail`: el ítem de `listTenants` filtrado por id (404 si no está), `currentSuspension`,
    `billing.summary`, `billing.listGifts`, `members.listMembers` sin `joinedAt`.
  - `listUsers`: usuarios (todos los roles) filtrados por `lower(name)` o `lower(email)`, con sus
    membresías (una consulta por las membresías de los ids listados, agrupadas en memoria), `LIMIT 200`.
  - `listStaff`: la consulta de la Tarea 5, con `status`.
- [ ] **Paso 4: `AuditLog.listPlatform`**: la consulta de `listForTenant` más `LEFT JOIN tenants t ON t.id = a.tenant_id`,
  `WHERE (? IS NULL OR a.tenant_id = ?)`, `ORDER BY a.at DESC LIMIT ?` (200 por defecto).
- [ ] **Paso 5: rutas** (staff): `GET /tenants`, `GET /tenants/:tenantId`, `GET /users`, `GET /audit`;
  `q` y `tenantId` desde `req.query` validados con `z.string().trim().max(100).optional()`; `GET /staff`
  pasa a `listStaff()`.
- [ ] **Paso 6:** las dos suites → PASA. Suite completa y commit
  `feat: listados de comercios, usuarios, equipo y registro de la plataforma (#23)`.

---

### Tarea 7: rutas del panel en el cliente

**Archivos:**
- Modificar: `src/client/routing/admin-routes.ts`, `src/client/state/platform-state.ts` (`platformTabSignal`),
  `src/client/components/platform/PlatformView.tsx`, `test/route-state.test.ts` (la ruta de plataforma)
- Test: `test/admin-routes.test.ts`

**Produce:**

```ts
export const PLATFORM_TABS = [
  { id: 'tenants', slug: '' },
  { id: 'users', slug: 'usuarios' },
  { id: 'payments', slug: 'cobranzas' },
  { id: 'staff', slug: 'soporte' },
  { id: 'audit', slug: 'registro' },
  { id: 'settings', slug: 'configuracion' },
] as const;

export type PlatformRoute = { kind: 'plataforma'; tab: PlatformTabId; tenantSlug: string | null; params: Params };
export function platformUrl(tab: PlatformTabId, params?: Params): string;
export function platformTenantUrl(slug: string): string; // '/plataforma/comercios/<slug>'
```

  Filtros: `tenants` y `users` con `q` (texto); `audit` con `comercio` (slug). Lectores `text` ya
  existentes; los demás valores se descartan.

- [ ] **Paso 1: tests que fallan** en `test/admin-routes.test.ts`:

```ts
it('plataforma: Comercios por omisión, solapas, detalle de comercio y filtros (#23)', () => {
  expect(parseLocation('/plataforma', '')).toEqual({ kind: 'plataforma', tab: 'tenants', tenantSlug: null, params: {} });
  expect(parseLocation('/plataforma/cobranzas', '')).toMatchObject({ tab: 'payments' });
  expect(parseLocation('/plataforma/comercios/kiosco-x', '')).toEqual({ kind: 'plataforma', tab: 'tenants', tenantSlug: 'kiosco-x', params: {} });
  expect(parseLocation('/plataforma/usuarios', '?q=ana&x=1')).toMatchObject({ tab: 'users', params: { q: 'ana' } });
  expect(parseLocation('/plataforma/registro', '?comercio=kiosco')).toMatchObject({ tab: 'audit', params: { comercio: 'kiosco' } });
  expect(buildUrl({ kind: 'plataforma', tab: 'tenants', tenantSlug: 'kiosco-x', params: {} })).toBe('/plataforma/comercios/kiosco-x');
  expect(platformUrl('users', { q: 'ana' })).toBe('/plataforma/usuarios?q=ana');
  expect(parseLocation('/plataforma/nada', '')).toMatchObject({ tab: 'tenants' });
});
```

  Y adaptar el test de ida y vuelta de solapas de plataforma y los `buildUrl({ kind: 'plataforma', tab })`
  existentes (`admin-routes.test.ts:32,46`, `route-state.test.ts:52`) a la forma nueva.

- [ ] **Paso 2:** `pnpm vitest run test/admin-routes.test.ts test/route-state.test.ts test/tabs-route.test.ts` → FALLA.
- [ ] **Paso 3: implementación.** En `parseLocation`:

```ts
if (first === 'plataforma') {
  if (second === 'comercios' && third !== undefined) return { kind: 'plataforma', tab: 'tenants', tenantSlug: decodeSlug(third), params: {} };
  const tab = PLATFORM_TABS.find((t) => t.slug !== '' && t.slug === second)?.id ?? 'tenants';
  return { kind: 'plataforma', tab, tenantSlug: null, params: platformParams(tab, readSearch(search)) };
}
```

  con `platformParams(tab, p)`: `{ q }` para `tenants`/`users`, `{ comercio }` para `audit`, nada para
  el resto (valores con `trim()`, vacíos descartados). `buildUrl` para `plataforma`: con `tenantSlug`,
  `/plataforma/comercios/<encodeURIComponent(slug)>`; si no, la solapa y la query canónica.
  `platformTabSignal` cae en `'tenants'`. `PlatformView` arma los links con `platformUrl(t.id)`.
- [ ] **Paso 4:** los tests de rutas → PASA; `pnpm typecheck` muestra cada `kind: 'plataforma'` que
  falta adaptar (también `setFilters`/`goTo` si construyen rutas de plataforma).
- [ ] **Paso 5:** suite completa, `pnpm build` y commit `feat: solapas, detalle y filtros de /plataforma en la URL (#23)`.

---

### Tarea 8: Comercios y su detalle, con la barra de cobro mudada

**Archivos:**
- Crear: `src/client/state/platform-panel-state.ts`, `src/client/components/platform/TenantsTab.tsx`,
  `src/client/components/platform/TenantDetailView.tsx`
- Modificar: `src/client/state/platform-state.ts` (acciones con `tenantId` explícito; `fetchOwners`
  desde el detalle), `src/client/components/credits/PlatformActionsBar.tsx` (recibe `tenantId`),
  `src/client/components/credits/CreditsView.tsx` (sin barra ni anular bono),
  `src/client/state/query-keys.ts` (`platformKey` acepta `'tenants' | 'tenant' | 'users' | 'staff' | 'audit'` con parámetros),
  `src/client/components/platform/PlatformView.tsx`
- Test: `test/platform-panel-client.test.ts`, adaptar `test/platform-client.test.ts` y `test/credits-client.test.ts`

**Produce** (`platform-panel-state.ts`):
- `platformTenantsSignal: ReadonlySignal<PlatformTenantItem[]>`, `platformTenantDetailSignal: ReadonlySignal<PlatformTenantDetail | null>`,
  `suspendTenant(tenantId: string, reason: string): Promise<boolean>`, `reactivateTenant(tenantId: string): Promise<boolean>`.
- `platformKey(name, ...params)` → `['platform', name, ...params]` (la invalidación `'platform'` ya marca todo).

- [ ] **Paso 1: tests que fallan** (`test/platform-panel-client.test.ts`, con el `fetch` falso de
  `platform-client.test.ts` y `navigate`):

```ts
it('Comercios pide la lista con el filtro de la URL', async () => {
  navigate('/plataforma?q=kio');
  await vi.waitFor(() => { expect(gets()).toContain('/api/platform/tenants?q=kio'); });
});

it('el detalle pide su comercio y las acciones de cobro van a ese comercio', async () => {
  reply.body = detailFixture('kiosco-id', 'kiosco');
  navigate('/plataforma/comercios/kiosco');
  await vi.waitFor(() => { expect(platformTenantDetailSignal.value?.tenant.id).toBe('kiosco-id'); });
  await registerPayment('kiosco-id', { day: '2026-10-05', amount: 100 });
  expect(writes()).toContainEqual({ url: '/api/platform/tenants/kiosco-id/payments', method: 'POST', body: { day: '2026-10-05', amount: 100 } });
});

it('suspender pide motivo e invalida la plataforma', async () => {
  await suspendTenant('kiosco-id', 'Pedido');
  expect(writes()).toContainEqual({ url: '/api/platform/tenants/kiosco-id/suspend', method: 'POST', body: { reason: 'Pedido' } });
});
```

  El detalle se pide por slug: `GET /api/platform/tenants?q=<slug>` no sirve (es por texto). Agregar
  al servidor, en esta tarea, `GET /api/platform/tenants/by-slug/:slug` (fila en `platform-permissions`
  como `staff`, test en `platform-panel-api.test.ts`) que responde lo mismo que `GET /tenants/:tenantId`.

  En `credits-client.test.ts`/`platform-client.test.ts`: las acciones pasan a recibir `tenantId`;
  el test de `CreditsView` deja de esperar la barra para root.

- [ ] **Paso 2:** las suites → FALLA.
- [ ] **Paso 3: estado.** `platform-panel-state.ts` con dos `createSignalQuery`:
  - lista: `source` con clave `platformKey('tenants', q)` y `fn` a `/api/platform/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    `enabled` cuando la ruta es `plataforma`, solapa `tenants` y sin `tenantSlug`.
  - detalle: clave `platformKey('tenant', slug)`, `fn` a `/api/platform/tenants/by-slug/${encodeURIComponent(slug)}`,
    `enabled` con `tenantSlug !== null`.
  - `suspendTenant`/`reactivateTenant` con `apiFetch`, toast y `invalidateAfter('platform-changed')`.
  En `platform-state.ts`, `tenantAction(tenantId, path, …)` y cada acción toma `tenantId` primero;
  después de la acción, `invalidateAfter('platform-changed')` en lugar de `refreshCredits()`.
  `fetchOwners` desaparece: los owners salen de `detail.members` (filtrar `role === 'owner' && status === 'active'`).
- [ ] **Paso 4: vistas.**
  - `TenantsTab`: buscador (`setFilters`), tabla con nombre (link a `platformTenantUrl(slug)`), titular,
    estado (insignia "Suspendido"), estado de cobro con los textos de `CreditsBanner`, usuarios y alta (`formatDate`).
  - `TenantDetailView`: encabezado con nombre, estado y "Suspender" / "Reactivar" (un `Modal` con el
    motivo); las `StatCard` de saldo de `CreditsView` (extraer `CreditsStats({ credits })` a
    `components/credits/CreditsStats.tsx` y usarla en los dos lados); `PlatformActionsBar tenantId owners`;
    los bonos con "Anular" (`GiftVoidAction`); los miembros (nombre, mail, rol, estado). Link "← Comercios".
  - `PlatformView` muestra `TenantDetailView` si la ruta tiene `tenantSlug`; si no, la solapa.
  - `CreditsView` deja de usar `isRootOrSupportSignal` (sin barra y sin columna de acciones en bonos).
- [ ] **Paso 5:** suites → PASA; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
- [ ] **Paso 6:** commit `feat: comercios y detalle en la plataforma, con las acciones de cobro (#23)`.

---

### Tarea 9: Usuarios, Soporte, Registro y la invitación de soporte

**Archivos:**
- Crear: `src/client/components/platform/UsersTab.tsx`, `StaffTab.tsx`, `AuditTab.tsx`
- Modificar: `src/client/state/platform-panel-state.ts`, `src/client/state/link-pages-state.ts`,
  `src/client/components/links/InvitationView.tsx`, `src/client/state/users-state.ts` (`buildLinkUrl`
  suma `'staff-invitation'`), `src/client/components/platform/PlatformView.tsx`
- Test: `test/platform-panel-client.test.ts`, `test/link-pages.test.ts`

**Produce:**
- `platformUsersSignal`, `staffSignal` (`{ members, invitations }`), `platformAuditSignal`;
  `setUserStatus(userId, status)`, `createPlatformResetLink(user)`, `inviteStaff(email)`, `revokeStaffInvitation(id)`;
  el link listo reutiliza `linkReadySignal` de `users-state.ts` (mismo modal "Link listo" para copiar).
- `buildLinkUrl('staff-invitation', token, origin)` → `${origin}/invitacion#t=${token}&tipo=soporte`.

- [ ] **Paso 1: tests que fallan:**

```ts
it('Usuarios: desactivar, activar y link de restablecimiento', async () => {
  await setUserStatus('u1', 'disabled');
  await setUserStatus('u1', 'active');
  reply.body = { token: 'tok', expiresAt: '2026-10-07T00:00:00.000Z' };
  await createPlatformResetLink({ id: 'u1', email: 'a@x.com' });
  expect(writes().map((w) => w.url)).toEqual([
    '/api/platform/users/u1/disable', '/api/platform/users/u1/enable', '/api/platform/users/u1/password-reset',
  ]);
  expect(linkReadySignal.value?.url).toBe('http://localhost:4100/restablecer#t=tok');
});

it('Soporte: invitar arma el link con tipo=soporte', async () => {
  reply.body = { id: 'i1', token: 'tok', expiresAt: '2026-10-07T00:00:00.000Z' };
  await inviteStaff('ana@x.com');
  expect(linkReadySignal.value?.url).toBe('http://localhost:4100/invitacion#t=tok&tipo=soporte');
});

it('Registro pide con el filtro de comercio de la URL', async () => {
  navigate('/plataforma/registro?comercio=kiosco');
  await vi.waitFor(() => { expect(gets()).toContain('/api/platform/audit?tenantId=kiosco'); });
});
```

  (El registro filtra por **slug** en la URL y el servidor por id: `GET /audit` acepta `tenantSlug`
  además de `tenantId`. Sumarlo en el servidor con su test en `platform-panel-api.test.ts`, y el
  cliente pide `?tenantSlug=`. Ajustar la expectativa del test a `/api/platform/audit?tenantSlug=kiosco`.)

  En `test/link-pages.test.ts`:

```ts
it('una invitación de soporte consulta y acepta en /api/staff-invitations y entra a /plataforma', async () => {
  // hash '#t=tok&tipo=soporte' → lookup en 'staff-invitations/lookup'; aceptar → 'staff-invitations/accept',
  // adoptSession y navigate('/plataforma')
});
```

- [ ] **Paso 2:** suites → FALLA.
- [ ] **Paso 3: estado y link.** `readLinkKind(hash): 'tenant' | 'staff'` en `link-pages-state.ts`
  (`tipo=soporte` → `'staff'`), guardado en `linkKindSignal`; `loadInvitation` y `submitInvitation`
  eligen `invitations/…` o `staff-invitations/…`; al aceptar soporte, `navigate('/plataforma')` y no
  `rememberTenant`. `InvitationView` muestra "Te invitaron al equipo de soporte de mini contax" y no
  el comercio ni el rol cuando el tipo es `staff`.
- [ ] **Paso 4: vistas.**
  - `UsersTab`: buscador; tabla con nombre, mail, WhatsApp, comercios (`nombre · rol`, link al detalle),
    rol global (insignia "Soporte"/"Root") y estado; acciones "Desactivar"/"Activar" (con `Modal` de
    confirmación) y "Link de restablecimiento" (solo para `user`). Sin acciones sobre uno mismo ni root;
    sobre soporte, solo si quien mira es root.
  - `StaffTab` (solo root): el equipo con su estado y "Desactivar"/"Activar"; invitaciones pendientes
    con "Revocar"; "Invitar a soporte" (un `Modal` con el correo).
  - `AuditTab`: selector de comercio (de `platformTenantsSignal`) que hace `setFilters({ comercio })`;
    tabla con fecha (`formatDateTime`), comercio, quién, acción (etiquetas en
    `src/client/state/audit-labels.ts`: extraer las de Usuarios → Actividad y sumar las nuevas
    `tenant.suspended`: "Suspendió el comercio", `tenant.reactivated`: "Reactivó el comercio",
    `user.disabled`: "Desactivó la cuenta", `user.enabled`: "Reactivó la cuenta", `staff.invited`:
    "Invitó a soporte", `staff.invitation_revoked`: "Revocó una invitación de soporte", `staff.joined`:
    "Se sumó a soporte") y sobre quién.
  - `PlatformView`: las seis solapas (Soporte y Configuración solo para root); subtítulo "Comercios,
    usuarios, cobro y equipo de mini contax".
- [ ] **Paso 5:** suites → PASA; lint, typecheck, test y build.
- [ ] **Paso 6:** commit `feat: usuarios, soporte y registro en la plataforma (#23)`.

---

### Tarea 10: el comercio suspendido en el admin

**Archivos:**
- Crear: `src/client/components/shell/SuspendedNotice.tsx`
- Modificar: `src/client/components/shell/AppShell.tsx`
- Test: `test/app-shell-and-navigation.test.ts`

- [ ] **Paso 1: test que falla:** con `userTenantsSignal` = un comercio `status: 'suspended'` y usuario
  `globalRole: 'user'`, en `/admin/<slug>/catalogo` el shell renderiza "Este comercio está suspendido"
  y no el catálogo; en `/admin/<slug>/uso-y-pagos` renderiza Uso y pagos; con `globalRole: 'support'`
  renderiza el catálogo. (Seguir cómo el archivo ya renderiza el shell con `@testing-library/preact`
  o con `render` de preact; usar el mismo armado.)
- [ ] **Paso 2:** → FALLA.
- [ ] **Paso 3:** `SuspendedNotice`: tarjeta con "Este comercio está suspendido", "Escribile a soporte
  para reactivarlo. Tus cajas siguen vendiendo y sincronizando." y un link a Uso y pagos
  (`adminUrl(slug, 'credits')`). En `AppShell`, dentro de `<main>`: si `activeTenant?.status === 'suspended'`,
  el usuario es `globalRole === 'user'` y la sección activa no es `credits`, mostrar `SuspendedNotice`
  en lugar de `props.children`.
- [ ] **Paso 4:** → PASA; lint, typecheck, test y build.
- [ ] **Paso 5:** commit `feat: el admin muestra el comercio suspendido (#23)`.

---

### Tarea 11: e2e de la plataforma

**Archivos:**
- Crear: `e2e/platform.spec.ts`

- [ ] **Paso 1: el spec** (seed de desarrollo en la base descartable del e2e: `root@local.test`,
  contraseña `admin123`; comercio y owner nuevos por corrida, por `POST /api/alta`, como
  `roles-invitations.spec.ts`):

```ts
test('root invita a soporte; soporte suspende y reactiva un comercio y desactiva a su owner', async ({ page, request, browser }) => {
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', { data: { name: 'Owner Plat', email: `owner-plat-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Plat ${id}`, businessType: 'kiosco', whatsapp: '1155550000' } });
  const { token: ownerToken } = (await alta.json()) as { token: string };

  // Root invita a soporte desde el panel y copia el link
  const rootLogin = await request.post('/api/auth/login', { data: { email: 'root@local.test', password: 'admin123' } });
  const { token: rootToken } = (await rootLogin.json()) as { token: string };
  await page.addInitScript((t) => { window.localStorage.setItem('mini_erp_token', t); }, rootToken);
  await page.goto('/plataforma/soporte');
  await page.getByRole('button', { name: 'Invitar a soporte' }).click();
  await page.getByLabel('Correo').fill(`soporte-${id}@local.test`);
  await page.getByRole('button', { name: 'Crear link' }).click();
  const link = await page.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link).toContain('tipo=soporte');

  // Soporte acepta en otro contexto y cae en la plataforma
  const sup = await (await browser.newContext()).newPage();
  await sup.goto(link);
  await sup.getByLabel('Tu nombre').fill('Soporte E2E');
  await sup.getByLabel('Contraseña', { exact: true }).fill('clave-sop-12');
  await sup.getByLabel('Repetir contraseña').fill('clave-sop-12');
  await sup.getByRole('button', { name: 'Aceptar invitación' }).click();
  await expect(sup).toHaveURL(/\/plataforma$/);

  // Suspende el comercio desde su detalle
  await sup.getByPlaceholder('Buscar comercio').fill(`Plat ${id}`);
  await sup.getByRole('link', { name: `Kiosco Plat ${id}` }).click();
  await sup.getByRole('button', { name: 'Suspender' }).click();
  await sup.getByLabel('Motivo').fill('Prueba e2e');
  await sup.getByRole('button', { name: 'Suspender comercio' }).click();
  await expect(sup.getByText('Suspendido')).toBeVisible();

  // El owner ve "suspendido"
  const own = await (await browser.newContext()).newPage();
  await own.addInitScript((t) => { window.localStorage.setItem('mini_erp_token', t); }, ownerToken);
  await own.goto('/admin');
  await expect(own.getByText('Este comercio está suspendido')).toBeVisible();

  // Reactiva y el owner vuelve a ver su dashboard
  await sup.getByRole('button', { name: 'Reactivar' }).click();
  await own.reload();
  await expect(own.getByText('Este comercio está suspendido')).toHaveCount(0);

  // Desactiva al owner: su sesión se corta y no puede entrar
  await sup.goto(`/plataforma/usuarios?q=owner-plat-${id}`);
  await sup.getByRole('button', { name: 'Desactivar' }).click();
  await sup.getByRole('button', { name: 'Desactivar cuenta' }).click();
  const relogin = await request.post('/api/auth/login', { data: { email: `owner-plat-${id}@local.test`, password: 'clave-owner-1' } });
  expect(relogin.status()).toBe(401);
});
```

  Ajustar los textos de botones y etiquetas a los que quedaron en las Tareas 8 y 9 (son los mismos
  nombres si se siguieron).

- [ ] **Paso 2:** `pnpm test:e2e` → los specs anteriores y el nuevo en verde.
- [ ] **Paso 3:** commit `test: e2e de la plataforma: soporte, suspensión y usuarios desactivados (#23)`.

---

### Tarea 12: cierre de M7a

**Archivos:**
- Modificar: `AGENTS.md`, `package.json` (versión), y borrar este plan.

- [ ] **Paso 1: AGENTS.md.**
  - En "Arquitectura", un ítem **Plataforma** (#23, spec `docs/superpowers/specs/2026-10-04-m7-plataforma-design.md`):
    panel en `/plataforma` (Comercios con detalle y acciones de cobro, Usuarios, Cobranzas, Soporte y
    Configuración de root, Registro), servicios en `src/server/platform/`, rutas en
    `routes/platform-admin-routes.ts`, tabla de permisos en `test/platform-permissions.test.ts`.
  - Suspensión: `tenant_suspensions`, 403 `tenant-suspended` salvo lo abierto, POS igual, sin cargos de
    días suspendidos. Usuarios desactivados. Soporte por invitación (`staff_invitations`, `tipo=soporte`).
  - En Créditos: las acciones de plataforma están en el detalle del comercio, no en Uso y pagos.
  - `audit_log.impersonator_user_id` (desde M7b). Migración de sistema v7.
  - Estado: M7a hecha; M7b (#23) sigue.
- [ ] **Paso 2:** `pnpm version minor --no-git-tag-version` → 0.12.0.
- [ ] **Paso 3:** `git rm docs/superpowers/plans/2026-10-04-m7a-plataforma.md`.
- [ ] **Paso 4:** `pnpm lint && pnpm typecheck && pnpm test`, `pnpm build`, `pnpm test:e2e`, todo en verde.
- [ ] **Paso 5:** commit `docs: plataforma de M7a en AGENTS.md y versión 0.12.0 (#23)`.
- [ ] **Paso 6:** el informe final con la prueba manual en el navegador integrado, como lista para
  tildar, empezando por la carpeta del worktree y la rama. Con el OK del usuario, el PR (sin "Closes":
  "Parte 1 de #23"), merge commit.
