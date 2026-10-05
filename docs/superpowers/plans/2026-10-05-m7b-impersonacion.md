# M7b · Impersonación de usuario, #16 y pedidos de ayuda — plan de implementación

> **Para quien ejecuta:** con `superpowers:executing-plans`, **tarea por tarea en esta conversación** (nunca
> un subagente por tarea, AGENTS.md). Al terminar cada tarea: `pnpm lint && pnpm typecheck && pnpm test`
> en verde, commit, y **frenar** para que el usuario la revise. Los pasos usan `- [ ]`.

**Objetivo:** que soporte entre como un usuario (no como un comercio) en una pestaña propia, con una
sesión aparte que vence sola; que root y soporte dejen de ser miembros implícitos de todos los
comercios (#16); y que un usuario pida ayuda por WhatsApp con un link que soporte abre como él, en esa
pantalla, viendo después quién entró.

**Arquitectura:** la impersonación es una fila más de `sessions` (migración de sistema v8) con su
impersonador, la sesión padre, el comercio de entrada, el pedido de ayuda y el último uso. El
middleware de admin la resuelve: `req.user` es el usuario impersonado y `req.impersonator`, quien
impersona; `requireOwnSession` corta lo que no puede hacer y `auditActor(req)` lleva los dos nombres a
la auditoría. En el cliente, la pestaña que impersona guarda su sesión en `sessionStorage` (solo
`auth-state` lo toca) y nunca escribe `localStorage`; la sesión de soporte sigue en `localStorage`.

**Stack:** Express + `node:sqlite` + Hardwired (servidor), Preact + signals + TanStack Query (cliente),
Vitest y Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-04-m7-plataforma-design.md`](../specs/2026-10-04-m7-plataforma-design.md),
sección "M7b". Issues #23 y #16.

## Restricciones globales

- Todo en español: código nuevo, comentarios, mensajes, commits.
- TDD: el test primero, verlo fallar, lo mínimo para que pase, la suite entera en verde.
- `any` prohibido; `unknown` solo en fronteras, validado con Zod (desde `src/shared/zod.ts`).
- Sin parameter properties, sin `enum`, imports relativos con extensión `.ts`/`.tsx`.
- Opcionales: entradas `x?: T | undefined`; en resultados propios, la propiedad se omite.
- Cliente: solo signals, sin hooks; overlays por `Modal`/`Drawer`; fechas y horas por `src/client/format.ts`.
- La línea de base de las migraciones no se toca: el cambio de esquema va en la v8.
- Cada ruta nueva de `/api/tenants/:tenantId` va en `test/permissions-api.test.ts`; cada una de
  `/api/platform`, en `test/platform-permissions.test.ts`.
- Antes de cada commit: `pnpm lint && pnpm typecheck && pnpm test` (en Windows, desde PowerShell).
  `pnpm build` en las tareas que tocan el cliente; `pnpm test:e2e` en la 9 y en el cierre.
- Commits convencionales en español, en la rama `claude/m7-impersonacion`.

## Decisiones de detalle que la spec no fija (tomadas acá; se pueden discutir al revisar el plan)

1. **Logout en el servidor.** Hoy "Cerrar sesión" solo borra el token del navegador, y la spec dice que
   la impersonación muere con el logout de soporte. Se suma `POST /api/auth/logout`, que borra la
   sesión del token (si es una impersonación, la termina con `reason: 'exit'`); `signOut` lo llama.
2. **`POST /api/impersonations` recibe `tenantSlug`**, no `tenantId`: la pestaña nueva solo conoce el
   slug de su URL (`/plataforma/entrar?usuario=<id>&comercio=<slug>`).
3. **La pantalla del pedido** (`path`) se valida como una URL del admin **de ese comercio**
   (`/admin/<slug>[/...][?...]`, sin fragmento, hasta 300 caracteres), con una expresión regular en el
   servidor; el cliente la canoniza al abrirla. Así el link nunca lleva a otro origen.
4. **El WhatsApp de soporte llega al usuario por `GET /api/me/support-access`** (hoy solo lo ve quien
   tiene `credits.view`): "Pedir ayuda" es para los tres roles.
5. **El seed de desarrollo carga un WhatsApp de soporte de prueba** (`5491100000000`) si no hay uno:
   sin él, "Pedir ayuda" no aparece ni en la prueba manual ni en el e2e.
6. **La pestaña que impersona no muestra "Cerrar sesión" ni "Crear nuevo comercio…"**: tiene "Salir"
   en la franja.
7. **Accesos de los últimos 7 días**: salen de `audit_log` (`impersonation.started` con
   `target_user_id` del usuario); "por tu pedido" si trae `helpRequestId`. El texto es "Soporte (Ana)
   entró a las 10:32 por tu pedido" si fue hoy y "… entró el 03/10 a las 10:32 …" si no.

## Mapa de archivos

**Servidor — nuevos**
- `src/server/db/migrations/system/v8-impersonacion-y-ayuda.ts`: columnas de `sessions`, `help_requests`, `help_request_takes`.
- `src/server/impersonation/impersonation-service.ts`: empezar y terminar impersonaciones (a quién sí, a quién no, auditoría, toma de pedidos).
- `src/server/middleware/own-session-middleware.ts`: `requireOwnSession` y el texto del 403.
- `src/server/audit/audit-actor.ts`: `auditActor(req)`.
- `src/server/help/help-request-service.ts`: pedidos, tomas, lista del panel y accesos de soporte.
- `src/server/help/help-path.ts`: validación de la pantalla del pedido.
- `src/server/routes/impersonation-routes.ts`, `src/server/routes/help-routes.ts` (pedido desde el comercio), `src/server/routes/me-routes.ts`.
- `src/shared/help-types.ts`: tipos de pedidos y accesos.

**Servidor — modificados**
- `system.ts` (lista de migraciones), `auth/auth-service.ts` (reloj, auditoría, `resolveSession`, sesiones de impersonación, `listUserTenants` sin roles implícitos), `middleware/auth-middleware.ts`, `middleware/tenant-context-middleware.ts`, `middleware/billing-restriction-middleware.ts`, `middleware/platform-role-middleware.ts`, `users/membership-service.ts`, `users/invitation-service.ts`, `audit/audit-log.ts`, rutas de auth, alta, links, usuarios, cajas y plataforma, `di/container.ts`, `app.ts`, `db/dev-seed.ts`, `seeds/dev-fixtures.ts`, `shared/permissions.ts`, `shared/platform-types.ts`.

**Cliente — nuevos**
- `src/client/state/impersonation-state.ts`: entrar (`/plataforma/entrar`, `/ayuda/<id>`), salir, abrir la pestaña.
- `src/client/state/help-state.ts`: accesos de soporte, pedido de ayuda, textos.
- `src/client/components/shell/ImpersonationBar.tsx`, `src/client/components/shell/ImpersonationEndedView.tsx`, `src/client/components/platform/EnterView.tsx`, `src/client/components/help/HelpModal.tsx`, `src/client/components/platform/HelpRequestsTab.tsx`.

**Cliente — modificados**
- `state/auth-state.ts` (almacenamiento por pestaña), `routing/admin-routes.ts` (rutas `entrar`, `ayuda` y solapa Pedidos), `state/permissions-state.ts`, `state/suspension-state.ts`, `state/query-keys.ts`, `state/platform-panel-state.ts`, `state/users-state.ts`, `state/link-pages-state.ts`, `state/navigation-state.ts`, `App.tsx`, `shell/AppShell.tsx`, `shell/Header.tsx`, `shell/NoAccessView.tsx`, `settings/AccountSection.tsx`, `platform/PlatformView.tsx`, `platform/UsersTab.tsx`, `platform/TenantDetailView.tsx`, `platform/AuditTab.tsx`, `users/ActivityList.tsx`.
- Se borra `shell/ImpersonationModal.tsx`.

**Tests nuevos:** `test/system-migration-v8.test.ts`, `test/helpers/impersonate.ts`, `test/impersonation-api.test.ts`, `test/impersonation-rules.test.ts`, `test/help-requests-api.test.ts`, `test/tab-session.test.ts`, `test/impersonation-client.test.ts`, `test/help-client.test.ts`, `e2e/support-tabs.spec.ts`.

---

## Tarea 1: migración de sistema v8

**Archivos:**
- Crear: `src/server/db/migrations/system/v8-impersonacion-y-ayuda.ts`
- Modificar: `src/server/db/migrations/system.ts`
- Test: `test/system-migration-v8.test.ts`

**Interfaces:**
- Produce: `sessions.impersonator_user_id`, `parent_token`, `help_request_id`, `tenant_id`, `last_used_at` (todas `TEXT`, nulas en las sesiones propias); tablas `help_requests` y `help_request_takes`.

- [ ] **Paso 1: el test que falla**

```typescript
// test/system-migration-v8.test.ts
import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { SYSTEM_SCHEMA } from '../src/server/db/migrations/system.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

describe('migración de sistema v8 impersonación y ayuda (#23)', () => {
  it('suma la impersonación a las sesiones y los pedidos de ayuda sin perder datos', () => {
    const db = createDbAtVersion(SYSTEM_SCHEMA, 7);
    const at = '2026-10-05T12:00:00.000Z';
    db.prepare("INSERT INTO users (id, email, password_hash, name, global_role, created_at) VALUES ('u1', 'a@x.com', 'h', 'Ana', 'user', ?)").run(at);
    db.prepare("INSERT INTO tenants (id, slug, name, created_at, holder_user_id) VALUES ('k', 'k', 'Kiosco', ?, 'u1')").run(at);
    db.prepare("INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES ('tok', 'u1', ?, ?)").run(at, at);

    migrateDb(db, SYSTEM_SCHEMA);

    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 8 });
    expect(
      db.prepare('SELECT token, impersonator_user_id, parent_token, help_request_id, tenant_id, last_used_at FROM sessions').all(),
    ).toEqual([{ token: 'tok', impersonator_user_id: null, parent_token: null, help_request_id: null, tenant_id: null, last_used_at: null }]);
    db.prepare(
      "INSERT INTO help_requests (id, tenant_id, user_id, path, message, created_at, expires_at) VALUES ('h1', 'k', 'u1', '/admin/k/dashboard', 'Hola', ?, ?)",
    ).run(at, at);
    db.prepare("INSERT INTO help_request_takes (request_id, staff_user_id, at) VALUES ('h1', 'u1', ?)").run(at);
    expect(db.prepare('SELECT id, closed_at FROM help_requests').all()).toEqual([{ id: 'h1', closed_at: null }]);
    const indices = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' AND (name LIKE 'idx_sessions_%' OR name LIKE 'idx_help_%')").all() as { name: string }[]
    ).map((r) => r.name).sort();
    expect(indices).toEqual(['idx_help_request_takes_request', 'idx_help_requests_created', 'idx_help_requests_user', 'idx_sessions_parent', 'idx_sessions_user']);
  });
});
```

- [ ] **Paso 2: correrlo y ver que falla**

Run: `pnpm vitest run test/system-migration-v8.test.ts`
Esperado: FAIL (`user_version` 7, no existe la columna).

- [ ] **Paso 3: la migración**

```typescript
// src/server/db/migrations/system/v8-impersonacion-y-ayuda.ts
import type { Migration } from '../types.ts';

/**
 * Impersonación y pedidos de ayuda (#23, M7b): una impersonación es una sesión más, con quién la
 * abrió, su sesión padre, el comercio de entrada, el pedido que atiende y el último uso (vence a las
 * 2 h sin uso). Los pedidos de ayuda vencen a las 24 h y registran cada toma de soporte.
 */
export const v8ImpersonacionYAyuda: Migration = {
  version: 8,
  name: 'impersonacion-y-ayuda',
  up: (db) => {
    db.exec(`
ALTER TABLE sessions ADD COLUMN impersonator_user_id TEXT;
ALTER TABLE sessions ADD COLUMN parent_token TEXT;
ALTER TABLE sessions ADD COLUMN help_request_id TEXT;
ALTER TABLE sessions ADD COLUMN tenant_id TEXT;
ALTER TABLE sessions ADD COLUMN last_used_at TEXT;
CREATE INDEX idx_sessions_parent ON sessions (parent_token);
CREATE INDEX idx_sessions_user ON sessions (user_id);

CREATE TABLE help_requests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  closed_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_help_requests_created ON help_requests (created_at);
CREATE INDEX idx_help_requests_user ON help_requests (user_id, closed_at);

CREATE TABLE help_request_takes (
  request_id TEXT NOT NULL,
  staff_user_id TEXT NOT NULL,
  at TEXT NOT NULL,
  FOREIGN KEY (request_id) REFERENCES help_requests(id) ON DELETE CASCADE
);
CREATE INDEX idx_help_request_takes_request ON help_request_takes (request_id);
`);
  },
};
```

En `src/server/db/migrations/system.ts`: `import { v8ImpersonacionYAyuda } from './system/v8-impersonacion-y-ayuda.ts';` y
`migrations: [v5CreditosYCobro, v6AltaWhatsappRubro, v7Plataforma, v8ImpersonacionYAyuda],`.

- [ ] **Paso 4: correr el test y la suite**

Run: `pnpm vitest run test/system-migration-v8.test.ts` → PASS. Después `pnpm lint && pnpm typecheck && pnpm test`
(`test/db.test.ts` y `test/run-migrations.test.ts` leen la versión del esquema: tienen que seguir en verde).

- [ ] **Paso 5: commit**

```bash
git add src/server/db/migrations/system/v8-impersonacion-y-ayuda.ts src/server/db/migrations/system.ts test/system-migration-v8.test.ts
git commit -m "feat: migración de sistema v8 para la impersonación y los pedidos de ayuda (#23)"
```

---

## Tarea 2: la sesión de impersonación en el servidor

**Archivos:**
- Modificar: `src/server/auth/auth-service.ts`, `src/server/middleware/auth-middleware.ts`, `src/server/audit/audit-log.ts` (acciones), `src/server/routes/auth-routes.ts`, `src/server/di/container.ts`, `src/server/app.ts`
- Crear: `src/server/impersonation/impersonation-service.ts`, `src/server/routes/impersonation-routes.ts`, `test/helpers/impersonate.ts`
- Test: `test/impersonation-api.test.ts`

**Interfaces:**
- Produce (en `auth-service.ts`):
  ```typescript
  export type Impersonator = { id: string; name: string; globalRole: 'root' | 'support' };
  export type ResolvedSession = { user: UserSession; impersonator: Impersonator | null; tenantId: string | null; helpRequestId: string | null };
  export const IMPERSONATION_IDLE_MS: number; // 2 h
  class AuthService {
    constructor(systemDb: DatabaseSync, deps?: { now?: (() => Date) | undefined; audit?: AuditLog | undefined });
    resolveSession(token: string): ResolvedSession | undefined;
    validateSession(token: string): UserSession | undefined; // = resolveSession(token)?.user
    createImpersonationSession(p: { parentToken: string; impersonatorId: string; userId: string; tenantId: string; helpRequestId: string | null }): string;
    endImpersonation(token: string, reason: 'exit' | 'expired' | 'parent-ended'): boolean;
    deleteSession(token: string): void;
  }
  ```
- Produce (en `auth-middleware.ts`): `AuthenticatedAdminRequest` suma `impersonator?: Impersonator` y `sessionToken?: string`; `export function bearerToken(req: Request): string | undefined`.
- Produce (en `impersonation-service.ts`):
  ```typescript
  export type ImpersonationStart = { token: string; user: UserSession; impersonator: Impersonator; tenantSlug: string; path: string };
  class ImpersonationService {
    constructor(deps: { db: DatabaseSync; auth: AuthService; audit: AuditLog });
    start(p: { staff: UserSession; parentToken: string; userId: string; tenantSlug?: string | undefined }): ImpersonationStart;
    end(token: string): void; // 400 si no es una impersonación
  }
  ```
- Produce: `AuditAction` suma `'impersonation.started' | 'impersonation.ended'`.
- Produce (tests): `impersonate(app, staffToken, userId, tenantSlug?): Promise<string>` en `test/helpers/impersonate.ts`.

- [ ] **Paso 1: el helper de tests y los tests que fallan**

```typescript
// test/helpers/impersonate.ts
import request from 'supertest';
import type { Express } from 'express';

/** Abre una impersonación (#23) con la sesión de soporte o root y devuelve su token. */
export async function impersonate(app: Express, staffToken: string, userId: string, tenantSlug?: string): Promise<string> {
  const res = await request(app)
    .post('/api/impersonations')
    .set('Authorization', `Bearer ${staffToken}`)
    .send(tenantSlug === undefined ? { userId } : { userId, tenantSlug });
  if (res.status !== 201) throw new Error(`No se pudo impersonar: ${String(res.status)} ${JSON.stringify(res.body)}`);
  return (res.body as { token: string }).token;
}
```

```typescript
// test/impersonation-api.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';

const MIN = 60 * 1000;

describe('sesión de impersonación (#23, M7b)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let now: Date;
  let tokens: { root: string; support: string; owner: string; otherSupport: string };
  let ids: { owner: string; support: string; root: string; lonely: string; disabled: string; otherSupport: string };

  beforeEach(() => {
    now = new Date('2026-10-05T15:00:00.000Z');
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => now });
    app = bundle.app;
    const auth = bundle.authService;
    const root = auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' }).user;
    const support = auth.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    const otherSupport = auth.createUser({ email: 'soporte2@x.com', password: 'password123', name: 'Beto' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id IN (?, ?)").run(support.user.id, otherSupport.user.id);
    const owner = auth.createUser({ email: 'juan@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco X', ownerUserId: owner.user.id });
    tenantManager.createTenant({ id: 'almacen', slug: 'almacen', name: 'Almacén Y', ownerUserId: owner.user.id });
    const lonely = auth.createUser({ email: 'solo@x.com', password: 'password123', name: 'Sin comercio' });
    const disabled = auth.createUser({ email: 'baja@x.com', password: 'password123', name: 'De baja' });
    tenantManager.createTenant({ id: 'otro', slug: 'otro', name: 'Otro', ownerUserId: disabled.user.id });
    systemDb.prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(disabled.user.id);
    tokens = {
      root: auth.login({ email: 'root@x.com', password: 'password123' }).token,
      support: support.token,
      otherSupport: otherSupport.token,
      owner: owner.token,
    };
    ids = { owner: owner.user.id, support: support.user.id, root: root.id, lonely: lonely.user.id, disabled: disabled.user.id, otherSupport: otherSupport.user.id };
  });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const audit = () =>
    systemDb
      .prepare("SELECT action, actor_user_id, target_user_id, tenant_id, details FROM audit_log WHERE action LIKE 'impersonation.%' ORDER BY rowid")
      .all() as { action: string; actor_user_id: string; target_user_id: string; tenant_id: string; details: string }[];

  it('soporte entra como el usuario: su token, su rol y el impersonador en /auth/me', async () => {
    const res = await request(app).post('/api/impersonations').set(bearer(tokens.support)).send({ userId: ids.owner });
    expect(res.status).toBe(201);
    const body = res.body as { token: string; user: { id: string }; impersonator: { name: string; globalRole: string }; tenantSlug: string; path: string };
    expect(body.user.id).toBe(ids.owner);
    expect(body.impersonator).toEqual({ id: ids.support, name: 'Ana', globalRole: 'support' });
    expect(body.tenantSlug).toBe('almacen'); // la membresía más reciente
    expect(body.path).toBe('/admin/almacen/dashboard');
    const me = await request(app).get('/api/auth/me').set(bearer(body.token));
    expect(me.status).toBe(200);
    expect((me.body as { user: { id: string }; impersonator: { id: string } }).user.id).toBe(ids.owner);
    expect((me.body as { impersonator: { id: string } }).impersonator.id).toBe(ids.support);
    expect((await request(app).get('/api/tenants/kiosco/products').set(bearer(body.token))).status).toBe(200);
    expect(audit()).toEqual([
      { action: 'impersonation.started', actor_user_id: ids.support, target_user_id: ids.owner, tenant_id: 'almacen', details: '{}' },
    ]);
  });

  it('con tenantSlug entra a ese comercio; uno donde no es miembro activo da 409', async () => {
    const res = await request(app).post('/api/impersonations').set(bearer(tokens.root)).send({ userId: ids.owner, tenantSlug: 'kiosco' });
    expect((res.body as { path: string }).path).toBe('/admin/kiosco/dashboard');
    const ajeno = await request(app).post('/api/impersonations').set(bearer(tokens.root)).send({ userId: ids.owner, tenantSlug: 'otro' });
    expect(ajeno.status).toBe(409);
  });

  it('a quién no: root, soporte, desactivados, sin comercios o inexistentes; y solo root o soporte con sesión propia', async () => {
    const start = (token: string, userId: string) => request(app).post('/api/impersonations').set(bearer(token)).send({ userId });
    expect((await start(tokens.support, ids.root)).status).toBe(403);
    expect((await start(tokens.support, ids.otherSupport)).status).toBe(403);
    expect((await start(tokens.support, ids.disabled)).status).toBe(409);
    expect((await start(tokens.support, ids.lonely)).status).toBe(409);
    expect((await start(tokens.support, 'usr_no_existe')).status).toBe(404);
    expect((await start(tokens.owner, ids.owner)).status).toBe(403);
    const imp = await impersonate(app, tokens.support, ids.owner);
    expect((await start(imp, ids.owner)).status).toBe(403);
  });

  it('vence a las 2 h sin uso: cada uso la estira (a lo sumo una escritura por minuto)', async () => {
    const imp = await impersonate(app, tokens.support, ids.owner);
    const use = () => request(app).get('/api/auth/me').set(bearer(imp));
    now = new Date(now.getTime() + 30 * MIN);
    expect((await use()).status).toBe(200);
    const lastUsed = () => (systemDb.prepare('SELECT last_used_at FROM sessions WHERE token = ?').get(imp) as { last_used_at: string }).last_used_at;
    expect(lastUsed()).toBe('2026-10-05T15:30:00.000Z');
    now = new Date(now.getTime() + 30 * 1000); // medio minuto: no escribe
    expect((await use()).status).toBe(200);
    expect(lastUsed()).toBe('2026-10-05T15:30:00.000Z');
    now = new Date('2026-10-05T17:29:00.000Z'); // 1 h 59 desde el último uso
    expect((await use()).status).toBe(200);
    now = new Date('2026-10-05T19:30:00.000Z'); // 2 h 01 sin uso
    expect((await use()).status).toBe(401);
    expect(systemDb.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(imp)).toEqual({ n: 0 });
    expect(audit().at(-1)).toMatchObject({ action: 'impersonation.ended', details: JSON.stringify({ reason: 'expired' }) });
  });

  it('"Salir" la termina; con una sesión propia es 400', async () => {
    const imp = await impersonate(app, tokens.support, ids.owner);
    expect((await request(app).delete('/api/impersonations/current').set(bearer(imp))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(imp))).status).toBe(401);
    expect(audit().at(-1)).toMatchObject({ action: 'impersonation.ended', actor_user_id: ids.support, details: JSON.stringify({ reason: 'exit' }) });
    expect((await request(app).delete('/api/impersonations/current').set(bearer(tokens.support))).status).toBe(400);
    // La sesión de soporte sigue
    expect((await request(app).get('/api/auth/me').set(bearer(tokens.support))).status).toBe(200);
  });

  it('muere con la sesión padre: el logout de soporte la corta', async () => {
    const imp = await impersonate(app, tokens.support, ids.owner);
    expect((await request(app).post('/api/auth/logout').set(bearer(tokens.support))).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(tokens.support))).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set(bearer(imp))).status).toBe(401);
    expect(audit().at(-1)).toMatchObject({ action: 'impersonation.ended', details: JSON.stringify({ reason: 'parent-ended' }) });
  });

  it('muere si soporte queda desactivado', async () => {
    const imp = await impersonate(app, tokens.otherSupport, ids.owner);
    expect((await request(app).post(`/api/platform/users/${ids.otherSupport}/disable`).set(bearer(tokens.root)).send({})).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(bearer(imp))).status).toBe(401);
  });
});
```

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/impersonation-api.test.ts`
Esperado: FAIL (`POST /api/impersonations` da 404).

- [ ] **Paso 3: `AuthService` con reloj, auditoría y sesiones de impersonación**

En `src/server/auth/auth-service.ts`:

```typescript
import type { AuditLog } from '../audit/audit-log.ts';

export type Impersonator = { id: string; name: string; globalRole: 'root' | 'support' };

/** Una sesión resuelta (#23): la del usuario o una impersonación, con quién la abrió. */
export type ResolvedSession = {
  user: UserSession;
  impersonator: Impersonator | null;
  tenantId: string | null;
  helpRequestId: string | null;
};

/** Una impersonación vence a las 2 h sin uso; el último uso se escribe a lo sumo una vez por minuto. */
export const IMPERSONATION_IDLE_MS = 2 * 60 * 60 * 1000;
const TOUCH_EVERY_MS = 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type SessionRow = {
  id: string;
  email: string;
  name: string;
  global_role: string;
  expires_at: string;
  impersonator_user_id: string | null;
  help_request_id: string | null;
  tenant_id: string | null;
  last_used_at: string | null;
  imp_name: string | null;
  imp_role: string | null;
  imp_status: string | null;
  parent_expires_at: string | null;
};
```

La clase suma `private now: () => Date;` y `private audit: AuditLog | undefined;`, y el constructor pasa a:

```typescript
  constructor(systemDb: DatabaseSync, deps: { now?: (() => Date) | undefined; audit?: AuditLog | undefined } = {}) {
    this.systemDb = systemDb;
    this.now = deps.now ?? (() => new Date());
    this.audit = deps.audit;
  }
```

`createSession` usa `this.now()` en lugar de `new Date()` y `SESSION_TTL_MS`. `validateSession` se reemplaza por:

```typescript
  /** El usuario de la sesión, propia o impersonada. Para saber si es una impersonación, `resolveSession`. */
  validateSession(token: string): UserSession | undefined {
    return this.resolveSession(token)?.user;
  }

  /**
   * Resuelve el token (#23): una impersonación vence a las 2 h sin uso y muere si su sesión padre ya no
   * existe, venció o es de una cuenta desactivada. Las dos cosas la borran y se auditan.
   */
  resolveSession(token: string): ResolvedSession | undefined {
    const row = this.systemDb
      .prepare(
        `SELECT u.id, u.email, u.name, u.global_role, s.expires_at, s.impersonator_user_id, s.help_request_id,
           s.tenant_id, s.last_used_at, imp.name AS imp_name, imp.global_role AS imp_role, imp.status AS imp_status,
           p.expires_at AS parent_expires_at
         FROM sessions s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN users imp ON imp.id = s.impersonator_user_id
         LEFT JOIN sessions p ON p.token = s.parent_token
         WHERE s.token = ? AND u.status = 'active'`,
      )
      .get(token) as SessionRow | undefined;
    if (row === undefined) return undefined;

    const now = this.now();
    if (row.expires_at < now.toISOString()) {
      this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
      return undefined;
    }
    const user: UserSession = { id: row.id, email: row.email, name: row.name, globalRole: row.global_role as UserRole };
    if (row.impersonator_user_id === null) return { user, impersonator: null, tenantId: null, helpRequestId: null };

    const impRole = row.imp_role;
    const parentAlive =
      row.parent_expires_at !== null &&
      row.parent_expires_at >= now.toISOString() &&
      row.imp_status === 'active' &&
      (impRole === 'root' || impRole === 'support');
    if (!parentAlive) {
      this.endImpersonation(token, 'parent-ended');
      return undefined;
    }
    const idle = now.getTime() - Date.parse(row.last_used_at ?? '');
    if (!(idle <= IMPERSONATION_IDLE_MS)) {
      this.endImpersonation(token, 'expired');
      return undefined;
    }
    if (idle >= TOUCH_EVERY_MS) {
      this.systemDb.prepare('UPDATE sessions SET last_used_at = ? WHERE token = ?').run(now.toISOString(), token);
    }
    return {
      user,
      impersonator: { id: row.impersonator_user_id, name: row.imp_name ?? '', globalRole: impRole },
      tenantId: row.tenant_id,
      helpRequestId: row.help_request_id,
    };
  }

  /** Una sesión de impersonación (#23): un token propio, hijo de la sesión de quien impersona. */
  createImpersonationSession(p: { parentToken: string; impersonatorId: string; userId: string; tenantId: string; helpRequestId: string | null }): string {
    const token = generateSessionToken();
    const now = this.now();
    this.systemDb
      .prepare(
        `INSERT INTO sessions (token, user_id, expires_at, created_at, impersonator_user_id, parent_token, help_request_id, tenant_id, last_used_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        token,
        p.userId,
        new Date(now.getTime() + SESSION_TTL_MS).toISOString(),
        now.toISOString(),
        p.impersonatorId,
        p.parentToken,
        p.helpRequestId,
        p.tenantId,
        now.toISOString(),
      );
    return token;
  }

  /** Termina una impersonación y la audita; `false` si el token no es una. */
  endImpersonation(token: string, reason: 'exit' | 'expired' | 'parent-ended'): boolean {
    const row = this.systemDb
      .prepare('SELECT user_id, impersonator_user_id, tenant_id FROM sessions WHERE token = ? AND impersonator_user_id IS NOT NULL')
      .get(token) as { user_id: string; impersonator_user_id: string; tenant_id: string | null } | undefined;
    if (row === undefined) return false;
    this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    this.audit?.record({
      actorUserId: row.impersonator_user_id,
      tenantId: row.tenant_id,
      action: 'impersonation.ended',
      targetUserId: row.user_id,
      details: { reason },
    });
    return true;
  }

  /** "Cerrar sesión" (#23): borra la sesión del token; sus impersonaciones mueren en el próximo pedido. */
  deleteSession(token: string): void {
    if (this.endImpersonation(token, 'exit')) return;
    this.systemDb.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  }
```

En `src/server/audit/audit-log.ts`, `AuditAction` suma `| 'impersonation.started' | 'impersonation.ended'`.

En `src/server/di/container.ts`, `authServiceDef` pasa a
`fn.singleton((c) => new AuthService(c.use(systemDbDef), { now: c.use(clockDef), audit: c.use(auditLogDef) }))`
(`auditLogDef` solo depende de la base y el reloj: no hay ciclo; si el orden de declaración molesta,
se mueve `authServiceDef` debajo de `auditLogDef`).

- [ ] **Paso 4: el middleware deja la sesión resuelta en el pedido**

En `src/server/middleware/auth-middleware.ts`:

```typescript
import type { AuthService, Impersonator, UserSession } from '../auth/auth-service.ts';

export interface AuthenticatedAdminRequest extends Request {
  user?: UserSession;
  /** Quién impersona (#23): está solo en una sesión de impersonación; `user` es el impersonado. */
  impersonator?: Impersonator;
  /** El token Bearer del pedido. */
  sessionToken?: string;
  activeTenantId?: string;
  activeTenantDb?: DatabaseSync;
  tenantScope?: IContainer;
  tenantRole?: TenantRole;
}

/** El token Bearer del pedido, si hay uno. */
export function bearerToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice(7).trim();
  return token === '' ? undefined : token;
}
```

y en `createAdminAuthMiddleware`, en lugar de `validateSession`:

```typescript
    const token = bearerToken(req);
    if (token === undefined) {
      res.status(401).json({ error: 'Falta cabecera Authorization: Bearer <token>' });
      return;
    }
    const session = authService.resolveSession(token);
    if (session === undefined) {
      res.status(401).json({ error: 'Sesión expirada o token inválido' });
      return;
    }
    const user = session.user;
    req.user = user;
    req.sessionToken = token;
    if (session.impersonator !== null) req.impersonator = session.impersonator;
```

(el resto, igual).

- [ ] **Paso 5: el servicio y las rutas**

```typescript
// src/server/impersonation/impersonation-service.ts
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, Impersonator, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { DomainError } from '../errors.ts';

export type ImpersonationStart = { token: string; user: UserSession; impersonator: Impersonator; tenantSlug: string; path: string };

type TargetTenant = { id: string; slug: string };

/**
 * Impersonación de usuario (#23, M7b): root o soporte, con su sesión propia, entran como una cuenta
 * `user` activa con al menos una membresía activa. Nunca como root, soporte, desactivados ni demos.
 */
export class ImpersonationService {
  private db: DatabaseSync;
  private auth: AuthService;
  private audit: AuditLog;

  constructor(deps: { db: DatabaseSync; auth: AuthService; audit: AuditLog }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.audit = deps.audit;
  }

  start(p: { staff: UserSession; parentToken: string; userId: string; tenantSlug?: string | undefined }): ImpersonationStart {
    const { user, tenant } = this.target(p.userId, p.tenantSlug);
    return this.open({ staff: p.staff, parentToken: p.parentToken, user, tenant, path: `/admin/${tenant.slug}/dashboard`, helpRequestId: null });
  }

  /** "Salir": termina la impersonación del token. */
  end(token: string): void {
    if (!this.auth.endImpersonation(token, 'exit')) throw new DomainError(400, 'No estás viendo como otro usuario');
  }

  /** La cuenta y el comercio de entrada: el pedido o, si no, la membresía activa más reciente. */
  private target(userId: string, tenantSlug: string | undefined): { user: UserSession; tenant: TargetTenant } {
    const row = this.db.prepare('SELECT id, email, name, global_role, status FROM users WHERE id = ?').get(userId) as
      | { id: string; email: string; name: string; global_role: string; status: string }
      | undefined;
    if (row === undefined) throw new DomainError(404, 'Usuario no encontrado');
    if (row.global_role !== 'user') throw new DomainError(403, 'No se puede entrar como root o soporte');
    if (row.status !== 'active') throw new DomainError(409, 'La cuenta está desactivada');
    const tenants = this.db
      .prepare(
        `SELECT t.id, t.slug FROM memberships m JOIN tenants t ON t.id = m.tenant_id
         WHERE m.user_id = ? AND m.status = 'active' AND t.id NOT IN (SELECT tenant_id FROM demo_sessions)
         ORDER BY m.created_at DESC, m.rowid DESC`,
      )
      .all(userId) as TargetTenant[];
    if (tenants.length === 0) throw new DomainError(409, 'El usuario no tiene comercios activos');
    const tenant = tenantSlug === undefined ? tenants[0] : tenants.find((t) => t.slug === tenantSlug);
    if (tenant === undefined) throw new DomainError(409, 'El usuario no es miembro activo de ese comercio');
    return { user: { id: row.id, email: row.email, name: row.name, globalRole: 'user' }, tenant };
  }

  private open(p: {
    staff: UserSession;
    parentToken: string;
    user: UserSession;
    tenant: TargetTenant;
    path: string;
    helpRequestId: string | null;
  }): ImpersonationStart {
    const role = p.staff.globalRole;
    if (role !== 'root' && role !== 'support') throw new DomainError(403, 'Solo para la plataforma');
    const token = this.auth.createImpersonationSession({
      parentToken: p.parentToken,
      impersonatorId: p.staff.id,
      userId: p.user.id,
      tenantId: p.tenant.id,
      helpRequestId: p.helpRequestId,
    });
    this.audit.record({
      actorUserId: p.staff.id,
      tenantId: p.tenant.id,
      action: 'impersonation.started',
      targetUserId: p.user.id,
      details: p.helpRequestId === null ? {} : { helpRequestId: p.helpRequestId },
    });
    return {
      token,
      user: p.user,
      impersonator: { id: p.staff.id, name: p.staff.name, globalRole: role },
      tenantSlug: p.tenant.slug,
      path: p.path,
    };
  }
}
```

```typescript
// src/server/routes/impersonation-routes.ts
import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePlatformRole } from '../middleware/platform-role-middleware.ts';
import type { ImpersonationService } from '../impersonation/impersonation-service.ts';
import { DomainError, sendError } from '../errors.ts';

const startSchema = z.object({
  userId: z.string().trim().min(1, 'Falta el usuario'),
  tenantSlug: z.string().trim().min(1).optional(),
});

/** Impersonación de usuario (#23): empezar (root o soporte, con su sesión propia) y "Salir". */
export function createImpersonationRoutes(impersonations: ImpersonationService): Router {
  const router = Router();

  router.post('/', requirePlatformRole('root', 'support'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      if (req.user === undefined || req.sessionToken === undefined) throw new DomainError(401, 'No autorizado');
      res.status(201).json(impersonations.start({ staff: req.user, parentToken: req.sessionToken, ...parsed.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/current', (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      impersonations.end(req.sessionToken ?? '');
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

En `src/server/di/container.ts`:

```typescript
import { ImpersonationService } from '../impersonation/impersonation-service.ts';
// --- IMPERSONACIÓN (#23, M7b) ---
export const impersonationServiceDef = fn.singleton(
  (c) => new ImpersonationService({ db: c.use(systemDbDef), auth: c.use(authServiceDef), audit: c.use(auditLogDef) }),
);
```

En `src/server/app.ts`, después de `/api/auth`:
`app.use('/api/impersonations', requireAdmin, createImpersonationRoutes(rootContainer.use(impersonationServiceDef)));`

En `src/server/routes/auth-routes.ts`: `/me` suma `impersonator: req.impersonator ?? null` a la respuesta, y una ruta nueva:

```typescript
  // "Cerrar sesión" (#23): borra la sesión en el servidor; las impersonaciones hijas mueren con ella
  router.post('/logout', requireAdmin, (req: AuthenticatedAdminRequest, res: Response) => {
    if (req.sessionToken !== undefined) authService.deleteSession(req.sessionToken);
    res.status(200).json({ success: true });
  });
```

- [ ] **Paso 6: correr los tests y la suite**

Run: `pnpm vitest run test/impersonation-api.test.ts` → PASS. Después `pnpm lint && pnpm typecheck && pnpm test`.

- [ ] **Paso 7: commit**

```bash
git add src/server test/helpers/impersonate.ts test/impersonation-api.test.ts
git commit -m "feat: sesión de impersonación de usuario que vence a las 2 h y muere con la de soporte (#23)"
```

---

## Tarea 3: lo que no puede quien impersona y la auditoría con los dos nombres

**Archivos:**
- Crear: `src/server/middleware/own-session-middleware.ts`, `src/server/audit/audit-actor.ts`
- Modificar: `src/server/audit/audit-log.ts`, `src/shared/platform-types.ts`, `src/server/users/invitation-service.ts`, `src/server/users/membership-service.ts`, `src/server/routes/user-routes.ts`, `src/server/routes/register-routes.ts`, `src/server/routes/auth-routes.ts`, `src/server/routes/alta-routes.ts`, `src/server/routes/link-routes.ts`, `src/server/middleware/platform-role-middleware.ts`, `src/server/middleware/tenant-context-middleware.ts`, `src/server/middleware/billing-restriction-middleware.ts`, `src/server/app.ts`, `src/client/state/users-state.ts` (solo el tipo `AuditItem`)
- Test: `test/impersonation-rules.test.ts`

**Interfaces:**
- Consume: `req.impersonator`, `impersonate()` (Tarea 2).
- Produce: `requireOwnSession: RequestHandler`, `IMPERSONATING_MESSAGE = 'No disponible mientras ves como otro usuario'`; `auditActor(req): { actorUserId: string; impersonatorUserId?: string | undefined }`; `AuditLog.record` acepta `impersonatorUserId?: string | undefined`; `AuditEntry` y `PlatformAuditItem` suman `impersonatorName: string | null`; el actor de `InvitationService.create/revoke` y `MembershipService.updateMember` suma `impersonatorUserId?: string | undefined`.

- [ ] **Paso 1: los tests que fallan**

```typescript
// test/impersonation-rules.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';

const MSG = 'No disponible mientras ves como otro usuario';

describe('lo que no puede quien impersona (#23, M7b)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let imp: string;
  let ids: { owner: string; support: string; coOwner: string; admin: string };

  beforeEach(async () => {
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => new Date('2026-10-05T15:00:00.000Z') });
    app = bundle.app;
    const auth = bundle.authService;
    const support = auth.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = auth.createUser({ email: 'juan@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco X', ownerUserId: owner.user.id });
    const coOwner = auth.createUser({ email: 'co@x.com', password: 'password123', name: 'Co' });
    const admin = auth.createUser({ email: 'adm@x.com', password: 'password123', name: 'Adm' });
    systemDb.prepare("INSERT INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, 'kiosco', 'owner', 'active', '2026-10-01'), (?, 'kiosco', 'admin', 'active', '2026-10-01')").run(coOwner.user.id, admin.user.id);
    ids = { owner: owner.user.id, support: support.user.id, coOwner: coOwner.user.id, admin: admin.user.id };
    imp = await impersonate(app, support.token, owner.user.id, 'kiosco');
  });

  const as = () => ({ Authorization: `Bearer ${imp}` });
  const expect403 = (res: { status: number; body: unknown }) => {
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toBe(MSG);
  };

  it('no cambia la contraseña ni genera links de restablecimiento', async () => {
    expect403(await request(app).post('/api/auth/password').set(as()).send({ currentPassword: 'password123', newPassword: 'otra-clave-1' }));
    expect403(await request(app).post(`/api/tenants/kiosco/users/${ids.admin}/password-reset`).set(as()).send({}));
  });

  it('no nombra owners: ni invita como owner ni cambia el rol o el estado de un owner', async () => {
    expect403(await request(app).post('/api/tenants/kiosco/invitations').set(as()).send({ email: 'nuevo@x.com', role: 'owner' }));
    expect403(await request(app).patch(`/api/tenants/kiosco/users/${ids.admin}`).set(as()).send({ role: 'owner' }));
    expect403(await request(app).patch(`/api/tenants/kiosco/users/${ids.coOwner}`).set(as()).send({ status: 'disabled' }));
    // Lo demás de Usuarios, sí
    expect((await request(app).post('/api/tenants/kiosco/invitations').set(as()).send({ email: 'nuevo@x.com', role: 'member' })).status).toBe(201);
    expect((await request(app).patch(`/api/tenants/kiosco/users/${ids.admin}`).set(as()).send({ role: 'member' })).status).toBe(200);
  });

  it('no crea comercios, no acepta invitaciones ni usa la plataforma', async () => {
    expect403(await request(app).post('/api/alta').set(as()).send({ businessName: 'Otro', businessType: 'kiosco' }));
    expect403(await request(app).post('/api/invitations/accept').set(as()).send({ token: 'x', password: 'password123' }));
    expect403(await request(app).post('/api/staff-invitations/accept').set(as()).send({ token: 'x', password: 'password123' }));
    expect403(await request(app).get('/api/platform/tenants').set(as()));
    expect403(await request(app).post('/api/impersonations').set(as()).send({ userId: ids.admin }));
  });

  it('la auditoría guarda los dos y la lectura devuelve el nombre de quien impersona', async () => {
    await request(app).post('/api/tenants/kiosco/invitations').set(as()).send({ email: 'nuevo@x.com', role: 'member' });
    expect(
      systemDb.prepare("SELECT actor_user_id, impersonator_user_id FROM audit_log WHERE action = 'invitation.created'").all(),
    ).toEqual([{ actor_user_id: ids.owner, impersonator_user_id: ids.support }]);
    const activity = await request(app).get('/api/tenants/kiosco/audit').set(as());
    const created = (activity.body as { action: string; actorName: string; impersonatorName: string | null }[]).find((e) => e.action === 'invitation.created');
    expect(created).toMatchObject({ actorName: 'Juan', impersonatorName: 'Ana' });
  });

  it('un comercio suspendido no bloquea a quien impersona', async () => {
    systemDb.prepare("INSERT INTO tenant_suspensions (id, tenant_id, from_at, to_at, reason, created_by) VALUES ('s1', 'kiosco', '2026-10-05T14:00:00.000Z', NULL, 'Prueba', ?)").run(ids.support);
    systemDb.prepare("UPDATE tenants SET status = 'suspended' WHERE id = 'kiosco'").run();
    expect((await request(app).get('/api/tenants/kiosco/products').set(as())).status).toBe(200);
  });
});
```

(Si la suspensión de M7a se marca de otra forma que `tenant_suspensions` + `tenants.status`, el último
test usa `SuspensionService.suspend` desde `bundle.rootContainer.use(suspensionServiceDef)`.)

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/impersonation-rules.test.ts` → FAIL.

- [ ] **Paso 3: `requireOwnSession` y `auditActor`**

```typescript
// src/server/middleware/own-session-middleware.ts
import type { NextFunction, Response } from 'express';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

export const IMPERSONATING_MESSAGE = 'No disponible mientras ves como otro usuario';

/** Lo que solo hace el usuario con su sesión (#23): contraseña, owners, links, comercios y plataforma. */
export function requireOwnSession(req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void {
  if (req.impersonator !== undefined) {
    res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE });
    return;
  }
  next();
}
```

```typescript
// src/server/audit/audit-actor.ts
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';

/** El actor de la auditoría (#23): el usuario del pedido y, si impersona alguien, quién. */
export function auditActor(req: AuthenticatedAdminRequest): { actorUserId: string; impersonatorUserId?: string | undefined } {
  const actorUserId = req.user?.id ?? '';
  return req.impersonator === undefined ? { actorUserId } : { actorUserId, impersonatorUserId: req.impersonator.id };
}
```

- [ ] **Paso 4: la auditoría con el impersonador**

En `src/server/audit/audit-log.ts`:
- `AuditEntry` suma `impersonatorName: string | null;` y `PlatformAuditItem` (en `src/shared/platform-types.ts`) también.
- `record` acepta `impersonatorUserId?: string | undefined` y el `INSERT` suma la columna:
  `'INSERT INTO audit_log (id, at, actor_user_id, impersonator_user_id, tenant_id, action, target_user_id, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'`
  con `params.impersonatorUserId ?? null` después de `params.actorUserId`.
- `listForTenant` y `listPlatform` suman `LEFT JOIN users imp ON imp.id = a.impersonator_user_id`,
  `imp.name AS impersonator_name` en el `SELECT`, `impersonator_name: string | null` en el tipo de la
  fila y `impersonatorName: r.impersonator_name` en el resultado.
- En `src/client/state/users-state.ts`, `AuditItem` suma `impersonatorName: string | null`.

- [ ] **Paso 5: los servicios y las rutas del comercio llevan el actor completo**

- `InvitationService.create` y `revoke`: el actor pasa a `{ userId: string; role: TenantRole; impersonatorUserId?: string | undefined }`
  y cada `this.audit.record` suma `impersonatorUserId: params.actor.impersonatorUserId`.
- `MembershipService.updateMember`: lo mismo con `actor.impersonatorUserId` en los dos `record`.
- `src/server/routes/user-routes.ts`:
  ```typescript
  import { requireOwnSession } from '../middleware/own-session-middleware.ts';
  import { IMPERSONATING_MESSAGE } from '../middleware/own-session-middleware.ts';

  function actorOf(req: AuthenticatedAdminRequest): {
    tenantId: string;
    actor: { userId: string; role: TenantRole; impersonatorUserId?: string | undefined };
  } {
    if (req.user === undefined || req.tenantRole === undefined || req.activeTenantId === undefined) {
      throw new DomainError(401, 'No autorizado');
    }
    const actor = { userId: req.user.id, role: req.tenantRole };
    return {
      tenantId: req.activeTenantId,
      actor: req.impersonator === undefined ? actor : { ...actor, impersonatorUserId: req.impersonator.id },
    };
  }
  ```
  En `POST /invitations`, después de validar: `if (req.impersonator !== undefined && parsed.data.role === 'owner') { res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE }); return; }`.
  En `PATCH /users/:userId`, después de validar:
  ```typescript
      const target = req.params['userId'] ?? '';
      const current = deps.members.getMembership(req.activeTenantId ?? '', target);
      if (req.impersonator !== undefined && (current?.role === 'owner' || parsed.data.role === 'owner')) {
        res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE });
        return;
      }
  ```
  `POST /users/:userId/password-reset` suma `requireOwnSession` después de `requirePermission('owners.manage')`.
- `src/server/routes/register-routes.ts`: `record` usa `audit.record({ ...auditActor(req), tenantId: …, action, details: … })`.
- `src/server/routes/auth-routes.ts`: `router.post('/password', requireAdmin, requireOwnSession, …)`.

- [ ] **Paso 6: alta, links, plataforma, suspensión y restricción**

- `src/server/middleware/platform-role-middleware.ts`, al principio del handler:
  ```typescript
    if (req.impersonator !== undefined) {
      res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE });
      return;
    }
  ```
- `src/server/routes/alta-routes.ts`: en lugar de `validateSession`,
  ```typescript
    const session = sessionToken === undefined ? undefined : authService.resolveSession(sessionToken);
    if (sessionToken !== undefined && session === undefined) { /* 401 como hoy */ }
    if (session !== undefined && session.impersonator !== null) {
      res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE });
      return;
    }
    const user = session?.user;
  ```
- `src/server/routes/link-routes.ts`: `createInvitationLinkRoutes` y `createStaffInvitationLinkRoutes`
  reciben también `auth: AuthService`; un middleware local en las dos `/accept`:
  ```typescript
  /** Aceptar una invitación no se hace desde una impersonación (#23); sin token, como siempre. */
  function rejectImpersonation(auth: AuthService): RequestHandler {
    return (req, res, next) => {
      const token = bearerToken(req);
      const session = token === undefined ? undefined : auth.resolveSession(token);
      if (session !== undefined && session.impersonator !== null) {
        res.status(403).json({ code: 'impersonating', error: IMPERSONATING_MESSAGE });
        return;
      }
      next();
    };
  }
  ```
  `app.ts` les pasa `authService`.
- `src/server/middleware/tenant-context-middleware.ts`: la condición de suspendido suma `req.impersonator === undefined &&`.
- `src/server/middleware/billing-restriction-middleware.ts`: `if (req.impersonator !== undefined || role === 'root' || role === 'support' || OPEN_WHEN_BLOCKED.test(tenantPath(req)))`.

- [ ] **Paso 7: correr los tests y la suite**

Run: `pnpm vitest run test/impersonation-rules.test.ts` → PASS; `pnpm lint && pnpm typecheck && pnpm test`.
`test/permissions-api.test.ts` tiene que seguir en verde (la capacidad de cada ruta no cambia).

- [ ] **Paso 8: commit**

```bash
git add src test/impersonation-rules.test.ts
git commit -m "feat: quien impersona no toca contraseña, owners, comercios ni plataforma, y la auditoría guarda los dos (#23)"
```

---

## Tarea 4: root y soporte sin membresía implícita (#16)

**Archivos:**
- Modificar: `src/shared/permissions.ts`, `src/server/auth/auth-service.ts`, `src/server/users/membership-service.ts`, `src/server/middleware/auth-middleware.ts`, `src/server/routes/auth-routes.ts`, `src/server/routes/tenant-routes.ts`, `src/server/middleware/tenant-context-middleware.ts`, `src/server/middleware/billing-restriction-middleware.ts`, `src/client/state/auth-state.ts` (tipo), `src/client/state/permissions-state.ts`, `test/helpers/client-route.ts`
- Tests a ajustar: `test/auth-and-tenants.test.ts`, `test/membership-service.test.ts`, `test/billing-restriction.test.ts`, `test/tenant-suspension.test.ts`, `test/permissions.test.ts`, `test/permissions-client.test.ts`, `test/auth-client-state.test.ts`, `test/app-shell-and-navigation.test.ts`, `test/platform-client.test.ts`, y los que salgan de la suite.

**Interfaces:**
- Produce: `AuthService.listUserTenants(userId: string): TenantMembershipInfo[]` (sin `globalRole`), `TenantMembershipInfo.role: TenantRole`, `MembershipService.resolveRole(user, tenantId)` solo con membresías. Se borran `MembershipRole` y `effectiveTenantRole`.

- [ ] **Paso 1: los tests que fallan**

En `test/auth-and-tenants.test.ts`, el test "el usuario root puede ver y acceder a todos los tenants (impersonación)" se reemplaza por:

```typescript
  it('root y soporte no ven comercios ajenos como propios ni entran sin impersonar (#16)', async () => {
    authService.ensureRoot({ email: 'root@sistema.com', password: 'password-root-123', name: 'Root' });
    const rootToken = (
      (await request(app).post('/api/auth/login').send({ email: 'root@sistema.com', password: 'password-root-123' })).body as { token: string }
    ).token;
    await request(app)
      .post('/api/alta')
      .send({ email: 'comerciante@local.com', password: 'password123', name: 'Comerciante', businessName: 'Zapatería Real', businessType: 'otro', whatsapp: '1155550000' });

    const tenants = await request(app).get('/api/tenants').set('Authorization', `Bearer ${rootToken}`);
    expect(tenants.status).toBe(200);
    expect(tenants.body).toEqual([]);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${rootToken}`);
    expect((me.body as { tenants: unknown[] }).tenants).toEqual([]);
    expect((await request(app).get('/api/tenants/zapateria-real/products').set('Authorization', `Bearer ${rootToken}`)).status).toBe(403);
  });
```

En `test/membership-service.test.ts`, "owner para root" pasa a `expect(members.resolveRole(root, 'kiosco-a')).toBeUndefined();`
(y el nombre del test, "nada para root sin membresía (#16)").

En `test/billing-restriction.test.ts`, "root impersonando no se restringe" pasa a usar la impersonación
del owner: `const imp = await impersonate(app, tokens.root, ownerId);` y el pedido de `/products` con
ese token da 200 (guardar `ownerId` en el `beforeEach`; `impersonate` de `test/helpers/impersonate.ts`).

En `test/tenant-suspension.test.ts`, la línea "Root y soporte siguen mirando (hasta M7b…)" pasa a:
```typescript
    // Sin membresía, soporte no entra (#16); impersonando al owner, sí (impersonation-rules.test.ts)
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set(as('support'))).status).toBe(403);
```

En `test/permissions.test.ts` se borra el caso de `effectiveTenantRole`.

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/auth-and-tenants.test.ts test/membership-service.test.ts test/tenant-suspension.test.ts` → FAIL.

- [ ] **Paso 3: el servidor mira solo membresías reales**

- `src/shared/permissions.ts`: se borran `MembershipRole` y `effectiveTenantRole`; el comentario del
  archivo dice "Root y soporte no son miembros: entran impersonando a un usuario (#23)".
- `AuthService.listUserTenants(userId: string)`: queda solo la consulta de membresías activas (sin la
  rama de root y soporte); `TenantMembershipInfo.role: TenantRole` (import de `TenantRole`).
- `MembershipService.resolveRole`: queda
  ```typescript
  /** El rol con el que el usuario opera el comercio: su membresía activa. Root y soporte no son miembros (#16). */
  resolveRole(user: UserSession, tenantId: string): TenantRole | undefined {
    const membership = this.getMembership(tenantId, user.id);
    return membership?.status === 'active' ? membership.role : undefined;
  }
  ```
- Llamadas a `listUserTenants(…, globalRole)` en `auth-middleware.ts`, `auth-routes.ts` y `tenant-routes.ts`: sin el segundo argumento.
- `tenant-context-middleware.ts`: la condición de suspendido queda `req.impersonator === undefined && isSuspended(…) && …` (sin `globalRole === 'user'`: solo llegan miembros) y el comentario de arriba se actualiza.
- `billing-restriction-middleware.ts`: queda `if (req.impersonator !== undefined || OPEN_WHEN_BLOCKED.test(tenantPath(req)))`, comentario "Quien impersona no se restringe".

- [ ] **Paso 4: los tipos del cliente**

- `src/client/state/auth-state.ts`: `TenantMembershipItem.role: TenantRole` (import desde `shared/permissions.ts`).
- `src/client/state/permissions-state.ts`: `activeRoleSignal` devuelve `tenant === null ? null : tenant.role`; `ROLE_LABEL: Record<TenantRole, string>` sin las entradas de impersonador; comentario "el rol de la membresía".
- `test/helpers/client-route.ts`: `role: TenantRole = 'owner'`.
- `test/permissions-client.test.ts`, `test/auth-client-state.test.ts`, `test/app-shell-and-navigation.test.ts`, `test/platform-client.test.ts`: los `role: 'root_impersonator'` pasan a `'owner'` y se borran las expectativas de `ROLE_LABEL.support_impersonator` y `como('root_impersonator')`. Los tests de `impersonateTenant` siguen hasta la Tarea 7.

- [ ] **Paso 5: la suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`. Si algún otro test usaba a root o soporte como owner
implícito de un comercio (`grep -n "root\|support" test/credits-api.test.ts test/validation-messages.test.ts`),
pasa a usar el token del owner o `impersonate(app, rootToken, ownerId)`; las rutas de `/api/platform` siguen con root.

- [ ] **Paso 6: commit**

```bash
git add src test
git commit -m "feat: root y soporte dejan de ser miembros implícitos de los comercios (#16)"
```

---

## Tarea 5: pedidos de ayuda en el servidor

**Archivos:**
- Crear: `src/shared/help-types.ts`, `src/server/help/help-path.ts`, `src/server/help/help-request-service.ts`, `src/server/routes/help-routes.ts`, `src/server/routes/me-routes.ts`
- Modificar: `src/server/impersonation/impersonation-service.ts`, `src/server/routes/impersonation-routes.ts`, `src/server/routes/platform-admin-routes.ts`, `src/server/di/container.ts`, `src/server/app.ts`, `src/server/seeds/dev-fixtures.ts`, `src/server/db/dev-seed.ts`, `test/permissions-api.test.ts`, `test/platform-permissions.test.ts`
- Test: `test/help-requests-api.test.ts`

**Interfaces:**
- Produce (`src/shared/help-types.ts`):
  ```typescript
  export const HELP_MESSAGE_MAX = 500;
  export type HelpRequestStatus = 'open' | 'expired' | 'closed';
  export type HelpRequestTake = { staffName: string; at: string };
  export type HelpRequestItem = {
    id: string; tenantId: string; tenantSlug: string; tenantName: string; userId: string; userName: string;
    path: string; message: string; createdAt: string; expiresAt: string; status: HelpRequestStatus; takes: HelpRequestTake[];
  };
  export type HelpRequestCreated = { id: string; url: string; expiresAt: string };
  export type SupportAccessItem = { at: string; staffName: string; byRequest: boolean };
  export type SupportAccess = {
    supportWhatsapp: string;
    openRequest: { id: string; message: string; createdAt: string; expiresAt: string } | null;
    accesses: SupportAccessItem[];
    activeNow: boolean;
  };
  ```
- Produce: `HelpRequestService` con `create`, `findOpen`, `recordTake`, `listForPanel`, `supportAccess`; `isAdminPathOf(path, slug): boolean`.
- Produce: `POST /api/impersonations` acepta `{ helpRequestId }` (410 "Este pedido venció" si venció o se cerró).
- Rutas: `POST /api/tenants/:tenantId/help-requests` (`tenant.use` + `requireOwnSession`), `GET /api/me/support-access`, `GET /api/platform/help-requests` (root y soporte).

- [ ] **Paso 1: los tests que fallan**

```typescript
// test/help-requests-api.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { impersonate } from './helpers/impersonate.ts';
import type { HelpRequestItem, SupportAccess } from '../src/shared/help-types.ts';

const HOUR = 60 * 60 * 1000;

describe('pedidos de ayuda (#23, M7b)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let now: Date;
  let tokens: { owner: string; support: string; root: string };
  let ownerId: string;

  beforeEach(async () => {
    now = new Date('2026-10-05T15:00:00.000Z');
    systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager, now: () => now });
    app = bundle.app;
    const auth = bundle.authService;
    auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' });
    const support = auth.createUser({ email: 'soporte@x.com', password: 'password123', name: 'Ana' });
    systemDb.prepare("UPDATE users SET global_role = 'support' WHERE id = ?").run(support.user.id);
    const owner = auth.createUser({ email: 'juan@x.com', password: 'password123', name: 'Juan' });
    tenantManager.createTenant({ id: 'kiosco', slug: 'kiosco', name: 'Kiosco X', ownerUserId: owner.user.id });
    ownerId = owner.user.id;
    tokens = { owner: owner.token, support: support.token, root: auth.login({ email: 'root@x.com', password: 'password123' }).token };
    await request(app).put('/api/platform/settings').set(bearer(tokens.root)).send({ supportWhatsapp: '5491155551234' });
  });

  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const ask = (body: object, token = tokens.owner) => request(app).post('/api/tenants/kiosco/help-requests').set(bearer(token)).send(body);
  const access = async () => (await request(app).get('/api/me/support-access').set(bearer(tokens.owner))).body as SupportAccess;
  const take = (id: string, token = tokens.support) => request(app).post('/api/impersonations').set(bearer(token)).send({ helpRequestId: id });

  it('el usuario pide ayuda desde una pantalla: link al pedido y el WhatsApp de soporte', async () => {
    const res = await ask({ path: '/admin/kiosco/clientes?deudores=1', message: 'No veo un cliente' });
    expect(res.status).toBe(201);
    const body = res.body as { id: string; url: string; expiresAt: string };
    expect(body.url).toMatch(new RegExp(`/ayuda/${body.id}$`));
    expect(body.expiresAt).toBe('2026-10-06T15:00:00.000Z');
    const a = await access();
    expect(a.supportWhatsapp).toBe('5491155551234');
    expect(a.openRequest).toMatchObject({ id: body.id, message: 'No veo un cliente' });
  });

  it('la pantalla tiene que ser del admin de ese comercio y el texto, de hasta 500', async () => {
    expect((await ask({ path: '/admin/otro/clientes' })).status).toBe(400);
    expect((await ask({ path: 'https://malo.com/admin/kiosco' })).status).toBe(400);
    expect((await ask({ path: '/admin/kiosco/dashboard', message: 'x'.repeat(501) })).status).toBe(400);
    const imp = await impersonate(app, tokens.support, ownerId);
    expect((await ask({ path: '/admin/kiosco/dashboard' }, imp)).status).toBe(403);
  });

  it('soporte toma el pedido: entra en esa pantalla, queda la toma y el usuario ve el acceso', async () => {
    const id = ((await ask({ path: '/admin/kiosco/clientes', message: '' })).body as { id: string }).id;
    const res = await take(id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ tenantSlug: 'kiosco', path: '/admin/kiosco/clientes', user: { id: ownerId } });
    expect((await take(id, tokens.root)).status).toBe(201); // dos tomas
    const a = await access();
    expect(a.activeNow).toBe(true);
    expect(a.accesses.map((x) => [x.staffName, x.byRequest])).toEqual([['Root', true], ['Ana', true]]);
    const panel = (await request(app).get('/api/platform/help-requests').set(bearer(tokens.support))).body as HelpRequestItem[];
    expect(panel[0]).toMatchObject({ id, status: 'open', userName: 'Juan', tenantName: 'Kiosco X' });
    expect(panel[0]?.takes.map((t) => t.staffName)).toEqual(['Ana', 'Root']);
  });

  it('un acceso libre también se ve, sin "por tu pedido"; los de más de 7 días no', async () => {
    const imp = await impersonate(app, tokens.support, ownerId);
    expect((await access()).accesses).toEqual([{ at: '2026-10-05T15:00:00.000Z', staffName: 'Ana', byRequest: false }]);
    await request(app).delete('/api/impersonations/current').set(bearer(imp));
    expect((await access()).activeNow).toBe(false);
    now = new Date(now.getTime() + 8 * 24 * HOUR);
    expect((await access()).accesses).toEqual([]);
  });

  it('vencido a las 24 h o cerrado por uno nuevo: 410 "Este pedido venció"', async () => {
    const first = ((await ask({ path: '/admin/kiosco/dashboard' })).body as { id: string }).id;
    const second = ((await ask({ path: '/admin/kiosco/dashboard' })).body as { id: string }).id;
    const closed = await take(first);
    expect(closed.status).toBe(410);
    expect((closed.body as { error: string }).error).toBe('Este pedido venció');
    now = new Date(now.getTime() + 25 * HOUR);
    expect((await take(second)).status).toBe(410);
    const panel = (await request(app).get('/api/platform/help-requests').set(bearer(tokens.support))).body as HelpRequestItem[];
    expect(panel.map((r) => [r.id, r.status])).toEqual([[second, 'expired'], [first, 'closed']]);
  });

  it('el panel muestra las últimas 48 h', async () => {
    await ask({ path: '/admin/kiosco/dashboard' });
    now = new Date(now.getTime() + 49 * HOUR);
    expect((await request(app).get('/api/platform/help-requests').set(bearer(tokens.support))).body).toEqual([]);
  });
});
```

En `test/permissions-api.test.ts`, `RUTAS` suma `'POST /help-requests': 'tenant.use',`. En
`test/platform-permissions.test.ts`, `RUTAS` suma `'GET /help-requests': 'staff',`.

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/help-requests-api.test.ts test/permissions-api.test.ts test/platform-permissions.test.ts` → FAIL.

- [ ] **Paso 3: la pantalla del pedido**

```typescript
// src/server/help/help-path.ts
const ADMIN_PATH = /^\/admin(\/[a-z0-9._~%-]+)+\/?(\?[^#\s]*)?$/i;

/**
 * La pantalla de un pedido de ayuda (#23): una URL del admin de ese comercio, sin otro origen ni
 * fragmento. Soporte la abre tal cual al tomar el pedido.
 */
export function isAdminPathOf(path: string, tenantSlug: string): boolean {
  if (path.length > 300 || !ADMIN_PATH.test(path)) return false;
  const prefix = `/admin/${encodeURIComponent(tenantSlug)}`;
  return path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);
}
```

- [ ] **Paso 4: el servicio**

```typescript
// src/server/help/help-request-service.ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { readBillingSettings } from '../billing/settings.ts';
import { IMPERSONATION_IDLE_MS } from '../auth/auth-service.ts';
import { DomainError } from '../errors.ts';
import { isAdminPathOf } from './help-path.ts';
import type { HelpRequestItem, HelpRequestStatus, SupportAccess } from '../../shared/help-types.ts';

const HOUR_MS = 60 * 60 * 1000;
export const HELP_REQUEST_TTL_MS = 24 * HOUR_MS;
const PANEL_WINDOW_MS = 48 * HOUR_MS;
const ACCESS_WINDOW_MS = 7 * 24 * HOUR_MS;

export type OpenHelpRequest = { id: string; tenantId: string; tenantSlug: string; userId: string; path: string };

/** Pedidos de ayuda (#23): vencen a las 24 h, uno abierto por usuario, sin conversación ni cierre manual. */
export class HelpRequestService {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; now: () => Date }) {
    this.db = deps.db;
    this.now = deps.now;
  }

  /** Crea el pedido y cierra el abierto anterior del mismo usuario. */
  create(p: { tenantId: string; userId: string; path: string; message: string }): { id: string; expiresAt: string } {
    const tenant = this.db.prepare('SELECT slug FROM tenants WHERE id = ?').get(p.tenantId) as { slug: string } | undefined;
    if (tenant === undefined) throw new DomainError(404, 'Comercio no encontrado');
    if (!isAdminPathOf(p.path, tenant.slug)) throw new DomainError(400, 'La pantalla del pedido no es de este comercio');
    const now = this.now();
    this.db.prepare('UPDATE help_requests SET closed_at = ? WHERE user_id = ? AND closed_at IS NULL').run(now.toISOString(), p.userId);
    const id = `help_${randomUUID()}`;
    const expiresAt = new Date(now.getTime() + HELP_REQUEST_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO help_requests (id, tenant_id, user_id, path, message, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, p.tenantId, p.userId, p.path, p.message, now.toISOString(), expiresAt);
    return { id, expiresAt };
  }

  /** El pedido si sigue vigente (ni cerrado ni vencido). */
  findOpen(id: string): OpenHelpRequest | undefined {
    const row = this.db
      .prepare(
        `SELECT h.id, h.tenant_id, t.slug, h.user_id, h.path FROM help_requests h JOIN tenants t ON t.id = h.tenant_id
         WHERE h.id = ? AND h.closed_at IS NULL AND h.expires_at > ?`,
      )
      .get(id, this.now().toISOString()) as { id: string; tenant_id: string; slug: string; user_id: string; path: string } | undefined;
    return row === undefined ? undefined : { id: row.id, tenantId: row.tenant_id, tenantSlug: row.slug, userId: row.user_id, path: row.path };
  }

  recordTake(requestId: string, staffUserId: string): void {
    this.db.prepare('INSERT INTO help_request_takes (request_id, staff_user_id, at) VALUES (?, ?, ?)').run(requestId, staffUserId, this.now().toISOString());
  }

  /** La solapa Pedidos: los de las últimas 48 h, con su estado y quién los tomó. */
  listForPanel(): HelpRequestItem[] {
    const now = this.now();
    const rows = this.db
      .prepare(
        `SELECT h.id, h.tenant_id, t.slug, t.name AS tenant_name, h.user_id, u.name AS user_name, h.path, h.message,
           h.created_at, h.expires_at, h.closed_at
         FROM help_requests h JOIN tenants t ON t.id = h.tenant_id JOIN users u ON u.id = h.user_id
         WHERE h.created_at >= ?
         ORDER BY h.created_at DESC, h.rowid DESC`,
      )
      .all(new Date(now.getTime() - PANEL_WINDOW_MS).toISOString()) as {
      id: string; tenant_id: string; slug: string; tenant_name: string; user_id: string; user_name: string; path: string;
      message: string; created_at: string; expires_at: string; closed_at: string | null;
    }[];
    const takes = this.db.prepare(
      `SELECT k.at, COALESCE(s.name, 'Usuario borrado') AS staff_name FROM help_request_takes k
       LEFT JOIN users s ON s.id = k.staff_user_id WHERE k.request_id = ? ORDER BY k.at, k.rowid`,
    );
    return rows.map((r) => {
      const status: HelpRequestStatus = r.closed_at !== null ? 'closed' : r.expires_at <= now.toISOString() ? 'expired' : 'open';
      return {
        id: r.id, tenantId: r.tenant_id, tenantSlug: r.slug, tenantName: r.tenant_name, userId: r.user_id, userName: r.user_name,
        path: r.path, message: r.message, createdAt: r.created_at, expiresAt: r.expires_at, status,
        takes: (takes.all(r.id) as { at: string; staff_name: string }[]).map((k) => ({ staffName: k.staff_name, at: k.at })),
      };
    });
  }

  /** Lo que ve el usuario (#23): su pedido abierto, los accesos de soporte de 7 días y si hay alguien adentro. */
  supportAccess(userId: string): SupportAccess {
    const now = this.now();
    const open = this.db
      .prepare('SELECT id, message, created_at, expires_at FROM help_requests WHERE user_id = ? AND closed_at IS NULL AND expires_at > ? ORDER BY created_at DESC LIMIT 1')
      .get(userId, now.toISOString()) as { id: string; message: string; created_at: string; expires_at: string } | undefined;
    const accesses = this.db
      .prepare(
        `SELECT a.at, COALESCE(s.name, 'Usuario borrado') AS staff_name, a.details FROM audit_log a
         LEFT JOIN users s ON s.id = a.actor_user_id
         WHERE a.action = 'impersonation.started' AND a.target_user_id = ? AND a.at >= ?
         ORDER BY a.at DESC, a.rowid DESC`,
      )
      .all(userId, new Date(now.getTime() - ACCESS_WINDOW_MS).toISOString()) as { at: string; staff_name: string; details: string }[];
    const active = this.db
      .prepare(
        `SELECT 1 FROM sessions s JOIN sessions p ON p.token = s.parent_token
         WHERE s.user_id = ? AND s.impersonator_user_id IS NOT NULL AND s.last_used_at > ? LIMIT 1`,
      )
      .get(userId, new Date(now.getTime() - IMPERSONATION_IDLE_MS).toISOString());
    return {
      supportWhatsapp: readBillingSettings(this.db).supportWhatsapp,
      openRequest: open === undefined ? null : { id: open.id, message: open.message, createdAt: open.created_at, expiresAt: open.expires_at },
      accesses: accesses.map((a) => ({ at: a.at, staffName: a.staff_name, byRequest: 'helpRequestId' in (JSON.parse(a.details) as object) })),
      activeNow: active !== undefined,
    };
  }
}
```

(Si el lint objeta el `JSON.parse(…) as object`, un helper `hasHelpRequest(details: string): boolean`
que parsea a `unknown` y verifica con `typeof`.)

- [ ] **Paso 5: tomar un pedido es una impersonación**

En `ImpersonationService`: el constructor suma `help: HelpRequestService`, y un método nuevo:

```typescript
  /** Toma un pedido de ayuda vigente: entra como quien lo pidió, en esa pantalla, y registra la toma. */
  take(p: { staff: UserSession; parentToken: string; helpRequestId: string }): ImpersonationStart {
    const request = this.help.findOpen(p.helpRequestId);
    if (request === undefined) throw new DomainError(410, 'Este pedido venció');
    const { user, tenant } = this.target(request.userId, request.tenantSlug);
    const started = this.open({ staff: p.staff, parentToken: p.parentToken, user, tenant, path: request.path, helpRequestId: request.id });
    this.help.recordTake(request.id, p.staff.id);
    return started;
  }
```

`DomainStatus` ya incluye 410. En `impersonation-routes.ts`:

```typescript
const startSchema = z.union([
  z.object({ helpRequestId: z.string().trim().min(1) }),
  z.object({ userId: z.string().trim().min(1, 'Falta el usuario'), tenantSlug: z.string().trim().min(1).optional() }),
]);
// …
      const body = parsed.data;
      const base = { staff: req.user, parentToken: req.sessionToken };
      res.status(201).json('helpRequestId' in body ? impersonations.take({ ...base, helpRequestId: body.helpRequestId }) : impersonations.start({ ...base, ...body }));
```

`impersonationServiceDef` pasa `help: c.use(helpRequestServiceDef)`, con
`export const helpRequestServiceDef = fn.singleton((c) => new HelpRequestService({ db: c.use(systemDbDef), now: c.use(clockDef) }));`.

- [ ] **Paso 6: las rutas**

```typescript
// src/server/routes/help-routes.ts
import { Router, type Response } from 'express';
import { z } from '../../shared/zod.ts';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import { requireOwnSession } from '../middleware/own-session-middleware.ts';
import type { HelpRequestService } from '../help/help-request-service.ts';
import { HELP_MESSAGE_MAX, type HelpRequestCreated } from '../../shared/help-types.ts';
import { sendError } from '../errors.ts';

const askSchema = z.object({
  path: z.string().trim().min(1).max(300),
  message: z.string().trim().max(HELP_MESSAGE_MAX, `El mensaje puede tener hasta ${String(HELP_MESSAGE_MAX)} caracteres`).optional(),
});

/** "Pedir ayuda" (#23), en la cadena del comercio: cualquier rol, con su sesión propia. */
export function createHelpRoutes(help: HelpRequestService): Router {
  const router = Router({ mergeParams: true });

  router.post('/help-requests', requirePermission('tenant.use'), requireOwnSession, (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = askSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      const created = help.create({ tenantId: req.activeTenantId ?? '', userId: req.user?.id ?? '', path: parsed.data.path, message: parsed.data.message ?? '' });
      const body: HelpRequestCreated = { ...created, url: `${req.protocol}://${req.get('host') ?? ''}/ayuda/${created.id}` };
      res.status(201).json(body);
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

```typescript
// src/server/routes/me-routes.ts
import { Router, type Response } from 'express';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import type { HelpRequestService } from '../help/help-request-service.ts';

/** Lo del usuario de la sesión (#23): su pedido de ayuda y los accesos de soporte a su cuenta. */
export function createMeRoutes(help: HelpRequestService): Router {
  const router = Router();
  router.get('/support-access', (req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(help.supportAccess(req.user?.id ?? ''));
  });
  return router;
}
```

En `app.ts`: `createHelpRoutes(helpRequests)` al final de la cadena de `/api/tenants/:tenantId` (con
`const helpRequests = rootContainer.use(helpRequestServiceDef);`) y
`app.use('/api/me', requireAdmin, createMeRoutes(helpRequests));`. `PlatformAdminDeps` suma
`help: HelpRequestService` y `createPlatformAdminRoutes` una ruta:

```typescript
  // Pedidos de ayuda de las últimas 48 h (#23)
  router.get('/help-requests', staff, (_req: AuthenticatedAdminRequest, res: Response) => {
    res.status(200).json(deps.help.listForPanel());
  });
```

- [ ] **Paso 7: WhatsApp de soporte en el seed de desarrollo**

En `src/server/seeds/dev-fixtures.ts`:
`/** WhatsApp de soporte de desarrollo (#23): sin uno, "Pedir ayuda" no aparece. */ export const DEV_SUPPORT_WHATSAPP = '5491100000000';`

En `ensureDevData`, después de `ensureUsers`:

```typescript
  // Sin WhatsApp de soporte no hay "Pedir ayuda" (#23); no pisa uno cargado a mano
  if (readBillingSettings(deps.systemDb).supportWhatsapp === '') {
    writeBillingSettings(deps.systemDb, { supportWhatsapp: DEV_SUPPORT_WHATSAPP }, ids.root, new Date().toISOString());
  }
```

(imports de `../billing/settings.ts` y de `DEV_SUPPORT_WHATSAPP`; si `BillingSettingsPatch` no es
parcial, se pasa el patch que su esquema acepte). `test/bootstrap.test.ts` suma
`expect(readBillingSettings(systemDb).supportWhatsapp).toBe(DEV_SUPPORT_WHATSAPP)` en el test del seed.

- [ ] **Paso 8: correr los tests y la suite; commit**

Run: `pnpm vitest run test/help-requests-api.test.ts` → PASS; `pnpm lint && pnpm typecheck && pnpm test`.

```bash
git add src test
git commit -m "feat: pedidos de ayuda con link para soporte, tomas y accesos de los últimos 7 días (#23)"
```

---

## Tarea 6: el cliente con sesión por pestaña (estado y rutas)

**Archivos:**
- Modificar: `src/client/state/auth-state.ts`, `src/client/routing/admin-routes.ts`, `test/client-guards.test.ts`, `test/admin-routes.test.ts`
- Crear: `src/client/state/impersonation-state.ts`
- Test: `test/tab-session.test.ts`

**Interfaces:**
- Produce (`admin-routes.ts`): `Route` suma `{ kind: 'entrar'; userId: string | null; tenantSlug: string | null }` y `{ kind: 'ayuda'; requestId: string }`; `enterUrl(userId: string, tenantSlug?: string): string`; `helpRequestUrl(id: string): string`.
- Produce (`auth-state.ts`):
  ```typescript
  export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  export type Impersonator = { id: string; name: string; globalRole: 'root' | 'support' };
  export type ImpersonationState = { user: AuthUser; impersonator: Impersonator; tenantSlug: string };
  export type ImpersonationStart = ImpersonationState & { token: string; path: string };
  export function setStoragesForTests(next: { local: StorageLike | null; session: StorageLike | null }): void;
  export function loadSessionFromStorage(): void;
  export const impersonationSignal: Signal<ImpersonationState | null>;
  export const isImpersonatingSignal: ReadonlySignal<boolean>;
  export const impersonationEndedSignal: Signal<{ userName: string } | null>;
  export function adoptImpersonation(start: ImpersonationStart): Promise<boolean>;
  export function ownToken(): string | null;
  export function resumeOwnSession(): Promise<boolean>;
  ```
  Se borran `impersonateTenant` y `stopImpersonation` (los tests que los usan se borran o se reescriben acá).
- Produce (`impersonation-state.ts`): `enterStatusSignal`, `enterFromRoute(route)`, `registerEnterEffects()`, `exitImpersonation()`, `openEnterTab(userId, tenantSlug?)`, `openHelpRequestTab(id)`.

- [ ] **Paso 1: los tests que fallan**

```typescript
// test/tab-session.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  adoptImpersonation, currentUserSignal, impersonationEndedSignal, impersonationSignal, isImpersonatingSignal,
  lastTenantIdSignal, loadSessionFromStorage, logout, profileLoadedSignal, registerTenantRouteEffects, rememberTenant,
  resumeOwnSession, setStoragesForTests, tokenSignal, userTenantsSignal, type StorageLike,
} from '../src/client/state/auth-state.ts';
import { apiFetch } from '../src/client/api/client.ts';
import { locationSignal, navigate, setHistoryForTests } from '../src/client/state/route-state.ts';

class MemoryStorage implements StorageLike {
  data = new Map<string, string>();
  writes: string[] = [];
  getItem(k: string): string | null { return this.data.get(k) ?? null; }
  setItem(k: string, v: string): void { this.writes.push(`set ${k}`); this.data.set(k, v); }
  removeItem(k: string): void { this.writes.push(`remove ${k}`); this.data.delete(k); }
}

const juan = { id: 'u-juan', email: 'juan@x.com', name: 'Juan', globalRole: 'user' as const };
const ana = { id: 'u-ana', name: 'Ana', globalRole: 'support' as const };
const start = { token: 'tok-imp', user: juan, impersonator: ana, tenantSlug: 'kiosco', path: '/admin/kiosco/clientes' };
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const path = (): string => `${locationSignal.value.pathname}${locationSignal.value.search}`;

describe('sesión por pestaña (#23, M7b)', () => {
  let local: MemoryStorage;
  let session: MemoryStorage;

  beforeEach(() => {
    setHistoryForTests(null);
    local = new MemoryStorage();
    session = new MemoryStorage();
    local.data.set('mini_erp_token', 'tok-soporte');
    local.data.set('mini_erp_tenant_id', 't-viejo');
    setStoragesForTests({ local, session });
    loadSessionFromStorage();
    impersonationEndedSignal.value = null;
    navigate('/');
    vi.restoreAllMocks();
  });

  it('sin impersonación, el token es el de localStorage', () => {
    expect(tokenSignal.value).toBe('tok-soporte');
    expect(isImpersonatingSignal.value).toBe(false);
    expect(lastTenantIdSignal.value).toBe('t-viejo');
  });

  it('lee primero el sessionStorage de la pestaña', () => {
    session.data.set('mini_erp_impersonation', JSON.stringify(start));
    loadSessionFromStorage();
    expect(tokenSignal.value).toBe('tok-imp');
    expect(impersonationSignal.value).toEqual({ user: juan, impersonator: ana, tenantSlug: 'kiosco' });
    expect(lastTenantIdSignal.value).toBeNull();
  });

  it('un sessionStorage roto se ignora', () => {
    session.data.set('mini_erp_impersonation', '{"token":1}');
    loadSessionFromStorage();
    expect(tokenSignal.value).toBe('tok-soporte');
    expect(isImpersonatingSignal.value).toBe(false);
  });

  it('adoptar la impersonación escribe solo el sessionStorage y lleva a la pantalla', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ user: juan, impersonator: ana, tenants: [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco X', status: 'active', role: 'owner' }] }));
    await adoptImpersonation(start);
    expect(tokenSignal.value).toBe('tok-imp');
    expect(path()).toBe('/admin/kiosco/clientes');
    rememberTenant('k');
    expect(local.writes).toEqual([]);
    expect(JSON.parse(session.data.get('mini_erp_impersonation') ?? '{}')).toEqual(start);
  });

  it('un 401 impersonando borra solo el sessionStorage y avisa que terminó', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(ok({ user: juan, impersonator: ana, tenants: [] }));
    await adoptImpersonation(start);
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'x' }), { status: 401, headers: { 'content-type': 'application/json' } }));
    await expect(apiFetch('auth/me', { token: 'tok-imp' })).rejects.toThrow();
    expect(impersonationEndedSignal.value).toEqual({ userName: 'Juan' });
    expect(session.data.has('mini_erp_impersonation')).toBe(false);
    expect(local.data.get('mini_erp_token')).toBe('tok-soporte');
    expect(local.writes).toEqual([]);
    expect(tokenSignal.value).toBeNull();
  });

  it('volver a la sesión propia usa el token de localStorage y va a /plataforma', async () => {
    impersonationEndedSignal.value = { userName: 'Juan' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ user: { ...ana, email: 'ana@x.com' }, impersonator: null, tenants: [] }));
    await resumeOwnSession();
    expect(tokenSignal.value).toBe('tok-soporte');
    expect(impersonationEndedSignal.value).toBeNull();
    expect(path()).toBe('/plataforma');
  });

  it('sin impersonar, logout sí borra el localStorage', () => {
    logout();
    expect(local.data.has('mini_erp_token')).toBe(false);
  });

  it('root o soporte sin comercios: /admin lleva a /plataforma', () => {
    const dispose = registerTenantRouteEffects();
    currentUserSignal.value = { id: 'r', email: 'root@x.com', name: 'Root', globalRole: 'root' };
    userTenantsSignal.value = [];
    profileLoadedSignal.value = true;
    navigate('/admin');
    expect(path()).toBe('/plataforma');
    dispose();
  });
});
```

En `test/admin-routes.test.ts`, casos nuevos:

```typescript
  it('las rutas de la impersonación: entrar y tomar un pedido (#23)', () => {
    expect(parseLocation('/plataforma/entrar', '?usuario=u-1&comercio=kiosco')).toEqual({ kind: 'entrar', userId: 'u-1', tenantSlug: 'kiosco' });
    expect(parseLocation('/plataforma/entrar', '')).toEqual({ kind: 'entrar', userId: null, tenantSlug: null });
    expect(parseLocation('/ayuda/help_abc', '')).toEqual({ kind: 'ayuda', requestId: 'help_abc' });
    expect(enterUrl('u-1', 'kiosco')).toBe('/plataforma/entrar?usuario=u-1&comercio=kiosco');
    expect(enterUrl('u-1')).toBe('/plataforma/entrar?usuario=u-1');
    expect(helpRequestUrl('help_abc')).toBe('/ayuda/help_abc');
  });
```

En `test/client-guards.test.ts`:

```typescript
  it('solo auth-state toca el sessionStorage (#23)', () => {
    const offenders = files.filter((f) => f !== 'state/auth-state.ts' && /sessionStorage/.test(read(f)));
    expect(offenders).toEqual([]);
  });
```

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/tab-session.test.ts test/admin-routes.test.ts test/client-guards.test.ts` → FAIL.

- [ ] **Paso 3: las rutas**

En `src/client/routing/admin-routes.ts`:

```typescript
export type EnterRoute = { kind: 'entrar'; userId: string | null; tenantSlug: string | null };
export type HelpRoute = { kind: 'ayuda'; requestId: string };
export type Route = { kind: 'landing' | 'alta' | 'invitacion' | 'restablecer' } | AdminRoute | PlatformRoute | EnterRoute | HelpRoute;
```

En `parseLocation`, antes del bloque de `plataforma`:

```typescript
  // Impersonación (#23): la pestaña nueva que entra como un usuario, y el link de un pedido de ayuda
  if (first === 'plataforma' && second === 'entrar' && third === undefined) {
    const p = readSearch(search);
    return { kind: 'entrar', userId: p['usuario'] ?? null, tenantSlug: p['comercio'] ?? null };
  }
  if (first === 'ayuda' && second !== undefined && third === undefined) return { kind: 'ayuda', requestId: decodeSlug(second) };
```

En `buildUrl`:

```typescript
    case 'entrar': {
      const query = new URLSearchParams(params({ usuario: route.userId ?? undefined, comercio: route.tenantSlug ?? undefined })).toString();
      return query === '' ? '/plataforma/entrar' : `/plataforma/entrar?${query}`;
    }
    case 'ayuda':
      return `/ayuda/${encodeURIComponent(route.requestId)}`;
```

y al final:

```typescript
/** La pestaña que entra como un usuario (#23); sin comercio, el servidor elige su membresía más reciente. */
export function enterUrl(userId: string, tenantSlug?: string): string {
  return buildUrl({ kind: 'entrar', userId, tenantSlug: tenantSlug ?? null });
}

export function helpRequestUrl(id: string): string {
  return buildUrl({ kind: 'ayuda', requestId: id });
}
```

(Otros `switch` exhaustivos sobre `route.kind` que el typecheck marque, por ejemplo en `route-state.ts`
o `App.tsx`, reciben los dos casos: no se canonizan y, en `App`, los ve la Tarea 7.)

- [ ] **Paso 4: el almacenamiento por pestaña en `auth-state.ts`**

Reemplaza `getStorage`, `getStoredToken`, `setStoredToken`, `getStoredTenantId`, `setStoredTenantId`,
`impersonationSignal`, `isImpersonatingSignal`, `impersonateTenant` y `stopImpersonation`:

```typescript
import { z } from '../../shared/zod.ts';
import { navigate } from './route-state.ts';

const TOKEN_KEY = 'mini_erp_token';
const TENANT_KEY = 'mini_erp_tenant_id';
/** La impersonación de la pestaña (#23): solo en su sessionStorage, que `noopener` no hereda. */
const IMPERSONATION_KEY = 'mini_erp_impersonation';

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type Impersonator = { id: string; name: string; globalRole: 'root' | 'support' };
export type ImpersonationState = { user: AuthUser; impersonator: Impersonator; tenantSlug: string };
export type ImpersonationStart = ImpersonationState & { token: string; path: string };

const storedImpersonationSchema = z.object({
  token: z.string().min(1),
  user: z.object({ id: z.string(), email: z.string(), name: z.string(), globalRole: z.enum(['root', 'support', 'user']) }),
  impersonator: z.object({ id: z.string(), name: z.string(), globalRole: z.enum(['root', 'support']) }),
  tenantSlug: z.string(),
});

function browserStorage(kind: 'localStorage' | 'sessionStorage'): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window[kind];
  } catch {
    return null; // Navegador sin almacenamiento
  }
}

let storages: { local: StorageLike | null; session: StorageLike | null } = {
  local: browserStorage('localStorage'),
  session: browserStorage('sessionStorage'),
};

/** Los tests corren sin navegador: le pasan almacenamientos en memoria. */
export function setStoragesForTests(next: { local: StorageLike | null; session: StorageLike | null }): void {
  storages = next;
}

function readImpersonation(): (ImpersonationState & { token: string }) | null {
  const raw = storages.session?.getItem(IMPERSONATION_KEY) ?? null;
  if (raw === null) return null;
  try {
    const parsed = storedImpersonationSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** El token de la sesión propia (la de soporte en una pestaña que impersona). */
export function ownToken(): string | null {
  return storages.local?.getItem(TOKEN_KEY) ?? null;
}

export const tokenSignal = signal<string | null>(null);
export const impersonationSignal = signal<ImpersonationState | null>(null);
export const isImpersonatingSignal = computed<boolean>(() => impersonationSignal.value !== null);
/** La impersonación de la pestaña terminó (venció, salió o cerró soporte): "La sesión como Juan terminó". */
export const impersonationEndedSignal = signal<{ userName: string } | null>(null);
// (currentUserSignal, userTenantsSignal, etc., como hoy)
export const lastTenantIdSignal = signal<string | null>(null);

/** Lee la sesión de la pestaña: primero su impersonación, después la propia. */
export function loadSessionFromStorage(): void {
  const imp = readImpersonation();
  if (imp !== null) {
    tokenSignal.value = imp.token;
    impersonationSignal.value = { user: imp.user, impersonator: imp.impersonator, tenantSlug: imp.tenantSlug };
    lastTenantIdSignal.value = null;
    return;
  }
  impersonationSignal.value = null;
  tokenSignal.value = ownToken();
  lastTenantIdSignal.value = storages.local?.getItem(TENANT_KEY) ?? null;
}

loadSessionFromStorage();

/** Una pestaña que impersona nunca escribe el localStorage (#23): es de la sesión de soporte. */
function writeLocal(key: string, value: string | null): void {
  if (impersonationSignal.peek() !== null) return;
  if (value === null) storages.local?.removeItem(key);
  else storages.local?.setItem(key, value);
}

export function rememberTenant(tenantId: string | null): void {
  lastTenantIdSignal.value = tenantId;
  writeLocal(TENANT_KEY, tenantId);
}
```

`login` y `adoptSession` usan `writeLocal(TOKEN_KEY, token)` en lugar de `setStoredToken` y ponen
`impersonationEndedSignal.value = null`. El resto:

```typescript
// Un 401 con sesión (#23): impersonando, solo termina la pestaña y se avisa
setOnUnauthorized(() => {
  const imp = impersonationSignal.peek();
  if (imp !== null) impersonationEndedSignal.value = { userName: imp.user.name };
  logout();
});

/** Suelta la impersonación de la pestaña: borra su sessionStorage, nunca el localStorage. */
function dropImpersonation(): void {
  storages.session?.removeItem(IMPERSONATION_KEY);
  impersonationSignal.value = null;
}

export function logout(): void {
  queryClient.clear();
  if (impersonationSignal.peek() !== null) {
    dropImpersonation();
  } else {
    writeLocal(TOKEN_KEY, null);
    writeLocal(TENANT_KEY, null);
  }
  tokenSignal.value = null;
  currentUserSignal.value = null;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  lastTenantIdSignal.value = null;
  authErrorSignal.value = null;
}

/** "Cerrar sesión": también en el servidor, así mueren las impersonaciones hijas (#23). */
export function signOut(): void {
  const token = tokenSignal.peek();
  if (token !== null) void apiFetch('auth/logout', { method: 'POST', token }).catch(() => undefined);
  logout();
  navigate('/admin');
}

/** La pestaña pasa a ser la impersonación que dio el servidor y va a su pantalla. */
export async function adoptImpersonation(start: ImpersonationStart): Promise<boolean> {
  queryClient.clear();
  storages.session?.setItem(IMPERSONATION_KEY, JSON.stringify(start));
  impersonationSignal.value = { user: start.user, impersonator: start.impersonator, tenantSlug: start.tenantSlug };
  impersonationEndedSignal.value = null;
  tokenSignal.value = start.token;
  currentUserSignal.value = start.user;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  lastTenantIdSignal.value = null;
  navigate(start.path, { replace: true });
  return fetchProfile();
}

/** Vuelve a la sesión propia de la pestaña (después de "Salir" o de que terminó la impersonación). */
export async function resumeOwnSession(): Promise<boolean> {
  queryClient.clear();
  dropImpersonation();
  impersonationEndedSignal.value = null;
  loadSessionFromStorage();
  currentUserSignal.value = null;
  userTenantsSignal.value = [];
  profileLoadedSignal.value = false;
  navigate('/plataforma');
  return fetchProfile();
}
```

`selectTenant` deja de tocar la impersonación. `homeTenantSlugSignal` mira primero la pestaña:

```typescript
export const homeTenantSlugSignal = computed<string | null>(() => {
  const current = activeTenantSignal.value;
  if (current !== null) return current.slug;
  const tenants = userTenantsSignal.value;
  const imp = impersonationSignal.value;
  const entry = imp === null ? undefined : tenants.find((t) => t.slug === imp.tenantSlug);
  return (entry ?? tenants.find((t) => t.tenantId === lastTenantIdSignal.value) ?? tenants[0])?.slug ?? null;
});
```

y `registerTenantRouteEffects`, en `stopHome`:

```typescript
    const home = homeTenantSlugSignal.value;
    if (home !== null) navigate(adminUrl(home, 'dashboard'), { replace: true });
    // Root y soporte no tienen comercios propios (#16): su casa es la plataforma
    else if (isRootOrSupportSignal.value && !isImpersonatingSignal.value) navigate('/plataforma', { replace: true });
```

`fetchProfile` no cambia (el `/auth/me` de una impersonación ya devuelve al usuario impersonado).
Los tests viejos de `impersonateTenant`/`stopImpersonation`/`impersonationSignal` en
`test/auth-client-state.test.ts`, `test/active-tenant.test.ts`, `test/app-shell-and-navigation.test.ts`
y `test/credits-client.test.ts` se borran o pasan a la forma nueva
(`impersonationSignal.value = { user, impersonator, tenantSlug }`).

- [ ] **Paso 5: entrar y salir (`impersonation-state.ts`)**

```typescript
// src/client/state/impersonation-state.ts
import { effect, signal } from '@preact/signals';
import { ApiError, apiFetch } from '../api/client.ts';
import {
  adoptImpersonation, currentUserSignal, isImpersonatingSignal, ownToken, resumeOwnSession, tokenSignal, type ImpersonationStart,
} from './auth-state.ts';
import { routeSignal } from './route-state.ts';
import { enterUrl, helpRequestUrl, type EnterRoute, type HelpRoute } from '../routing/admin-routes.ts';

/**
 * Impersonación de usuario por pestaña (#23): "Entrar como" y los links de pedidos de ayuda abren una
 * pestaña nueva con `noopener` (no hereda el sessionStorage), que pide la impersonación con la sesión
 * propia de soporte y la guarda en el suyo.
 */
export type EnterStatus =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'not-staff' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

export const enterStatusSignal = signal<EnterStatus>({ kind: 'idle' });

export async function enterFromRoute(route: EnterRoute | HelpRoute): Promise<void> {
  const token = ownToken();
  const role = currentUserSignal.peek()?.globalRole;
  if (token === null) return;
  if (role !== 'root' && role !== 'support') {
    enterStatusSignal.value = { kind: 'not-staff' };
    return;
  }
  if (route.kind === 'entrar' && route.userId === null) {
    enterStatusSignal.value = { kind: 'error', message: 'Falta el usuario' };
    return;
  }
  enterStatusSignal.value = { kind: 'working' };
  const body = route.kind === 'ayuda'
    ? { helpRequestId: route.requestId }
    : { userId: route.userId, ...(route.tenantSlug === null ? {} : { tenantSlug: route.tenantSlug }) };
  try {
    const start = await apiFetch<ImpersonationStart>('impersonations', { method: 'POST', token, body });
    enterStatusSignal.value = { kind: 'idle' };
    await adoptImpersonation(start);
  } catch (err: unknown) {
    enterStatusSignal.value = err instanceof ApiError && err.status === 410
      ? { kind: 'expired' }
      : { kind: 'error', message: err instanceof Error ? err.message : 'No se pudo entrar' };
  }
}

/** En `/plataforma/entrar` y `/ayuda/<id>`, con la sesión de soporte cargada, pide la impersonación una vez. */
export function registerEnterEffects(): () => void {
  return effect(() => {
    const route = routeSignal.value;
    if ((route.kind !== 'entrar' && route.kind !== 'ayuda') || currentUserSignal.value === null || isImpersonatingSignal.value) return;
    if (enterStatusSignal.peek().kind !== 'idle') return;
    void enterFromRoute(route);
  });
}

/** "Salir": termina la impersonación y cierra la pestaña; si el navegador no la cierra, vuelve a /plataforma. */
export async function exitImpersonation(): Promise<void> {
  const token = tokenSignal.peek();
  if (token !== null) await apiFetch('impersonations/current', { method: 'DELETE', token }).catch(() => undefined);
  if (typeof window !== 'undefined') window.close();
  await resumeOwnSession();
}

function openTab(url: string): void {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener');
}

export function openEnterTab(userId: string, tenantSlug?: string): void {
  openTab(enterUrl(userId, tenantSlug));
}

export function openHelpRequestTab(id: string): void {
  openTab(helpRequestUrl(id));
}

if (typeof window !== 'undefined') {
  registerEnterEffects();
}
```

Test en `test/tab-session.test.ts` (mismo `describe`):

```typescript
  it('entrar pide la impersonación con el token propio y la adopta', async () => {
    currentUserSignal.value = { id: 'u-ana', email: 'ana@x.com', name: 'Ana', globalRole: 'support' };
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify(start), { status: 201, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(ok({ user: juan, impersonator: ana, tenants: [] }));
    await enterFromRoute({ kind: 'ayuda', requestId: 'help_1' });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('/api/impersonations');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe('Bearer tok-soporte');
    expect(init?.body).toBe(JSON.stringify({ helpRequestId: 'help_1' }));
    expect(tokenSignal.value).toBe('tok-imp');
  });

  it('un pedido vencido avisa "venció"', async () => {
    currentUserSignal.value = { id: 'u-ana', email: 'ana@x.com', name: 'Ana', globalRole: 'support' };
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Este pedido venció' }), { status: 410, headers: { 'content-type': 'application/json' } }));
    await enterFromRoute({ kind: 'ayuda', requestId: 'help_1' });
    expect(enterStatusSignal.value).toEqual({ kind: 'expired' });
  });
```

(import de `enterFromRoute` y `enterStatusSignal` desde `../src/client/state/impersonation-state.ts`;
el `beforeEach` suma `enterStatusSignal.value = { kind: 'idle' }`.)

- [ ] **Paso 6: correr los tests, la suite y el build; commit**

Run: `pnpm vitest run test/tab-session.test.ts` → PASS; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
(`ImpersonationModal`, `AppShell` y `Header` usan lo borrado: si el typecheck lo marca acá, se sacan
esas referencias con lo mínimo y la Tarea 7 hace la UI.)

```bash
git add src/client test
git commit -m "feat: la pestaña que impersona guarda su sesión en sessionStorage y nunca escribe localStorage (#23)"
```

---

## Tarea 7: la UI de la impersonación

**Archivos:**
- Crear: `src/client/components/shell/ImpersonationBar.tsx`, `src/client/components/shell/ImpersonationEndedView.tsx`, `src/client/components/platform/EnterView.tsx`
- Modificar: `src/client/App.tsx`, `src/client/components/shell/AppShell.tsx`, `src/client/components/shell/Header.tsx`, `src/client/components/shell/NoAccessView.tsx`, `src/client/components/settings/AccountSection.tsx`, `src/client/components/platform/UsersTab.tsx`, `src/client/components/platform/TenantDetailView.tsx`, `src/client/state/suspension-state.ts`, `src/client/state/navigation-state.ts`, `src/client/state/link-pages-state.ts`
- Borrar: `src/client/components/shell/ImpersonationModal.tsx`
- Test: `test/impersonation-client.test.ts`

**Interfaces:**
- Consume: `impersonationSignal`, `isImpersonatingSignal`, `impersonationEndedSignal`, `resumeOwnSession`, `enterStatusSignal`, `exitImpersonation`, `openEnterTab` (Tarea 6).
- Produce: `impersonationBarText(state, tenant): string`; `canEnterAs(user: PlatformUserItem): boolean` (en `UsersTab.tsx`).

- [ ] **Paso 1: los tests que fallan**

```typescript
// test/impersonation-client.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { impersonationBarText } from '../src/client/components/shell/ImpersonationBar.tsx';
import { canEnterAs } from '../src/client/components/platform/UsersTab.tsx';
import { suspendedNoticeSignal } from '../src/client/state/suspension-state.ts';
import { currentUserSignal, impersonationSignal, logout, profileLoadedSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import { navigate, setHistoryForTests } from '../src/client/state/route-state.ts';
import type { PlatformUserItem } from '../src/shared/platform-types.ts';

const juan = { id: 'u-juan', email: 'juan@x.com', name: 'Juan', globalRole: 'user' as const };
const ana = { id: 'u-ana', name: 'Ana', globalRole: 'support' as const };

describe('UI de la impersonación (#23, M7b)', () => {
  beforeEach(() => {
    setHistoryForTests(null);
    logout();
  });

  it('la franja dice como quién, con qué rol y en qué comercio', () => {
    expect(impersonationBarText({ user: juan, impersonator: ana, tenantSlug: 'kiosco' }, { name: 'Kiosco X', role: 'owner' })).toBe(
      'Estás viendo como Juan (owner de Kiosco X)',
    );
    expect(impersonationBarText({ user: juan, impersonator: ana, tenantSlug: 'kiosco' }, null)).toBe('Estás viendo como Juan');
  });

  it('"Entrar como": cuentas user activas con algún comercio activo', () => {
    const base: PlatformUserItem = {
      id: 'u', name: 'U', email: 'u@x.com', whatsapp: null, globalRole: 'user', status: 'active', createdAt: '2026-10-01',
      tenants: [{ id: 'k', slug: 'k', name: 'K', role: 'owner', status: 'active' }],
    };
    expect(canEnterAs(base)).toBe(true);
    expect(canEnterAs({ ...base, status: 'disabled' })).toBe(false);
    expect(canEnterAs({ ...base, globalRole: 'support' })).toBe(false);
    expect(canEnterAs({ ...base, tenants: [] })).toBe(false);
    expect(canEnterAs({ ...base, tenants: [{ id: 'k', slug: 'k', name: 'K', role: 'owner', status: 'disabled' }] })).toBe(false);
  });

  it('impersonando, un comercio suspendido no tapa el admin', () => {
    currentUserSignal.value = juan;
    userTenantsSignal.value = [{ tenantId: 'k', slug: 'kiosco', name: 'Kiosco X', status: 'suspended', role: 'owner' }];
    profileLoadedSignal.value = true;
    navigate('/admin/kiosco/dashboard');
    expect(suspendedNoticeSignal.value).toBe(true);
    impersonationSignal.value = { user: juan, impersonator: ana, tenantSlug: 'kiosco' };
    expect(suspendedNoticeSignal.value).toBe(false);
  });
});
```

En `test/app-shell-and-navigation.test.ts` se borran los tests del modal de impersonación
(`openImpersonationModal`/`closeImpersonationModal`) y de `impersonateTenant`.

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/impersonation-client.test.ts` → FAIL.

- [ ] **Paso 3: la franja y las vistas nuevas**

```tsx
// src/client/components/shell/ImpersonationBar.tsx
import { activeTenantSignal, impersonationSignal, type ImpersonationState } from '../../state/auth-state.ts';
import { exitImpersonation } from '../../state/impersonation-state.ts';
import type { TenantRole } from '../../../shared/permissions.ts';

export function impersonationBarText(state: ImpersonationState, tenant: { name: string; role: TenantRole } | null): string {
  const base = `Estás viendo como ${state.user.name}`;
  return tenant === null ? base : `${base} (${tenant.role} de ${tenant.name})`;
}

/** La franja fija de una pestaña que impersona (#23): como quién y "Salir". */
export function ImpersonationBar() {
  const state = impersonationSignal.value;
  if (state === null) return null;
  return (
    <div role="status" class="bg-amber-500/15 border-b border-amber-500/30 px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-800 dark:text-amber-200 z-40 sticky top-0 backdrop-blur-md">
      <span class="flex items-center gap-2">
        <span class="inline-block w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse" />
        <strong>{impersonationBarText(state, activeTenantSignal.value)}</strong>
        <span class="text-amber-700/80 dark:text-amber-300/80">· {state.impersonator.name}</span>
      </span>
      <button
        type="button"
        onClick={() => void exitImpersonation()}
        class="px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 rounded-lg font-semibold transition-colors cursor-pointer"
      >
        Salir
      </button>
    </div>
  );
}
```

```tsx
// src/client/components/shell/ImpersonationEndedView.tsx
import { impersonationEndedSignal, resumeOwnSession } from '../../state/auth-state.ts';
import { Button } from '../ui/Button.tsx';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';

/** La impersonación de la pestaña terminó (#23): la sesión de soporte sigue, en /plataforma. */
export function ImpersonationEndedView() {
  const ended = impersonationEndedSignal.value;
  return (
    <LinkPageFrame title={`La sesión como ${ended?.userName ?? 'el usuario'} terminó`}>
      <Button onClick={() => void resumeOwnSession()}>Ir a la plataforma</Button>
    </LinkPageFrame>
  );
}
```

```tsx
// src/client/components/platform/EnterView.tsx
import { enterStatusSignal } from '../../state/impersonation-state.ts';
import { navigate } from '../../state/route-state.ts';
import { platformUrl } from '../../routing/admin-routes.ts';
import { Button } from '../ui/Button.tsx';
import { LinkPageFrame } from '../links/LinkPageFrame.tsx';

/** `/plataforma/entrar` y `/ayuda/<id>` (#23): mientras se abre la impersonación, o por qué no. */
export function EnterView() {
  const status = enterStatusSignal.value;
  if (status.kind === 'not-staff') return <LinkPageFrame title="Este link es para soporte" />;
  if (status.kind === 'expired') {
    return (
      <LinkPageFrame title="Este pedido venció">
        <Button onClick={() => { navigate(platformUrl('users')); }}>Ir a Usuarios</Button>
      </LinkPageFrame>
    );
  }
  if (status.kind === 'error') return <LinkPageFrame title="No se pudo entrar">{status.message}</LinkPageFrame>;
  return <LinkPageFrame title="Entrando…" />;
}
```

(`LinkPageFrame` se usa con las props que tenga: si no acepta `title`/`children` así, se adapta la
llamada sin cambiar su comportamiento.)

- [ ] **Paso 4: App, shell, cabecera y configuración**

- `App.tsx`: después de los links de invitación/restablecimiento y del alta:
  ```tsx
  if (impersonationEndedSignal.value !== null) return <ImpersonationEndedView />;
  // Sin sesión, el login en la misma URL: al entrar se abre esa pantalla (#59)
  if (!isAuthenticatedSignal.value) return <AuthView />;
  // Impersonación (#23): la pestaña nueva pide la sesión como el usuario
  if (route.kind === 'entrar' || route.kind === 'ayuda') return <EnterView />;
  ```
  (con el import de `impersonation-state.ts` para que registre su efecto).
- `AppShell.tsx`: se borran el banner viejo, `handleStopImpersonating` y `<ImpersonationModal />`; arriba
  de `<CreditsBanner />` va `<ImpersonationBar />`. El estado vacío "Crear mi comercio" se muestra solo
  si `!isRootOrSupportSignal.value` (root y soporte van a `/plataforma`).
- `Header.tsx`: se borra "Impersonar comercio…" (y `openImpersonationModal`); "Crear nuevo comercio…"
  y el botón "Cerrar sesión" van envueltos en `{!isImpersonatingSignal.value && (…)}`; el subtítulo del
  comercio usa `ROLE_LABEL[activeTenant.role]`.
- `navigation-state.ts`: se borran `impersonationModalOpenSignal`, `openImpersonationModal` y `closeImpersonationModal`.
- Se borra `components/shell/ImpersonationModal.tsx`.
- `NoAccessView.tsx`: para root y soporte, un segundo botón:
  ```tsx
  {isRootOrSupportSignal.value && slug !== null && (
    <Button variant="outline" onClick={() => { navigate(platformTenantUrl(slug)); }}>Ver este comercio en la plataforma</Button>
  )}
  ```
  (`const slug = currentTenantSlugSignal.value;`).
- `AccountSection.tsx`: impersonando, en lugar del formulario de contraseña, un texto
  "No disponible mientras ves como otro usuario".
- `suspension-state.ts`: suma `!isImpersonatingSignal.value &&` y el comentario lo dice.
- `link-pages-state.ts`: aceptar una invitación (de comercio o de soporte) con la pestaña impersonando
  pone `linkErrorSignal.value = 'No disponible mientras ves como otro usuario'` y no llama a la API.

- [ ] **Paso 5: "Entrar como" en el panel**

En `UsersTab.tsx`:

```typescript
/** "Entrar como" (#23): cuentas user activas con algún comercio activo. */
export function canEnterAs(user: PlatformUserItem): boolean {
  return user.globalRole === 'user' && user.status === 'active' && user.tenants.some((t) => t.status === 'active');
}
```

y en `UserActions`, antes de "Link de restablecimiento":
`{canEnterAs(user) && <Button size="sm" onClick={() => { openEnterTab(user.id); }}>Entrar como</Button>}`
(se muestra aunque `canManageAccount` sea falso: sacar ese `return null` temprano para este botón).

En `TenantDetailView.tsx`, `Members` suma una columna con
`{m.status === 'active' && <Button size="sm" onClick={() => { openEnterTab(m.userId, props.detail.tenant.slug); }}>Entrar como</Button>}`.

- [ ] **Paso 6: correr los tests, la suite y el build; commit**

Run: `pnpm vitest run test/impersonation-client.test.ts` → PASS; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
`test/overlay-guard.test.ts` y `test/brand.test.ts` tienen que seguir en verde.

```bash
git add -A src/client test
git commit -m "feat: franja \"Estás viendo como\", Salir y \"Entrar como\" en una pestaña nueva (#23)"
```

---

## Tarea 8: pedidos de ayuda en el cliente y la auditoría con los dos nombres

**Archivos:**
- Crear: `src/client/state/help-state.ts`, `src/client/components/help/HelpModal.tsx`, `src/client/components/platform/HelpRequestsTab.tsx`
- Modificar: `src/client/state/query-keys.ts`, `src/client/routing/admin-routes.ts` (solapa `requests`), `src/client/components/platform/PlatformView.tsx`, `src/client/state/platform-panel-state.ts`, `src/client/components/shell/Header.tsx`, `src/client/state/users-state.ts`, `src/client/components/users/ActivityList.tsx`, `src/client/components/platform/AuditTab.tsx`, `test/admin-routes.test.ts`
- Test: `test/help-client.test.ts`

**Interfaces:**
- Consume: `SupportAccess`, `HelpRequestItem`, `HelpRequestCreated`, `HELP_MESSAGE_MAX` (Tarea 5); `openHelpRequestTab` (Tarea 6).
- Produce (`help-state.ts`): `helpModalOpenSignal`, `supportAccessSignal`, `canAskHelpSignal`, `helpWhatsappUrl(p)`, `accessText(item, now)`, `sendHelpRequest(message)`, `registerHelpEffects()`.
- Produce (`query-keys.ts`): `meKey(name: 'support-access'): QueryKey`; `PlatformQueryName` suma `'help-requests'`.
- Produce (`users-state.ts`): `auditActorText(e: { actorName: string; impersonatorName: string | null }): string`.

- [ ] **Paso 1: los tests que fallan**

```typescript
// test/help-client.test.ts
import { describe, it, expect } from 'vitest';
import { accessText, helpWhatsappUrl } from '../src/client/state/help-state.ts';
import { auditActorText } from '../src/client/state/users-state.ts';
import { formatDate, formatTime } from '../src/client/format.ts';

describe('pedidos de ayuda en el cliente (#23, M7b)', () => {
  it('el WhatsApp lleva quién, de qué comercio, el mensaje y el link', () => {
    const url = helpWhatsappUrl({ phone: '+54 9 11 5555-1234', userName: 'Juan', tenantName: 'Kiosco X', message: 'No veo un cliente', link: 'https://mini.contax.ar/ayuda/help_1' });
    expect(url.startsWith('https://wa.me/5491155551234?text=')).toBe(true);
    expect(decodeURIComponent(url.split('text=')[1] ?? '')).toBe('Hola, soy Juan de Kiosco X. No veo un cliente https://mini.contax.ar/ayuda/help_1');
    const sinMensaje = helpWhatsappUrl({ phone: '5491155551234', userName: 'Juan', tenantName: 'Kiosco X', message: '  ', link: 'L' });
    expect(decodeURIComponent(sinMensaje.split('text=')[1] ?? '')).toBe('Hola, soy Juan de Kiosco X. L');
  });

  it('los accesos dicen quién entró, a qué hora y si fue por el pedido', () => {
    const now = new Date('2026-10-05T18:00:00.000Z');
    const hoy = '2026-10-05T13:32:00.000Z';
    expect(accessText({ at: hoy, staffName: 'Ana', byRequest: true }, now)).toBe(`Soporte (Ana) entró a las ${formatTime(hoy)} por tu pedido`);
    expect(accessText({ at: hoy, staffName: 'Ana', byRequest: false }, now)).toBe(`Soporte (Ana) entró a las ${formatTime(hoy)}`);
    const antes = '2026-10-03T13:32:00.000Z';
    expect(accessText({ at: antes, staffName: 'Ana', byRequest: false }, now)).toBe(`Soporte (Ana) entró el ${formatDate(antes)} a las ${formatTime(antes)}`);
  });

  it('la auditoría muestra "Ana (soporte) como Juan"', () => {
    expect(auditActorText({ actorName: 'Juan', impersonatorName: 'Ana' })).toBe('Ana (soporte) como Juan');
    expect(auditActorText({ actorName: 'Juan', impersonatorName: null })).toBe('Juan');
  });
});
```

En `test/admin-routes.test.ts`: `parseLocation('/plataforma/pedidos', '')` da
`{ kind: 'plataforma', tab: 'requests', tenantSlug: null, params: {} }` y `platformUrl('requests')` es `/plataforma/pedidos`.

- [ ] **Paso 2: correrlos y ver que fallan**

Run: `pnpm vitest run test/help-client.test.ts test/admin-routes.test.ts` → FAIL.

- [ ] **Paso 3: el estado**

En `query-keys.ts`:
```typescript
/** Lo del usuario de la sesión (#23), sin comercio. */
export function meKey(name: 'support-access'): QueryKey {
  return ['me', name];
}
```
y `PlatformQueryName` suma `'help-requests'`.

```typescript
// src/client/state/help-state.ts
import { computed, effect, signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { createSignalQuery, type QuerySource } from '../api/query-client.ts';
import { activeTenantSignal, currentUserSignal, isImpersonatingSignal, tokenSignal } from './auth-state.ts';
import { locationSignal } from './route-state.ts';
import { meKey } from './query-keys.ts';
import { showToast } from './toast-state.ts';
import { formatDate, formatTime } from '../format.ts';
import type { HelpRequestCreated, SupportAccess, SupportAccessItem } from '../../shared/help-types.ts';

/**
 * "Pedir ayuda" (#23): el usuario manda a soporte por WhatsApp un link a su pedido y ve los accesos
 * de soporte a su cuenta. Se consulta al entrar, al volver a la pestaña y cada 60 s con el modal abierto.
 */
export const helpModalOpenSignal = signal<boolean>(false);
export const helpMessageSignal = signal<string>('');
export const helpSendingSignal = signal<boolean>(false);

const isOwnUser = (): boolean => currentUserSignal.value?.globalRole === 'user' && !isImpersonatingSignal.value;

const supportAccessQuery = createSignalQuery<SupportAccess>({
  source: (): QuerySource<SupportAccess> | null => {
    const token = tokenSignal.value;
    if (token === null || !isOwnUser()) return null;
    return { key: meKey('support-access'), fn: () => apiFetch<SupportAccess>('me/support-access', { token }) };
  },
});

export const supportAccessSignal = computed<SupportAccess | null>(() => supportAccessQuery.data.value ?? null);

/** El botón aparece con un comercio activo, sin impersonar y con un WhatsApp de soporte configurado. */
export const canAskHelpSignal = computed<boolean>(
  () => isOwnUser() && activeTenantSignal.value !== null && (supportAccessSignal.value?.supportWhatsapp ?? '') !== '',
);

export function helpWhatsappUrl(p: { phone: string; userName: string; tenantName: string; message: string; link: string }): string {
  const message = p.message.trim();
  const text = `Hola, soy ${p.userName} de ${p.tenantName}. ${message === '' ? '' : `${message} `}${p.link}`;
  return `https://wa.me/${p.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return formatDate(a.toISOString()) === formatDate(b.toISOString());
}

export function accessText(item: SupportAccessItem, now: Date): string {
  const when = sameLocalDay(new Date(item.at), now)
    ? `a las ${formatTime(item.at)}`
    : `el ${formatDate(item.at)} a las ${formatTime(item.at)}`;
  return `Soporte (${item.staffName}) entró ${when}${item.byRequest ? ' por tu pedido' : ''}`;
}

export async function sendHelpRequest(): Promise<boolean> {
  const token = tokenSignal.peek();
  const tenant = activeTenantSignal.peek();
  const user = currentUserSignal.peek();
  const phone = supportAccessSignal.peek()?.supportWhatsapp ?? '';
  if (token === null || tenant === null || user === null || phone === '') return false;
  helpSendingSignal.value = true;
  try {
    const { pathname, search } = locationSignal.peek();
    const created = await apiFetch<HelpRequestCreated>(`tenants/${encodeURIComponent(tenant.tenantId)}/help-requests`, {
      method: 'POST',
      token,
      body: { path: `${pathname}${search}`, message: helpMessageSignal.peek() },
    });
    window.open(helpWhatsappUrl({ phone, userName: user.name, tenantName: tenant.name, message: helpMessageSignal.peek(), link: created.url }), '_blank', 'noopener');
    helpMessageSignal.value = '';
    await supportAccessQuery.refetch();
    return true;
  } catch (err: unknown) {
    showToast({ type: 'error', title: 'No se pudo pedir ayuda', message: err instanceof Error ? err.message : 'Error inesperado' });
    return false;
  } finally {
    helpSendingSignal.value = false;
  }
}

/** Con el modal abierto, los accesos se refrescan cada 60 s. */
export function registerHelpEffects(): () => void {
  return effect(() => {
    if (!helpModalOpenSignal.value) return;
    const id = setInterval(() => void supportAccessQuery.refetch(), 60_000);
    return () => { clearInterval(id); };
  });
}

if (typeof window !== 'undefined') {
  registerHelpEffects();
}
```

En `users-state.ts`:
```typescript
/** El actor de una línea de auditoría (#23): "Ana (soporte) como Juan" si fue impersonando. */
export function auditActorText(e: { actorName: string; impersonatorName: string | null }): string {
  return e.impersonatorName === null ? e.actorName : `${e.impersonatorName} (soporte) como ${e.actorName}`;
}
```
y `AUDIT_LABEL` suma `'impersonation.started': 'entró como'` y `'impersonation.ended': 'salió de la cuenta de'`.

- [ ] **Paso 4: la UI del usuario**

```tsx
// src/client/components/help/HelpModal.tsx
import { accessText, helpMessageSignal, helpModalOpenSignal, helpSendingSignal, sendHelpRequest, supportAccessSignal } from '../../state/help-state.ts';
import { HELP_MESSAGE_MAX } from '../../../shared/help-types.ts';
import { formatTime } from '../../format.ts';
import { Button } from '../ui/Button.tsx';
import { Modal } from '../ui/Modal.tsx';

const close = (): void => {
  helpModalOpenSignal.value = false;
};

/** "Pedir ayuda" (#23): el pedido por WhatsApp, el pedido abierto y los accesos de soporte de 7 días. */
export function HelpModal() {
  if (!helpModalOpenSignal.value) return null;
  const access = supportAccessSignal.value;
  const now = new Date();
  return (
    <Modal
      isOpen
      onClose={close}
      title="Pedir ayuda"
      subtitle="Le escribimos a soporte por WhatsApp con un link a esta pantalla."
      maxWidth="md"
      footer={
        <>
          <Button variant="outline" onClick={close}>Cerrar</Button>
          <Button loading={helpSendingSignal.value} onClick={() => void sendHelpRequest()}>Escribir a soporte por WhatsApp</Button>
        </>
      }
    >
      <div class="space-y-4">
        <label class="block text-xs font-semibold text-slate-700 dark:text-slate-200">
          ¿En qué te ayudamos? (opcional)
          <textarea
            class="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-2 text-sm"
            rows={3}
            maxLength={HELP_MESSAGE_MAX}
            value={helpMessageSignal.value}
            onInput={(e) => { helpMessageSignal.value = e.currentTarget.value; }}
          />
        </label>
        {access?.openRequest != null && (
          <p class="text-xs text-slate-600 dark:text-slate-300">Tu pedido está abierto hasta las {formatTime(access.openRequest.expiresAt)}.</p>
        )}
        <div class="space-y-1">
          <h3 class="text-xs font-bold text-slate-700 dark:text-slate-200">Accesos de soporte de los últimos 7 días</h3>
          {access === null || access.accesses.length === 0 ? (
            <p class="text-xs text-slate-500">Soporte no entró a tu cuenta.</p>
          ) : (
            <ul class="text-xs text-slate-600 dark:text-slate-300 space-y-0.5">
              {access.accesses.map((a) => <li key={a.at}>{accessText(a, now)}</li>)}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

(Con `!== null` explícito si el lint objeta `!= null`; el textarea usa el componente de la casa si hay uno.)

En `Header.tsx`, a la izquierda del `ThemeToggle`:

```tsx
{supportAccessSignal.value?.activeNow === true && !isImpersonatingSignal.value && (
  <span role="status" class="text-[11px] font-semibold px-2 py-1 rounded-lg bg-amber-500/15 text-amber-700 dark:text-amber-300">
    Soporte está viendo tu cuenta
  </span>
)}
{canAskHelpSignal.value && (
  <Button size="sm" variant="outline" onClick={() => { helpModalOpenSignal.value = true; }}>Pedir ayuda</Button>
)}
```

y `<HelpModal />` al final del `AppShell` (junto a `PageToasts`).

- [ ] **Paso 5: la solapa Pedidos y el registro**

- `admin-routes.ts`: `PLATFORM_TABS` suma `{ id: 'requests', slug: 'pedidos' }` después de `users`.
- `platform-panel-state.ts`: `platformTabIs` acepta `'requests'`, y:
  ```typescript
  const helpRequestsQuery = createSignalQuery<HelpRequestItem[]>({
    source: (): QuerySource<HelpRequestItem[]> | null => {
      const t = tokenSignal.value;
      if (t === null) return null;
      return { key: platformKey('help-requests'), fn: () => apiFetch<HelpRequestItem[]>('/api/platform/help-requests', { token: t }) };
    },
    enabled: () => platformTabIs('requests'),
    onError: (err) => { fail(err, 'No se pudieron cargar los pedidos'); },
  });
  export const helpRequestsSignal = computed<HelpRequestItem[]>(() => helpRequestsQuery.data.value ?? []);
  export const helpRequestsLoadingSignal = helpRequestsQuery.isLoading;
  ```
- `HelpRequestsTab.tsx`: una tabla con Quién (`userName`), Comercio (`tenantName`), Pantalla (`path`),
  Mensaje, Hace (`formatDateTime(createdAt)`), Estado (Abierto / Vencido / Cerrado) y Tomado por
  (`takes.map((t) => \`${t.staffName} ${formatTime(t.at)}\`).join(', ')`), y para los abiertos un botón
  "Atender" que llama a `openHelpRequestTab(r.id)`. Vacío: "Sin pedidos en las últimas 48 h".
- `PlatformView.tsx`: `TABS` suma `{ id: 'requests', label: 'Pedidos', rootOnly: false }` después de
  Usuarios y `{tab === 'requests' && <HelpRequestsTab />}`. (`PlatformTab` en `platform-state.ts`, si
  es una unión propia, suma `'requests'`.)
- `ActivityList.tsx` y `AuditTab.tsx`: el `<strong>` del actor muestra `auditActorText(e)`.

- [ ] **Paso 6: correr los tests, la suite y el build; commit**

Run: `pnpm vitest run test/help-client.test.ts test/admin-routes.test.ts` → PASS; `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
`test/browser-format.test.ts` tiene que seguir en verde (nada de `Intl` fuera de `format.ts`).

```bash
git add -A src/client test
git commit -m "feat: \"Pedir ayuda\" por WhatsApp, accesos de soporte, solapa Pedidos y auditoría \"soporte como usuario\" (#23)"
```

---

## Tarea 9: e2e del criterio de aceptación

**Archivos:**
- Crear: `e2e/support-tabs.spec.ts`

- [ ] **Paso 1: el e2e**

```typescript
// e2e/support-tabs.spec.ts
import { expect, test, type Page } from '@playwright/test';

/**
 * Criterio de aceptación de M7 (#23): soporte atiende dos pedidos a la vez en dos pestañas, cada una
 * como un usuario distinto, sin que se pisen; el usuario ve que soporte entró; el registro muestra
 * "soporte como usuario"; root ya no ve comercios ajenos como propios (#16). Usa el seed de desarrollo.
 */
const KIOSCO = 'kiosco-don-pepe';
const FERRETERIA = 'ferreteria-el-tornillo';

test('soporte atiende dos pedidos en dos pestañas sin que se pisen', async ({ browser, request }) => {
  const login = async (email: string): Promise<string> =>
    ((await (await request.post('/api/auth/login', { data: { email, password: 'admin123' } })).json()) as { token: string }).token;
  const withToken = async (page: Page, token: string) => {
    await page.addInitScript((t) => {
      window.localStorage.setItem('mini_erp_token', t);
    }, token);
  };

  // Dueño A pide ayuda desde Clientes del Kiosco (por la UI; WhatsApp no se abre de verdad)
  const ownerA = await browser.newContext();
  await ownerA.route('https://wa.me/**', (route) => route.fulfill({ body: 'WhatsApp' }));
  const pa = await ownerA.newPage();
  await withToken(pa, await login('dueno-a@local.test'));
  await pa.goto(`/admin/${KIOSCO}/clientes`);
  await pa.getByRole('button', { name: 'Pedir ayuda' }).click();
  await pa.getByLabel(/En qué te ayudamos/).fill('No veo un cliente');
  const waPage = ownerA.waitForEvent('page');
  await pa.getByRole('button', { name: 'Escribir a soporte por WhatsApp' }).click();
  const text = new URL((await waPage).url()).searchParams.get('text') ?? '';
  const linkA = /\/ayuda\/[\w-]+/.exec(text)?.[0];
  expect(linkA).toBeDefined();

  // Dueño B pide ayuda desde Catálogo de la Ferretería (por la API)
  const tokenB = await login('dueno-b@local.test');
  const askB = await request.post(`/api/tenants/${FERRETERIA}/help-requests`, {
    headers: { Authorization: `Bearer ${tokenB}` },
    data: { path: `/admin/${FERRETERIA}/catalogo`, message: 'Precios' },
  });
  expect(askB.status()).toBe(201);
  const linkB = new URL(((await askB.json()) as { url: string }).url).pathname;

  // Soporte abre los dos links en dos pestañas del mismo navegador (comparten localStorage)
  const sup = await browser.newContext();
  const supportToken = await login('soporte@local.test');
  const p1 = await sup.newPage();
  await withToken(p1, supportToken);
  const p2 = await sup.newPage();
  await withToken(p2, supportToken);
  await p1.goto(linkA ?? '');
  await p2.goto(linkB);
  await expect(p1).toHaveURL(new RegExp(`/admin/${KIOSCO}/clientes`));
  await expect(p2).toHaveURL(new RegExp(`/admin/${FERRETERIA}/catalogo`));
  await expect(p1.getByText(/Estás viendo como Dueño A/)).toBeVisible();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();

  // Se recargan y se navega intercalado sin que se pisen
  await p1.reload();
  await p2.reload();
  await expect(p1.getByText(/Estás viendo como Dueño A/)).toBeVisible();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();
  await p1.getByRole('link', { name: 'Catálogo & Precios' }).click();
  await p2.getByRole('link', { name: 'Clientes' }).click();
  await expect(p1).toHaveURL(new RegExp(`/admin/${KIOSCO}/catalogo`));
  await expect(p2).toHaveURL(new RegExp(`/admin/${FERRETERIA}/clientes`));
  await expect(p1.getByText(/Estás viendo como Dueño A/)).toBeVisible();

  // Una acción como Dueño A queda con los dos nombres
  const impA = await p1.evaluate(() => (JSON.parse(window.sessionStorage.getItem('mini_erp_impersonation') ?? '{}') as { token: string }).token);
  const invite = await request.post(`/api/tenants/${KIOSCO}/invitations`, {
    headers: { Authorization: `Bearer ${impA}` },
    data: { email: `e2e-${Date.now()}@local.test`, role: 'member' },
  });
  expect(invite.status()).toBe(201);

  // Una sale y la otra sigue
  await p1.getByRole('button', { name: 'Salir' }).click();
  await p2.reload();
  await expect(p2.getByText(/Estás viendo como Dueño B/)).toBeVisible();

  // Dueño A ve que soporte entró y su Actividad muestra "soporte como Dueño A"
  await pa.reload();
  await pa.getByRole('button', { name: 'Pedir ayuda' }).click();
  await expect(pa.getByText(/Soporte \(Soporte Dev\) entró .* por tu pedido/)).toBeVisible();
  await pa.keyboard.press('Escape');
  await pa.goto(`/admin/${KIOSCO}/usuarios`);
  await expect(pa.getByText('Soporte Dev (soporte) como Dueño A').first()).toBeVisible();

  // Root en /admin no ve comercios ajenos y cae en la plataforma
  const rootCtx = await browser.newContext();
  const pr = await rootCtx.newPage();
  await withToken(pr, await login('root@local.test'));
  await pr.goto('/admin');
  await expect(pr).toHaveURL(/\/plataforma$/);

  await ownerA.close();
  await sup.close();
  await rootCtx.close();
});
```

(Los nombres de los links del menú, "Catálogo & Precios" y "Clientes", son los del Sidebar; si el
`getByLabel` del textarea no lo encuentra, se le da `aria-label`. Si la "Salir" de `p1` cierra la
pestaña, no se vuelve a usar `p1`.)

- [ ] **Paso 2: correrlo**

Run: `pnpm test:e2e` (todos; el nuevo y los de antes). Si aparece "database is locked", es #77: se
reintenta una vez y se anota en el informe.

- [ ] **Paso 3: commit**

```bash
git add e2e/support-tabs.spec.ts
git commit -m "test: e2e de soporte atendiendo dos pedidos en dos pestañas (#23)"
```

---

## Tarea 10: cierre

**Archivos:**
- Modificar: `AGENTS.md`, `package.json` (versión)
- Borrar: `docs/superpowers/plans/2026-10-05-m7b-impersonacion.md`

- [ ] **Paso 1: AGENTS.md**

- En "Auth propia": "`root` y `support` no son miembros de ningún comercio (#16): entran impersonando a un usuario".
- En "Roles de comercio": se saca "Root y support impersonando cuentan como `owner` hasta M7".
- En "Plataforma": un bloque **Impersonación de usuario** (#23, M7b): la sesión como fila de `sessions`
  (v8), 2 h sin uso, muere con la padre (`POST /api/auth/logout`), `req.user`/`req.impersonator`,
  `requireOwnSession` y qué corta, `auditActor(req)`, token en `sessionStorage` por pestaña (solo
  `auth-state`, guardián en `test/client-guards.test.ts`), `window.open(…, 'noopener')`, franja y
  "Salir"; y **Pedidos de ayuda**: `help_requests`/`help_request_takes`, 24 h, `/ayuda/<id>`,
  `GET /api/me/support-access`, solapa Pedidos, WhatsApp de soporte del seed de desarrollo.
  Se saca "`audit_log.impersonator_user_id` queda para la impersonación de M7b".
- En "Estado": M7b hecha; sigue M8 (#24).

- [ ] **Paso 2: versión**

Run: `pnpm version minor --no-git-tag-version` → `0.13.0`.

- [ ] **Paso 3: borrar el plan y verificar todo**

```bash
git rm docs/superpowers/plans/2026-10-05-m7b-impersonacion.md
```

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

- [ ] **Paso 4: commit**

```bash
git add AGENTS.md package.json
git commit -m "docs: impersonación de usuario y pedidos de ayuda de M7b en AGENTS.md y versión 0.13.0 (#23)"
```

- [ ] **Paso 5: informe con la prueba manual**

Lista para tildar en el navegador integrado (`.claude/launch.json` con `pnpm dev` en el 4100; si no
existe en el worktree, se crea sin commitear), empezando por la carpeta del worktree y la rama:
"Entrar como" desde Usuarios y desde el detalle de un comercio, la franja y "Salir", dos pestañas
como usuarios distintos, lo que no se puede impersonando, "Pedir ayuda" como Dueño A, tomar el pedido
desde Pedidos, "Soporte está viendo tu cuenta", los accesos en el modal, la Actividad con "(soporte)
como", y root en `/admin` cayendo en `/plataforma`.

- [ ] **Paso 6: PR (con el OK del usuario)**

Push de la rama y PR con "Closes #23" y "Closes #16" en el cuerpo; después del merge, verificar que
los dos issues se cerraron.
