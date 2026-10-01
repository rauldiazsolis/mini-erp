# M2 · Roles de comercio e invitaciones: plan de implementación

> **Para agentes:** se ejecuta con `superpowers:executing-plans`, **tarea por tarea y en la misma
> conversación** (nunca un subagente por tarea, ver `AGENTS.md`). Al terminar cada tarea: chequeos
> locales, commit y frenar para que el usuario la revise. Los pasos usan `- [ ]`.

**Objetivo:** aplicar los roles owner/admin/member en servidor y UI, con invitaciones y
restablecimientos por link, usuarios del comercio, cambio de contraseña, alta atómica sin registro
suelto y auditoría (#19).

**Arquitectura:** una matriz de capacidades compartida (`src/shared/permissions.ts`) que el servidor
aplica por ruta con `requirePermission` y el cliente usa para esconder lo que no se puede hacer.
Servicios de sistema nuevos (contenedor raíz): `AuditLog`, `MembershipService`,
`InvitationService`, `PasswordResetService` y `AltaService`. Tokens de link de un solo uso, hasheados,
en el fragmento de la URL.

**Stack:** Express 4, `node:sqlite`, Hardwired 1.6.2, Zod 3, Preact + signals, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-01-m2-roles-invitaciones-design.md`](../specs/2026-10-01-m2-roles-invitaciones-design.md)

## Restricciones globales

- Todo en español: mensajes de error, UI, commits, comentarios.
- TypeScript estricto: sin `any`; `unknown` solo en fronteras, validado con Zod en la línea siguiente;
  sin `as` ni `!` para callar a `exactOptionalPropertyTypes`.
- Node 24 sin compilar: sin parameter properties, imports relativos con extensión `.ts`/`.tsx`.
- Cliente sin hooks de React: solo signals (`signal`, `computed`, `effect`).
- Contraseña: mínimo **8** caracteres, definido una sola vez en `src/shared/password.ts`.
- Links: vencen a las **48 h**, un solo uso, token en el fragmento (`#t=`), en la base solo el sha256.
- Errores de dominio con estado HTTP: `403` permiso, `404` no existe, `409` conflicto, `410` link que
  ya no sirve.
- TDD: el test primero, verlo fallar, implementar, verlo pasar. Antes de cada commit:
  `pnpm lint && pnpm typecheck && pnpm test` (desde PowerShell); `pnpm build` si se tocó el cliente.
- Commits convencionales en español, terminados en
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `src/shared/permissions.ts` (nuevo) | roles, capacidades, `can`, `assignableRoles`, `effectiveTenantRole` |
| `src/shared/password.ts` (nuevo) | `PASSWORD_MIN_LENGTH`, `passwordSchema`, `PASSWORD_MIN_MESSAGE` |
| `src/server/errors.ts` (nuevo) | `DomainError` y `sendError` |
| `src/server/db/system-db.ts` | esquema 4, tablas nuevas, guard de base vieja |
| `src/server/auth/crypto.ts` | `generateLinkToken`, `hashLinkToken` |
| `src/server/auth/auth-service.ts` | `createUser` (ex `register`), contraseñas, sesiones, membresías activas |
| `src/server/audit/audit-log.ts` (nuevo) | `AuditLog` |
| `src/server/users/membership-service.ts` (nuevo) | rol activo, miembros, cambios de rol y estado, "todo suyo" |
| `src/server/users/invitation-service.ts` (nuevo) | invitaciones |
| `src/server/users/password-reset-service.ts` (nuevo) | restablecimientos |
| `src/server/alta/alta-service.ts` (nuevo) | alta atómica |
| `src/server/alta/slug.ts` (nuevo) | `slugify` |
| `src/server/middleware/permission-middleware.ts` (nuevo) | `requirePermission` |
| `src/server/middleware/tenant-context-middleware.ts` | resuelve `req.tenantRole` |
| `src/server/routes/api-key-routes.ts` (nuevo) | las keys, ahora en la cadena del comercio |
| `src/server/routes/user-routes.ts` (nuevo) | usuarios, invitaciones, restablecer, auditoría |
| `src/server/routes/alta-routes.ts` (nuevo) | `POST /api/alta` |
| `src/server/routes/link-routes.ts` (nuevo) | lookup/accept/complete públicos |
| `src/server/routes/auth-routes.ts` | sin `register`; con `POST /password` |
| `src/server/routes/tenant-routes.ts` | solo `GET /` |
| `src/server/routes/*-routes.ts` | `requirePermission` por ruta |
| `src/client/state/permissions-state.ts` (nuevo) | rol activo y `can` en el cliente |
| `src/client/state/users-state.ts` (nuevo) | vista Usuarios |
| `src/client/state/account-state.ts` (nuevo) | Mi cuenta |
| `src/client/state/link-pages-state.ts` (nuevo) | `/invitacion` y `/restablecer` |
| `src/client/components/users/*` (nuevo) | UsersView, MembersTable, InvitationsTable, InviteModal, LinkReadyModal, ActivityList |
| `src/client/components/settings/AccountSection.tsx` (nuevo) | cambiar la contraseña |
| `src/client/components/links/*` (nuevo) | InvitationView, ResetPasswordView |

---

### Tarea 1: Base compartida, esquema 4 y `AuthService`

**Archivos:**
- Crear: `src/shared/permissions.ts`, `src/shared/password.ts`, `src/server/errors.ts`,
  `test/permissions.test.ts`
- Modificar: `src/server/db/system-db.ts`, `src/server/auth/crypto.ts`,
  `src/server/auth/auth-service.ts`, `scripts/create-root.ts`, `test/db.test.ts`,
  `test/auth-and-tenants.test.ts`, y los tests que llaman a `authService.register(`
  (`bulk-operations`, `catalog-and-branches`, `customer-and-accounts`, `dashboard-summary`,
  `demo-tenants`, `import-export-and-seeds`, `root-bootstrap`, `stock-and-kardex`)

**Interfaces:**
- Produce:
  - `TenantRole = 'owner' | 'admin' | 'member'`;
    `MembershipRole = TenantRole | 'root_impersonator' | 'support_impersonator'`;
    `Capability = 'tenant.use' | 'bulk' | 'settings.manage' | 'users.manage' | 'owners.manage'`.
  - `can(role: TenantRole, cap: Capability): boolean`,
    `assignableRoles(actor: TenantRole): TenantRole[]`,
    `effectiveTenantRole(role: MembershipRole): TenantRole`, `TENANT_ROLES`.
  - `PASSWORD_MIN_LENGTH = 8`, `PASSWORD_MIN_MESSAGE`, `passwordSchema` (Zod).
  - `DomainError(status: 400 | 401 | 403 | 404 | 409 | 410, message)`,
    `sendError(res, err, fallbackStatus)`.
  - `generateLinkToken(): { raw: string; hash: string }`, `hashLinkToken(raw: string): string`.
  - `AuthService`: `createUser({email,password,name}): {token, user}`,
    `createSession(userId): string`, `findUserByEmail(email): {id,email,name} | undefined`,
    `verifyUserPassword(userId, password): boolean`, `setPassword(userId, password): void`,
    `revokeSessions(userId, exceptToken?: string): void`, `deleteUser(userId): void`,
    `changePassword({userId, currentPassword, newPassword, currentToken}): void`.
  - Esquema 4 con `memberships.status`, `invitations`, `password_resets`, `audit_log`.

- [ ] **Paso 0: dependencias**

El worktree no tiene `node_modules`. Desde PowerShell: `pnpm install`, después
`pnpm lint && pnpm typecheck && pnpm test` para ver la base en verde.

- [ ] **Paso 1: test de la matriz compartida**

`test/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { can, assignableRoles, effectiveTenantRole, type Capability, type TenantRole } from '../src/shared/permissions.ts';
import { passwordSchema, PASSWORD_MIN_LENGTH } from '../src/shared/password.ts';

describe('matriz de capacidades (#19)', () => {
  const tabla: Record<Capability, Record<TenantRole, boolean>> = {
    'tenant.use': { owner: true, admin: true, member: true },
    bulk: { owner: true, admin: true, member: false },
    'settings.manage': { owner: true, admin: true, member: false },
    'users.manage': { owner: true, admin: true, member: false },
    'owners.manage': { owner: true, admin: false, member: false },
  };

  for (const [cap, roles] of Object.entries(tabla) as [Capability, Record<TenantRole, boolean>][]) {
    for (const [role, esperado] of Object.entries(roles) as [TenantRole, boolean][]) {
      it(`${role} ${esperado ? 'puede' : 'no puede'} ${cap}`, () => {
        expect(can(role, cap)).toBe(esperado);
      });
    }
  }

  it('owner asigna los tres roles, admin solo admin y member, member ninguno', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'member']);
    expect(assignableRoles('admin')).toEqual(['admin', 'member']);
    expect(assignableRoles('member')).toEqual([]);
  });

  it('root y support impersonando cuentan como owner hasta M7', () => {
    expect(effectiveTenantRole('root_impersonator')).toBe('owner');
    expect(effectiveTenantRole('support_impersonator')).toBe('owner');
    expect(effectiveTenantRole('member')).toBe('member');
  });

  it('la contraseña pide 8 caracteres', () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(passwordSchema.safeParse('1234567').success).toBe(false);
    expect(passwordSchema.safeParse('12345678').success).toBe(true);
  });
});
```

- [ ] **Paso 2: verlo fallar** — `pnpm test test/permissions.test.ts`: falla porque no existen los
  módulos.

- [ ] **Paso 3: implementar**

`src/shared/permissions.ts`:

```ts
/**
 * Roles del comercio y capacidades (#19), compartidos por servidor y cliente. Permisos fijos: nada
 * configurable en el MVP. Root y support impersonando cuentan como owner hasta M7.
 */
export const TENANT_ROLES = ['owner', 'admin', 'member'] as const;
export type TenantRole = (typeof TENANT_ROLES)[number];
export type MembershipRole = TenantRole | 'root_impersonator' | 'support_impersonator';
export type Capability = 'tenant.use' | 'bulk' | 'settings.manage' | 'users.manage' | 'owners.manage';

const MATRIX: Record<Capability, readonly TenantRole[]> = {
  'tenant.use': ['owner', 'admin', 'member'],
  bulk: ['owner', 'admin'],
  'settings.manage': ['owner', 'admin'],
  'users.manage': ['owner', 'admin'],
  'owners.manage': ['owner'],
};

export function can(role: TenantRole, capability: Capability): boolean {
  return MATRIX[capability].includes(role);
}

export function assignableRoles(actor: TenantRole): TenantRole[] {
  if (actor === 'owner') return ['owner', 'admin', 'member'];
  if (actor === 'admin') return ['admin', 'member'];
  return [];
}

export function effectiveTenantRole(role: MembershipRole): TenantRole {
  return role === 'root_impersonator' || role === 'support_impersonator' ? 'owner' : role;
}

export function isTenantRole(value: string): value is TenantRole {
  return (TENANT_ROLES as readonly string[]).includes(value);
}
```

`src/shared/password.ts`:

```ts
import { z } from 'zod';

/** El mismo mínimo para todos (#19): alta, invitación, restablecimiento, cambio y root. */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MIN_MESSAGE = `La contraseña debe tener al menos ${String(PASSWORD_MIN_LENGTH)} caracteres`;
export const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE);
```

`src/server/errors.ts`:

```ts
import type { Response } from 'express';

export type DomainStatus = 400 | 401 | 403 | 404 | 409 | 410;

/** Error de negocio con su estado HTTP: los servicios lo tiran y las rutas lo traducen. */
export class DomainError extends Error {
  status: DomainStatus;
  constructor(status: DomainStatus, message: string) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
  }
}

export function sendError(res: Response, err: unknown, fallbackStatus: number): void {
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(fallbackStatus).json({ error: err instanceof Error ? err.message : 'Error inesperado' });
}
```

En `src/server/auth/crypto.ts` agregar:

```ts
/** Token de un link de invitación o restablecimiento (#19): el crudo va al link, el hash a la base. */
export function generateLinkToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: hashLinkToken(raw) };
}

export function hashLinkToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
```

En `src/server/db/system-db.ts`: `SYSTEM_SCHEMA_VERSION = 4`; en `memberships` agregar
`status TEXT NOT NULL DEFAULT 'active', -- 'active', 'disabled'`; y al final del esquema:

```sql
-- Invitaciones por link (#19): un solo uso, vencen a las 48 h
CREATE TABLE IF NOT EXISTS invitations (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  accepted_at TEXT,
  accepted_by TEXT,
  revoked_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Links de restablecimiento de contraseña (#19)
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,
  created_by TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Auditoría (#19): sin FK al comercio, sobrevive si se borra
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  tenant_id TEXT,
  action TEXT NOT NULL,
  target_user_id TEXT,
  details TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log (tenant_id, at);
```

Y `initSystemDb`:

```ts
export function initSystemDb(db: DatabaseSync): void {
  const versionRow = db.prepare('PRAGMA user_version').get() as { user_version: number };
  const version = versionRow.user_version;
  // Sin migraciones (#19): producción se reinicia; una base de desarrollo vieja se borra
  if (version !== 0 && version < SYSTEM_SCHEMA_VERSION) {
    throw new Error(
      `La base de sistema es de una versión anterior (esquema ${String(version)}): borrá el directorio de datos y volvé a arrancar`,
    );
  }
  if (version !== SYSTEM_SCHEMA_VERSION) {
    db.exec(`PRAGMA user_version = ${String(SYSTEM_SCHEMA_VERSION)}`);
  }
  db.exec(SYSTEM_SCHEMA);
}
```

En `test/db.test.ts` agregar:

```ts
it('frena con una base de sistema de un esquema anterior (#19)', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA user_version = 3');
  expect(() => { initSystemDb(db); }).toThrow(/versión anterior/);
});
```

En `AuthService`: renombrar `register` a `createUser` (mismo cuerpo, mismo error si el mail
existe); hacer pública `createSession`; `listUserTenants` filtra `AND m.status = 'active'` y tipa
`role` como `MembershipRole`; y agregar:

```ts
findUserByEmail(email: string): { id: string; email: string; name: string } | undefined {
  return this.systemDb
    .prepare('SELECT id, email, name FROM users WHERE email = ?')
    .get(email.trim().toLowerCase()) as { id: string; email: string; name: string } | undefined;
}

verifyUserPassword(userId: string, password: string): boolean {
  const row = this.systemDb.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
    | { password_hash: string }
    | undefined;
  return row !== undefined && verifyPassword(password, row.password_hash);
}

setPassword(userId: string, password: string): void {
  this.systemDb.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), userId);
}

/** Cierra las sesiones del usuario, salvo la indicada (la del equipo que cambió la contraseña). */
revokeSessions(userId: string, exceptToken?: string): void {
  if (exceptToken === undefined) {
    this.systemDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return;
  }
  this.systemDb.prepare('DELETE FROM sessions WHERE user_id = ? AND token <> ?').run(userId, exceptToken);
}

/** Deshace un usuario recién creado (alta fallida). */
deleteUser(userId: string): void {
  this.systemDb.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  this.systemDb.prepare('DELETE FROM memberships WHERE user_id = ?').run(userId);
  this.systemDb.prepare('DELETE FROM users WHERE id = ?').run(userId);
}

changePassword(params: { userId: string; currentPassword: string; newPassword: string; currentToken: string }): void {
  if (!this.verifyUserPassword(params.userId, params.currentPassword)) {
    throw new DomainError(400, 'La contraseña actual no es correcta');
  }
  this.setPassword(params.userId, params.newPassword);
  this.revokeSessions(params.userId, params.currentToken);
}
```

En los tests: reemplazar `authService.register(` por `authService.createUser(` (los de
`created.authService.register(` también). En `test/auth-and-tenants.test.ts` agregar:

```ts
it('changePassword cierra las otras sesiones y deja la actual (#19)', () => {
  const a = authService.createUser({ email: 'pepa@kiosco.com', password: 'clave-vieja', name: 'Pepa' });
  const otra = authService.createSession(a.user.id);
  authService.changePassword({ userId: a.user.id, currentPassword: 'clave-vieja', newPassword: 'clave-nueva', currentToken: a.token });
  expect(authService.validateSession(a.token)).toBeDefined();
  expect(authService.validateSession(otra)).toBeUndefined();
  expect(() => {
    authService.changePassword({ userId: a.user.id, currentPassword: 'mal', newPassword: 'otra-clave', currentToken: a.token });
  }).toThrow('La contraseña actual no es correcta');
});

it('una membresía desactivada no da acceso al comercio (#19)', () => {
  const a = authService.createUser({ email: 'ex@kiosco.com', password: 'password123', name: 'Ex' });
  tenantManager.createTenant({ id: 'kiosco-x', slug: 'kiosco-x', name: 'Kiosco X', ownerUserId: a.user.id });
  systemDb.prepare("UPDATE memberships SET status = 'disabled' WHERE user_id = ?").run(a.user.id);
  expect(authService.listUserTenants(a.user.id, 'user')).toEqual([]);
});
```

`scripts/create-root.ts`: `password: passwordSchema` (import de `../src/shared/password.ts`).

- [ ] **Paso 4: verlo pasar** — `pnpm test`: todo en verde (los tests de `/api/auth/register` siguen
  andando porque la ruta todavía existe y llama a `createUser`: cambiar la llamada en
  `auth-routes.ts`).

- [ ] **Paso 5: chequeos y commit**

`pnpm lint && pnpm typecheck && pnpm test`, después:

```bash
git add src/shared src/server/errors.ts src/server/db/system-db.ts src/server/auth scripts/create-root.ts src/server/routes/auth-routes.ts test
git commit -m "feat: matriz de capacidades compartida, esquema 4 y contraseñas en AuthService (#19)"
```

Frenar para la revisión.

---

### Tarea 2: Auditoría y permisos aplicados en todas las rutas del comercio

**Archivos:**
- Crear: `src/server/audit/audit-log.ts`, `src/server/users/membership-service.ts`,
  `src/server/middleware/permission-middleware.ts`, `src/server/routes/api-key-routes.ts`,
  `test/permissions-api.test.ts`, `test/membership-service.test.ts`
- Modificar: `src/server/di/container.ts`, `src/server/middleware/auth-middleware.ts`,
  `src/server/middleware/tenant-context-middleware.ts`, `src/server/app.ts`,
  `src/server/routes/tenant-routes.ts`, `catalog-routes.ts`, `stock-routes.ts`,
  `customer-routes.ts`, `bulk-routes.ts`, `io-routes.ts`, `dashboard-routes.ts`

**Interfaces:**
- Consume: `can`, `effectiveTenantRole`, `TenantRole` (Tarea 1).
- Produce:
  - `AuditAction` (las diez de la spec); `AuditLog.record({actorUserId, tenantId, action,
    targetUserId?, details?}): void`; `AuditLog.listForTenant(tenantId, limit = 200):
    AuditEntry[]` con `AuditEntry = { id, at, action, actorName, targetName: string | null,
    details: Record<string, unknown> }`.
  - `MembershipService.resolveRole(user: UserSession, tenantId): TenantRole | undefined`,
    `getMembership(tenantId, userId): {role: TenantRole; status: MemberStatus} | undefined`,
    `addMembership(tenantId, userId, role): void`, `listMembers(tenantId): MemberRow[]`,
    `isFullyOwnedBy(targetUserId, actorUserId): boolean`, `countActiveOwners(tenantId): number`.
    (`updateMember` llega en la Tarea 4.)
  - `requirePermission(cap): RequestHandler & { capability: Capability }`.
  - `req.tenantRole?: TenantRole` en `AuthenticatedAdminRequest`.
  - Definiciones `auditLogDef`, `membershipServiceDef` en el contenedor.

- [ ] **Paso 1: tests**

`test/membership-service.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { AuthService } from '../src/server/auth/auth-service.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import { AuditLog } from '../src/server/audit/audit-log.ts';
import type { DatabaseSync } from 'node:sqlite';

describe('MembershipService y AuditLog (#19)', () => {
  let systemDb: DatabaseSync;
  let auth: AuthService;
  let tm: TenantManager;
  let members: MembershipService;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    auth = new AuthService(systemDb);
    tm = new TenantManager(systemDb, { inMemory: true });
    members = new MembershipService(systemDb);
  });

  it('resuelve el rol: membresía activa, nada si está desactivada, owner para root', () => {
    const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
    const root = auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' }).user;
    tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: ana.id });
    expect(members.resolveRole(ana, 'kiosco-a')).toBe('owner');
    expect(members.resolveRole(root, 'kiosco-a')).toBe('owner');
    systemDb.prepare("UPDATE memberships SET status = 'disabled'").run();
    expect(members.resolveRole(ana, 'kiosco-a')).toBeUndefined();
  });

  it('isFullyOwnedBy: solo si todas las membresías activas del usuario son en comercios del actor', () => {
    const owner = auth.createUser({ email: 'o@x.com', password: 'password123', name: 'O' }).user;
    const otro = auth.createUser({ email: 'p@x.com', password: 'password123', name: 'P' }).user;
    const emp = auth.createUser({ email: 'e@x.com', password: 'password123', name: 'E' }).user;
    tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: owner.id });
    tm.createTenant({ id: 'kiosco-b', slug: 'kiosco-b', name: 'B', ownerUserId: otro.id });
    members.addMembership('kiosco-a', emp.id, 'member');
    expect(members.isFullyOwnedBy(emp.id, owner.id)).toBe(true);
    members.addMembership('kiosco-b', emp.id, 'member');
    expect(members.isFullyOwnedBy(emp.id, owner.id)).toBe(false);
  });

  it('AuditLog registra y lista con nombres, lo más nuevo primero', () => {
    let t = 0;
    const audit = new AuditLog(systemDb, () => new Date(Date.UTC(2026, 9, 1, 10, t++)));
    const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
    const bob = auth.createUser({ email: 'bob@x.com', password: 'password123', name: 'Bob' }).user;
    audit.record({ actorUserId: ana.id, tenantId: 'kiosco-a', action: 'tenant.created' });
    audit.record({ actorUserId: ana.id, tenantId: 'kiosco-a', action: 'member.disabled', targetUserId: bob.id, details: { role: 'member' } });
    const list = audit.listForTenant('kiosco-a');
    expect(list.map((e) => e.action)).toEqual(['member.disabled', 'tenant.created']);
    expect(list[0]).toMatchObject({ actorName: 'Ana', targetName: 'Bob', details: { role: 'member' } });
  });
});
```

`test/permissions-api.test.ts` (el corazón del criterio de aceptación). Arma un comercio con
owner, admin y member; la tabla `RUTAS` lista **todas** las rutas de la cadena
`/api/tenants/:tenantId` con su capacidad, y un test introspecciona Express:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';
import { MembershipService } from '../src/server/users/membership-service.ts';
import type { Capability } from '../src/shared/permissions.ts';

/** Todas las rutas de la cadena del comercio, con su capacidad (#19). Una ruta nueva va acá. */
const RUTAS: Record<string, Capability> = {
  'GET /branches': 'tenant.use',
  'POST /branches': 'settings.manage',
  'GET /branches/:branchId': 'tenant.use',
  'PUT /branches/:branchId': 'settings.manage',
  'GET /products': 'tenant.use',
  'POST /products': 'tenant.use',
  'GET /products/:productId': 'tenant.use',
  'PUT /products/:productId': 'tenant.use',
  'DELETE /products/:productId': 'tenant.use',
  'GET /categories': 'tenant.use',
  'GET /stock': 'tenant.use',
  'POST /stock/adjust': 'tenant.use',
  'GET /stock/kardex': 'tenant.use',
  'GET /customers': 'tenant.use',
  'POST /customers': 'tenant.use',
  'GET /customers/:customerId': 'tenant.use',
  'PUT /customers/:customerId': 'tenant.use',
  'DELETE /customers/:customerId': 'tenant.use',
  'POST /customers/:customerId/payments': 'tenant.use',
  'POST /customers/:customerId/adjustments': 'tenant.use',
  'GET /customers/:customerId/movements': 'tenant.use',
  'POST /bulk/prices': 'bulk',
  'POST /bulk/interests': 'bulk',
  'GET /export/:entity': 'bulk',
  'POST /import/:entity': 'bulk',
  'GET /dashboard/summary': 'tenant.use',
  'GET /api-keys': 'settings.manage',
  'POST /api-keys': 'settings.manage',
  'DELETE /api-keys/:keyId': 'settings.manage',
};

type Layer = {
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: { capability?: Capability } }[] };
  name: string;
  regexp: RegExp;
  handle: { stack?: Layer[] };
};

/** Rutas declaradas en los routers montados en /api/tenants/:tenantId, con la capacidad que exigen. */
function rutasDelComercio(app: Express): Record<string, Capability | undefined> {
  const raiz = (app as unknown as { _router: { stack: Layer[] } })._router.stack;
  const found: Record<string, Capability | undefined> = {};
  for (const layer of raiz) {
    if (layer.name !== 'router' || !layer.regexp.test('/api/tenants/t1/products')) continue;
    for (const inner of layer.handle.stack ?? []) {
      if (inner.route === undefined) continue;
      for (const method of Object.keys(inner.route.methods)) {
        const cap = inner.route.stack.find((s) => s.handle.capability !== undefined)?.handle.capability;
        found[`${method.toUpperCase()} ${inner.route.path}`] = cap;
      }
    }
  }
  return found;
}

describe('permisos del comercio en la API (#19)', () => {
  let app: Express;
  let tokens: { owner: string; admin: string; member: string };
  const tenantId = 'kiosco-roles';

  beforeEach(() => {
    const systemDb = openSystemDb(':memory:');
    const tenantManager = new TenantManager(systemDb, { inMemory: true });
    const bundle = createApp({ systemDb, tenantManager });
    app = bundle.app;
    const members = new MembershipService(systemDb);
    const owner = bundle.authService.createUser({ email: 'owner@x.com', password: 'password123', name: 'Owner' });
    const admin = bundle.authService.createUser({ email: 'admin@x.com', password: 'password123', name: 'Admin' });
    const member = bundle.authService.createUser({ email: 'member@x.com', password: 'password123', name: 'Member' });
    tenantManager.createTenant({ id: tenantId, slug: tenantId, name: 'Kiosco Roles', ownerUserId: owner.user.id });
    members.addMembership(tenantId, admin.user.id, 'admin');
    members.addMembership(tenantId, member.user.id, 'member');
    tokens = { owner: owner.token, admin: admin.token, member: member.token };
  });

  it('cada ruta del comercio exige exactamente la capacidad de la tabla', () => {
    expect(rutasDelComercio(app)).toEqual(RUTAS);
  });

  it('el member recibe 403 en operaciones masivas, export, sucursales y keys', async () => {
    const auth = { Authorization: `Bearer ${tokens.member}` };
    expect((await request(app).post(`/api/tenants/${tenantId}/bulk/prices`).set(auth).send({ action: 'percentage', value: 10 })).status).toBe(403);
    expect((await request(app).get(`/api/tenants/${tenantId}/export/products`).set(auth)).status).toBe(403);
    expect((await request(app).post(`/api/tenants/${tenantId}/branches`).set(auth).send({ name: 'Otra', code: 'OTRA' })).status).toBe(403);
    expect((await request(app).get(`/api/tenants/${tenantId}/api-keys`).set(auth)).status).toBe(403);
  });

  it('el member opera el día a día: productos, stock, clientes y dashboard', async () => {
    const auth = { Authorization: `Bearer ${tokens.member}` };
    for (const path of ['products', 'stock', 'customers', 'branches', 'dashboard/summary']) {
      expect((await request(app).get(`/api/tenants/${tenantId}/${path}`).set(auth)).status).toBe(200);
    }
  });

  it('el admin maneja keys y masivas', async () => {
    const auth = { Authorization: `Bearer ${tokens.admin}` };
    expect((await request(app).get(`/api/tenants/${tenantId}/api-keys`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/tenants/${tenantId}/export/products`).set(auth)).status).toBe(200);
  });

  it('sin membresía activa: 403 en todo el comercio', async () => {
    const res = await request(app).get(`/api/tenants/otro-comercio/products`).set({ Authorization: `Bearer ${tokens.owner}` });
    expect(res.status).toBe(403);
  });
});
```

(En la Tarea 4 se agregan a `RUTAS` las rutas de usuarios, invitaciones y auditoría.)

- [ ] **Paso 2: verlos fallar** — `pnpm test test/permissions-api.test.ts test/membership-service.test.ts`.

- [ ] **Paso 3: implementar**

`src/server/audit/audit-log.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

export type AuditAction =
  | 'tenant.created'
  | 'invitation.created'
  | 'invitation.revoked'
  | 'invitation.accepted'
  | 'member.role_changed'
  | 'member.disabled'
  | 'member.enabled'
  | 'password.reset_link_created'
  | 'password.reset'
  | 'password.changed';

export type AuditEntry = {
  id: string;
  at: string;
  action: AuditAction;
  actorName: string;
  targetName: string | null;
  details: Record<string, unknown>;
};

/** Registro de auditoría (#19): quién, qué y cuándo. M7 le suma "como quién". */
export class AuditLog {
  private db: DatabaseSync;
  private now: () => Date;

  constructor(db: DatabaseSync, now: () => Date) {
    this.db = db;
    this.now = now;
  }

  record(params: {
    actorUserId: string;
    tenantId: string | null;
    action: AuditAction;
    targetUserId?: string | undefined;
    details?: Record<string, unknown> | undefined;
  }): void {
    this.db
      .prepare(
        'INSERT INTO audit_log (id, at, actor_user_id, tenant_id, action, target_user_id, details) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        `aud_${randomUUID()}`,
        this.now().toISOString(),
        params.actorUserId,
        params.tenantId,
        params.action,
        params.targetUserId ?? null,
        JSON.stringify(params.details ?? {}),
      );
  }

  listForTenant(tenantId: string, limit = 200): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.at, a.action, a.details, actor.name AS actor_name, target.name AS target_name
         FROM audit_log a
         LEFT JOIN users actor ON actor.id = a.actor_user_id
         LEFT JOIN users target ON target.id = a.target_user_id
         WHERE a.tenant_id = ?
         ORDER BY a.at DESC
         LIMIT ?`,
      )
      .all(tenantId, limit) as {
      id: string;
      at: string;
      action: AuditAction;
      details: string;
      actor_name: string | null;
      target_name: string | null;
    }[];
    return rows.map((r) => ({
      id: r.id,
      at: r.at,
      action: r.action,
      actorName: r.actor_name ?? 'Usuario borrado',
      targetName: r.target_name,
      details: parseDetails(r.details),
    }));
  }
}

function parseDetails(raw: string): Record<string, unknown> {
  const value: unknown = JSON.parse(raw);
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
```

`src/server/users/membership-service.ts` (sin `updateMember` todavía):

```ts
import type { DatabaseSync } from 'node:sqlite';
import type { UserSession } from '../auth/auth-service.ts';
import { isTenantRole, type TenantRole } from '../../shared/permissions.ts';

export type MemberStatus = 'active' | 'disabled';

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  role: TenantRole;
  status: MemberStatus;
  joinedAt: string;
};

/** Membresías de los comercios (#19): rol activo, miembros y la regla de "todo suyo". */
export class MembershipService {
  private db: DatabaseSync;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  /** El rol con el que el usuario opera el comercio; root y support, owner hasta M7. */
  resolveRole(user: UserSession, tenantId: string): TenantRole | undefined {
    if (user.globalRole === 'root' || user.globalRole === 'support') {
      const tenant = this.db
        .prepare('SELECT id FROM tenants WHERE id = ? AND id NOT IN (SELECT tenant_id FROM demo_sessions)')
        .get(tenantId);
      return tenant === undefined ? undefined : 'owner';
    }
    const m = this.getMembership(tenantId, user.id);
    return m?.status === 'active' ? m.role : undefined;
  }

  getMembership(tenantId: string, userId: string): { role: TenantRole; status: MemberStatus } | undefined {
    const row = this.db
      .prepare('SELECT role, status FROM memberships WHERE tenant_id = ? AND user_id = ?')
      .get(tenantId, userId) as { role: string; status: string } | undefined;
    if (row === undefined || !isTenantRole(row.role)) return undefined;
    return { role: row.role, status: row.status === 'disabled' ? 'disabled' : 'active' };
  }

  addMembership(tenantId: string, userId: string, role: TenantRole): void {
    this.db
      .prepare("INSERT INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
      .run(userId, tenantId, role, new Date().toISOString());
  }

  listMembers(tenantId: string): MemberRow[] {
    const rows = this.db
      .prepare(
        `SELECT u.id, u.name, u.email, m.role, m.status, m.created_at
         FROM memberships m JOIN users u ON u.id = m.user_id
         WHERE m.tenant_id = ?
         ORDER BY m.created_at ASC`,
      )
      .all(tenantId) as { id: string; name: string; email: string; role: string; status: string; created_at: string }[];
    return rows.flatMap((r) =>
      isTenantRole(r.role)
        ? [{ userId: r.id, name: r.name, email: r.email, role: r.role, status: r.status === 'disabled' ? 'disabled' : 'active', joinedAt: r.created_at }]
        : [],
    );
  }

  countActiveOwners(tenantId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM memberships WHERE tenant_id = ? AND role = 'owner' AND status = 'active'")
      .get(tenantId) as { n: number };
    return row.n;
  }

  /** Todas las membresías activas del usuario están en comercios donde el actor es owner activo. */
  isFullyOwnedBy(targetUserId: string, actorUserId: string): boolean {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM memberships t
         WHERE t.user_id = ? AND t.status = 'active'
           AND NOT EXISTS (
             SELECT 1 FROM memberships a
             WHERE a.tenant_id = t.tenant_id AND a.user_id = ? AND a.role = 'owner' AND a.status = 'active'
           )`,
      )
      .get(targetUserId, actorUserId) as { n: number };
    return row.n === 0;
  }
}
```

`src/server/middleware/permission-middleware.ts`:

```ts
import type { NextFunction, RequestHandler, Response } from 'express';
import { can, type Capability } from '../../shared/permissions.ts';
import type { AuthenticatedAdminRequest } from './auth-middleware.ts';

/**
 * Exige una capacidad del comercio (#19). Va en cada ruta de /api/tenants/:tenantId; lleva la
 * capacidad a la vista para que el test de la matriz la compare con la tabla.
 */
export function requirePermission(capability: Capability): RequestHandler & { capability: Capability } {
  const handler = (req: AuthenticatedAdminRequest, res: Response, next: NextFunction): void => {
    if (req.tenantRole === undefined || !can(req.tenantRole, capability)) {
      res.status(403).json({ error: 'No tenés permiso para esto' });
      return;
    }
    next();
  };
  return Object.assign(handler, { capability });
}
```

`auth-middleware.ts`: en `AuthenticatedAdminRequest` agregar `tenantRole?: TenantRole;`.

`tenant-context-middleware.ts`: recibe `membershipService: MembershipService` en lugar de
`authService` y reemplaza el chequeo de `listUserTenants` por:

```ts
const role = membershipService.resolveRole(req.user, tenantId);
if (role === undefined) {
  res.status(403).json({ error: 'No tienes acceso a este tenant' });
  return;
}
req.tenantRole = role;
```

`container.ts`:

```ts
export const auditLogDef = fn.singleton((c) => new AuditLog(c.use(systemDbDef), c.use(clockDef)));
export const membershipServiceDef = fn.singleton((c) => new MembershipService(c.use(systemDbDef)));
```

(`clockDef` hay que declararlo antes que `auditLogDef`: mover las definiciones nuevas debajo de la
sección de demos.)

Rutas: importar `requirePermission` y ponerlo como segundo argumento de cada ruta, según `RUTAS`.
Ejemplo en `bulk-routes.ts`:

```ts
router.post('/bulk/prices', requirePermission('bulk'), (req: AuthenticatedAdminRequest, res: Response) => {
```

`src/server/routes/api-key-routes.ts`: las tres rutas de keys que hoy están en `tenant-routes.ts`,
movidas a un router con `mergeParams` (rutas `/api-keys`, `/api-keys/:keyId`), con
`requirePermission('settings.manage')`, el `tenantId` de `req.activeTenantId` y sin
`checkTenantAccess`. `createApiKeyRoutes(apiKeyService: ApiKeyService): Router`. `tenant-routes.ts`
pierde las keys y `checkTenantAccess` (queda `GET /` y, hasta la Tarea 3, `POST /`).

`app.ts`: resolver `membershipService` del contenedor, pasarlo a
`createTenantContextMiddleware(membershipService, tenantManager, rootContainer)` y sumar
`createApiKeyRoutes(apiKeyService)` a la cadena de `/api/tenants/:tenantId`.

- [ ] **Paso 4: verlos pasar** — `pnpm test`. Los tests existentes que crean keys por
  `/api/tenants/:id/api-keys` siguen andando (el dueño es owner).

- [ ] **Paso 5: chequeos y commit**

```bash
git add src/server test
git commit -m "feat: la API aplica los roles del comercio en cada ruta y suma la auditoría (#19)"
```

Frenar para la revisión.

---

### Tarea 3: Alta atómica en el servidor, sin registro suelto

**Archivos:**
- Crear: `src/server/alta/alta-service.ts`, `src/server/alta/slug.ts`,
  `src/server/routes/alta-routes.ts`, `test/alta-api.test.ts`
- Modificar: `src/server/routes/auth-routes.ts` (sin `/register`), `src/server/routes/tenant-routes.ts`
  (sin `POST /`), `src/server/routes/io-routes.ts` (sin `/seed-preset`), `src/server/di/container.ts`,
  `src/server/app.ts`; tests que usan `/api/auth/register`, `POST /api/tenants` o `/seed-preset`:
  `auth-and-tenants`, `connector-api`, `demo-sessions-api`, `e2e-pos-sync-lifecycle`,
  `ioc-container`, `rate-limit`, `import-export-and-seeds`

**Interfaces:**
- Consume: `AuthService.createUser/findUserByEmail/deleteUser`, `AuditLog.record`, `DomainError`,
  `passwordSchema`.
- Produce: `AltaTemplate = 'kiosco' | 'almacen' | 'ferreteria' | 'empty'`;
  `AltaService.create(params): AltaResult` con
  `params = { user?: UserSession | undefined; account?: {name,email,password} | undefined; businessName: string; template: AltaTemplate }`
  y `AltaResult = { token?: string; user: UserSession; tenant: { id: string; name: string }; posKey: { key: string; branch: string; pointOfSale: string } }`;
  `POST /api/alta`; `slugify(text): string`; `altaServiceDef`.

- [ ] **Paso 1: tests** — `test/alta-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

type AltaBody = { token?: string; user: { id: string; globalRole: string }; tenant: { id: string }; posKey: { key: string; branch: string; pointOfSale: string } };

describe('alta atómica (#19)', () => {
  let app: Express;
  let systemDb: DatabaseSync;
  let tenantManager: TenantManager;

  beforeEach(() => {
    systemDb = openSystemDb(':memory:');
    tenantManager = new TenantManager(systemDb, { inMemory: true });
    app = createApp({ systemDb, tenantManager }).app;
  });

  const alta = { name: 'Marta', email: 'marta@kiosco.com', password: 'clave-segura', businessName: 'Kiosco Marta', template: 'kiosco' };

  it('crea cuenta, comercio con catálogo, owner y key de Caja 1, y registra la auditoría', async () => {
    const res = await request(app).post('/api/alta').send(alta);
    expect(res.status).toBe(201);
    const body = res.body as AltaBody;
    expect(body.user.globalRole).toBe('user');
    expect(body.tenant.id).toBe('kiosco-marta');
    expect(body.posKey).toMatchObject({ branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(body.posKey.key.startsWith('mpos_')).toBe(true);

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.token ?? ''}`);
    expect((me.body as { tenants: { tenantId: string; role: string }[] }).tenants).toEqual([
      expect.objectContaining({ tenantId: 'kiosco-marta', role: 'owner' }),
    ]);
    const products = tenantManager.getTenantDb('kiosco-marta').prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number };
    expect(products.n).toBeGreaterThan(0);
    const audit = systemDb.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'tenant.created'").get() as { n: number };
    expect(audit.n).toBe(1);
  });

  it('con sesión crea otro comercio para la misma cuenta, sin token nuevo', async () => {
    const first = (await request(app).post('/api/alta').send(alta)).body as AltaBody;
    const res = await request(app)
      .post('/api/alta')
      .set('Authorization', `Bearer ${first.token ?? ''}`)
      .send({ businessName: 'Ferretería Marta', template: 'ferreteria' });
    expect(res.status).toBe(201);
    expect((res.body as AltaBody).token).toBeUndefined();
    expect((res.body as AltaBody).user.id).toBe(first.user.id);
  });

  it('un mail existente sin sesión: 409 y no crea nada', async () => {
    await request(app).post('/api/alta').send(alta);
    const res = await request(app).post('/api/alta').send({ ...alta, businessName: 'Otro' });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe('Ya tenés una cuenta con ese correo: iniciá sesión');
    const tenants = systemDb.prepare('SELECT COUNT(*) AS n FROM tenants').get() as { n: number };
    expect(tenants.n).toBe(1);
  });

  it('pide 8 caracteres de contraseña', async () => {
    const res = await request(app).post('/api/alta').send({ ...alta, password: '1234567' });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe('La contraseña debe tener al menos 8 caracteres');
  });

  it('ya no hay registro suelto ni creación de comercio por fuera del alta', async () => {
    expect((await request(app).post('/api/auth/register').send({ email: 'x@x.com', password: 'password123', name: 'X' })).status).toBe(404);
    const token = ((await request(app).post('/api/alta').send(alta)).body as AltaBody).token ?? '';
    expect((await request(app).post('/api/tenants').set('Authorization', `Bearer ${token}`).send({ id: 'abc', slug: 'abc', name: 'Abc' })).status).toBe(404);
  });
});
```

Migrar los tests existentes: donde hacían `register` + `POST /api/tenants` por HTTP, pasan a
`POST /api/alta` (con `template: 'empty'` si esperaban un comercio vacío) y toman `token`,
`tenant.id` y `posKey.key` del cuerpo. En `rate-limit.test.ts`, el pedido que contaba en el límite
compartido pasa de `/api/auth/register` a `/api/alta` (mismo `send({})` → `400`). En
`import-export-and-seeds.test.ts`, el bloque de `/seed-preset` se reemplaza por uno que llama a
`applyPreset` directo (`src/server/seeds/index.ts`), que es lo que el alta usa.

- [ ] **Paso 2: verlos fallar** — `pnpm test test/alta-api.test.ts`.

- [ ] **Paso 3: implementar**

`src/server/alta/slug.ts`:

```ts
/** Identificador del comercio a partir del nombre; el TenantManager desambigua con -2, -3. */
export function slugify(text: string): string {
  const clean = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return clean.length >= 3 ? clean : `comercio${clean === '' ? '' : `-${clean}`}`;
}
```

`src/server/alta/alta-service.ts`:

```ts
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { TenantManager } from '../db/tenant-manager.ts';
import type { ApiKeyService } from '../tenant/api-key-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { applyPreset } from '../seeds/index.ts';
import { DomainError } from '../errors.ts';
import { slugify } from './slug.ts';

export type AltaTemplate = 'kiosco' | 'almacen' | 'ferreteria' | 'empty';

export type AltaResult = {
  token?: string;
  user: UserSession;
  tenant: { id: string; name: string };
  posKey: { key: string; branch: string; pointOfSale: string };
};

const BRANCH = 'CENTRAL';
const POINT_OF_SALE = 'Caja 1';

/**
 * Alta (#19): la única forma de que nazca una cuenta además de una invitación. Crea cuenta (si no
 * hay sesión), comercio, catálogo del rubro y la key de la primera caja; si algo falla, deshace.
 */
export class AltaService {
  private auth: AuthService;
  private tenants: TenantManager;
  private apiKeys: ApiKeyService;
  private audit: AuditLog;

  constructor(deps: { auth: AuthService; tenants: TenantManager; apiKeys: ApiKeyService; audit: AuditLog }) {
    this.auth = deps.auth;
    this.tenants = deps.tenants;
    this.apiKeys = deps.apiKeys;
    this.audit = deps.audit;
  }

  create(params: {
    user?: UserSession | undefined;
    account?: { name: string; email: string; password: string } | undefined;
    businessName: string;
    template: AltaTemplate;
  }): AltaResult {
    let user = params.user;
    let token: string | undefined;
    let createdUserId: string | undefined;
    let createdTenantId: string | undefined;

    if (user === undefined) {
      if (params.account === undefined) throw new DomainError(400, 'Faltan los datos de la cuenta');
      if (this.auth.findUserByEmail(params.account.email) !== undefined) {
        throw new DomainError(409, 'Ya tenés una cuenta con ese correo: iniciá sesión');
      }
      const created = this.auth.createUser(params.account);
      user = created.user;
      token = created.token;
      createdUserId = created.user.id;
    }

    try {
      const name = params.businessName.trim();
      const slug = slugify(name);
      const tenant = this.tenants.createTenant({ id: slug, slug, name, ownerUserId: user.id, seedDemoData: false });
      createdTenantId = tenant.id;
      if (params.template !== 'empty') {
        applyPreset(this.tenants.getTenantDb(tenant.id), params.template);
      }
      const key = this.apiKeys.createApiKey({ tenantId: tenant.id, name: POINT_OF_SALE, branch: BRANCH, pointOfSale: POINT_OF_SALE });
      this.audit.record({ actorUserId: user.id, tenantId: tenant.id, action: 'tenant.created', details: { template: params.template } });
      return {
        ...(token === undefined ? {} : { token }),
        user,
        tenant: { id: tenant.id, name: tenant.name },
        posKey: { key: key.rawKey, branch: BRANCH, pointOfSale: POINT_OF_SALE },
      };
    } catch (err: unknown) {
      if (createdTenantId !== undefined) this.tenants.deleteTenant(createdTenantId);
      if (createdUserId !== undefined) this.auth.deleteUser(createdUserId);
      throw err;
    }
  }
}
```

`src/server/routes/alta-routes.ts`:

```ts
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { AuthService } from '../auth/auth-service.ts';
import type { AltaService } from '../alta/alta-service.ts';
import { passwordSchema } from '../../shared/password.ts';
import { sendError } from '../errors.ts';

const businessSchema = z.object({
  businessName: z.string().trim().min(2, 'Escribí el nombre de tu comercio'),
  template: z.enum(['kiosco', 'almacen', 'ferreteria', 'empty']),
});

const accountSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres'),
  email: z.string().trim().email('Email inválido'),
  password: passwordSchema,
});

/** POST /api/alta (#19): con sesión crea solo el comercio; sin sesión, cuenta y comercio. */
export function createAltaRoutes(authService: AuthService, altaService: AltaService, limit: RequestHandler): Router {
  const router = Router();

  router.post('/', limit, (req, res) => {
    const header = req.headers.authorization;
    const sessionToken = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const user = sessionToken === undefined ? undefined : authService.validateSession(sessionToken);
    if (sessionToken !== undefined && user === undefined) {
      res.status(401).json({ error: 'Sesión expirada o token inválido' });
      return;
    }

    const business = businessSchema.safeParse(req.body);
    if (!business.success) {
      res.status(400).json({ error: business.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    let account: z.infer<typeof accountSchema> | undefined;
    if (user === undefined) {
      const parsed = accountSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
        return;
      }
      account = parsed.data;
    }

    try {
      res.status(201).json(altaService.create({ user, account, ...business.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

`container.ts`:

```ts
export const altaServiceDef = fn.singleton(
  (c) => new AltaService({ auth: c.use(authServiceDef), tenants: c.use(tenantManagerDef), apiKeys: c.use(apiKeyServiceDef), audit: c.use(auditLogDef) }),
);
```

`app.ts`: `app.use('/api/alta', createAltaRoutes(authService, rootContainer.use(altaServiceDef), authLimit));`.
Borrar `router.post('/register', …)` y `registerSchema` de `auth-routes.ts`, `router.post('/', …)` y
`createTenantSchema` de `tenant-routes.ts`, y `/seed-preset` con `seedPresetSchema` de
`io-routes.ts` (y su entrada en `RUTAS` no existía: nada que tocar).

- [ ] **Paso 4: verlos pasar** — `pnpm test` todo en verde.

- [ ] **Paso 5: chequeos y commit**

```bash
git add src/server test
git commit -m "feat: alta atómica en POST /api/alta y sin registro suelto (#19)"
```

Frenar para la revisión.

---

### Tarea 4: Usuarios e invitaciones en el servidor

**Archivos:**
- Crear: `src/server/users/invitation-service.ts`, `src/server/routes/user-routes.ts`,
  `src/server/routes/link-routes.ts`, `test/users-api.test.ts`, `test/invitations-api.test.ts`
- Modificar: `src/server/users/membership-service.ts` (`updateMember`), `src/server/di/container.ts`,
  `src/server/app.ts`, `test/permissions-api.test.ts` (rutas nuevas en `RUTAS`)

**Interfaces:**
- Consume: `MembershipService`, `AuditLog`, `AuthService`, `generateLinkToken`, `hashLinkToken`,
  `assignableRoles`, `can`, `DomainError`, `sendError`.
- Produce:
  - `MembershipService.updateMember({ tenantId, actor: { userId, role }, targetUserId, role?, status? }): MemberRow`
    (registra la auditoría; por eso el constructor pasa a `new MembershipService(db, audit?)`: con
    `audit` opcional para los tests de la Tarea 2, `AuditLog | undefined`).
  - `InvitationService.create({tenantId, actor:{userId, role}, email, role}): {id, token, expiresAt}`,
    `revoke({tenantId, actor, invitationId}): void`, `listPending(tenantId): PendingInvitation[]`,
    `lookup(token): InvitationInfo`, `accept({token, password, name?}): {token, user, tenantId}`.
  - `PendingInvitation = { id, email, role, createdAt, expiresAt, invitedByName }`.
  - `InvitationInfo = { tenantName, role, email, invitedByName, accountExists, expiresAt }`.
  - `LINK_TTL_MS = 48 * 60 * 60 * 1000` y `LINK_GONE_MESSAGE` exportados desde
    `invitation-service.ts` (los reusa la Tarea 5).
  - Rutas `GET /users`, `POST /invitations`, `DELETE /invitations/:invitationId`,
    `PATCH /users/:userId`, `GET /audit` en la cadena del comercio; `POST /api/invitations/lookup` y
    `/accept`.

- [ ] **Paso 1: tests**

En `test/permissions-api.test.ts`, sumar a `RUTAS`:

```ts
  'GET /users': 'users.manage',
  'POST /invitations': 'users.manage',
  'DELETE /invitations/:invitationId': 'users.manage',
  'PATCH /users/:userId': 'users.manage',
  'GET /audit': 'owners.manage',
```

`test/invitations-api.test.ts` (reloj inyectado con `createApp({ now })` para el vencimiento):

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('invitaciones por link (#19)', () => {
  let app: Express;
  let clock: Date;
  let owner: string;
  let tenantId: string;

  beforeEach(async () => {
    clock = new Date('2026-10-01T10:00:00Z');
    const systemDb = openSystemDb(':memory:');
    app = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }), now: () => clock }).app;
    const res = await request(app).post('/api/alta').send({ name: 'Ana', email: 'ana@k.com', password: 'clave-ana-1', businessName: 'Kiosco Ana', template: 'empty' });
    const body = res.body as { token: string; tenant: { id: string } };
    owner = body.token;
    tenantId = body.tenant.id;
  });

  async function invitar(email: string, role: string, token = owner): Promise<request.Response> {
    return request(app).post(`/api/tenants/${tenantId}/invitations`).set('Authorization', `Bearer ${token}`).send({ email, role });
  }

  it('el owner invita; el link sirve una vez y crea la cuenta con la membresía', async () => {
    const inv = (await invitar('juan@k.com', 'member')).body as { token: string; expiresAt: string };
    expect(inv.expiresAt).toBe('2026-10-03T10:00:00.000Z');

    const info = await request(app).post('/api/invitations/lookup').send({ token: inv.token });
    expect(info.body).toMatchObject({ tenantName: 'Kiosco Ana', role: 'member', email: 'juan@k.com', invitedByName: 'Ana', accountExists: false });

    const acc = await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Juan', password: 'clave-juan-1' });
    expect(acc.status).toBe(200);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${(acc.body as { token: string }).token}`);
    expect((me.body as { tenants: { role: string }[] }).tenants[0]?.role).toBe('member');

    const again = await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Juan', password: 'clave-juan-1' });
    expect(again.status).toBe(410);
  });

  it('con cuenta existente pide su contraseña y suma la membresía', async () => {
    await request(app).post('/api/alta').send({ name: 'Bea', email: 'bea@k.com', password: 'clave-bea-1', businessName: 'Otro', template: 'empty' });
    const inv = (await invitar('bea@k.com', 'admin')).body as { token: string };
    expect(((await request(app).post('/api/invitations/lookup').send({ token: inv.token })).body as { accountExists: boolean }).accountExists).toBe(true);
    expect((await request(app).post('/api/invitations/accept').send({ token: inv.token, password: 'equivocada' })).status).toBe(401);
    expect((await request(app).post('/api/invitations/accept').send({ token: inv.token, password: 'clave-bea-1' })).status).toBe(200);
  });

  it('vence a las 48 h', async () => {
    const inv = (await invitar('juan@k.com', 'member')).body as { token: string };
    clock = new Date('2026-10-03T10:00:01Z');
    expect((await request(app).post('/api/invitations/lookup').send({ token: inv.token })).status).toBe(410);
  });

  it('una invitación nueva al mismo mail revoca la anterior; revocar corta el link', async () => {
    const a = (await invitar('juan@k.com', 'member')).body as { token: string };
    const b = (await invitar('juan@k.com', 'admin')).body as { id: string; token: string };
    expect((await request(app).post('/api/invitations/lookup').send({ token: a.token })).status).toBe(410);
    await request(app).delete(`/api/tenants/${tenantId}/invitations/${b.id}`).set('Authorization', `Bearer ${owner}`);
    expect((await request(app).post('/api/invitations/lookup').send({ token: b.token })).status).toBe(410);
  });

  it('invitar a quien ya es miembro: 409; el admin no invita owners', async () => {
    expect((await invitar('ana@k.com', 'member')).status).toBe(409);
    const inv = (await invitar('adm@k.com', 'admin')).body as { token: string };
    const adm = (await request(app).post('/api/invitations/accept').send({ token: inv.token, name: 'Adm', password: 'clave-adm-1' })).body as { token: string };
    expect((await invitar('otro@k.com', 'owner', adm.token)).status).toBe(403);
    expect((await invitar('otro@k.com', 'member', adm.token)).status).toBe(201);
  });
});
```

`test/users-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

type Users = { members: { userId: string; email: string; role: string; status: string }[]; invitations: { email: string }[] };

describe('usuarios del comercio (#19)', () => {
  let app: Express;
  let tenantId: string;
  const t: Record<'owner' | 'admin' | 'member', string> = { owner: '', admin: '', member: '' };
  const ids: Record<'owner' | 'admin' | 'member', string> = { owner: '', admin: '', member: '' };

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    app = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) }).app;
    const alta = (await request(app).post('/api/alta').send({ name: 'Ana', email: 'ana@k.com', password: 'clave-ana-1', businessName: 'Kiosco Ana', template: 'empty' })).body as { token: string; user: { id: string }; tenant: { id: string } };
    t.owner = alta.token; ids.owner = alta.user.id; tenantId = alta.tenant.id;
    for (const role of ['admin', 'member'] as const) {
      const inv = (await request(app).post(`/api/tenants/${tenantId}/invitations`).set('Authorization', `Bearer ${t.owner}`).send({ email: `${role}@k.com`, role })).body as { token: string };
      const acc = (await request(app).post('/api/invitations/accept').send({ token: inv.token, name: role, password: 'clave-larga-1' })).body as { token: string; user: { id: string } };
      t[role] = acc.token; ids[role] = acc.user.id;
    }
  });

  const patch = (token: string, userId: string, body: object) =>
    request(app).patch(`/api/tenants/${tenantId}/users/${userId}`).set('Authorization', `Bearer ${token}`).send(body);

  it('lista miembros e invitaciones pendientes', async () => {
    await request(app).post(`/api/tenants/${tenantId}/invitations`).set('Authorization', `Bearer ${t.owner}`).send({ email: 'nuevo@k.com', role: 'member' });
    const res = (await request(app).get(`/api/tenants/${tenantId}/users`).set('Authorization', `Bearer ${t.owner}`)).body as Users;
    expect(res.members.map((m) => m.role)).toEqual(['owner', 'admin', 'member']);
    expect(res.invitations.map((i) => i.email)).toEqual(['nuevo@k.com']);
  });

  it('desactivar corta el acceso al instante; reactivar lo devuelve', async () => {
    expect((await patch(t.owner, ids.member, { status: 'disabled' })).status).toBe(200);
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${t.member}`)).status).toBe(403);
    await patch(t.owner, ids.member, { status: 'active' });
    expect((await request(app).get(`/api/tenants/${tenantId}/products`).set('Authorization', `Bearer ${t.member}`)).status).toBe(200);
  });

  it('nadie cambia su propia membresía; el admin no toca owners ni nombra owners', async () => {
    expect((await patch(t.owner, ids.owner, { role: 'admin' })).status).toBe(403);
    expect((await patch(t.admin, ids.owner, { status: 'disabled' })).status).toBe(403);
    expect((await patch(t.admin, ids.member, { role: 'owner' })).status).toBe(403);
    expect((await patch(t.admin, ids.member, { role: 'admin' })).status).toBe(200);
  });

  it('el último owner activo no se baja de rol', async () => {
    await patch(t.owner, ids.admin, { role: 'owner' });
    expect((await patch(t.admin, ids.owner, { role: 'member' })).status).toBe(200);
    // Ahora el ex admin es el único owner, y nadie más puede bajarlo
    expect((await patch(t.owner, ids.admin, { role: 'member' })).status).toBe(403);
  });

  it('el owner ve la auditoría; el admin no', async () => {
    await patch(t.owner, ids.member, { status: 'disabled' });
    const res = await request(app).get(`/api/tenants/${tenantId}/audit`).set('Authorization', `Bearer ${t.owner}`);
    expect((res.body as { action: string }[]).map((e) => e.action)).toContain('member.disabled');
    expect((await request(app).get(`/api/tenants/${tenantId}/audit`).set('Authorization', `Bearer ${t.admin}`)).status).toBe(403);
  });
});
```

Y en `test/membership-service.test.ts`, el guard del último owner a nivel servicio (alcanzable con
root, que opera como owner sin membresía):

```ts
it('el último owner activo no se baja ni se desactiva (409)', () => {
  const ana = auth.createUser({ email: 'ana@x.com', password: 'password123', name: 'Ana' }).user;
  const root = auth.ensureRoot({ email: 'root@x.com', password: 'password123', name: 'Root' }).user;
  tm.createTenant({ id: 'kiosco-a', slug: 'kiosco-a', name: 'A', ownerUserId: ana.id });
  expect(() => members.updateMember({ tenantId: 'kiosco-a', actor: { userId: root.id, role: 'owner' }, targetUserId: ana.id, status: 'disabled' }))
    .toThrow('El comercio necesita al menos un owner activo');
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`MembershipService` suma el constructor `constructor(db: DatabaseSync, audit?: AuditLog | undefined)`
(propiedad `private audit: AuditLog | undefined`), los imports de `can` y `assignableRoles`
(`../../shared/permissions.ts`), `DomainError` (`../errors.ts`) y el tipo `AuditLog`, y:

```ts
updateMember(params: {
  tenantId: string;
  actor: { userId: string; role: TenantRole };
  targetUserId: string;
  role?: TenantRole | undefined;
  status?: MemberStatus | undefined;
}): MemberRow {
  const { tenantId, actor, targetUserId } = params;
  if (targetUserId === actor.userId) throw new DomainError(403, 'No podés cambiar tu propia membresía');
  const current = this.getMembership(tenantId, targetUserId);
  if (current === undefined) throw new DomainError(404, 'El usuario no es miembro de este comercio');

  const touchesOwner = current.role === 'owner' || params.role === 'owner';
  if (touchesOwner && !can(actor.role, 'owners.manage')) {
    throw new DomainError(403, 'Solo un owner puede cambiar a otro owner');
  }
  if (params.role !== undefined && !assignableRoles(actor.role).includes(params.role)) {
    throw new DomainError(403, 'No podés asignar ese rol');
  }
  const losesOwner =
    current.role === 'owner' && current.status === 'active' &&
    ((params.role !== undefined && params.role !== 'owner') || params.status === 'disabled');
  if (losesOwner && this.countActiveOwners(tenantId) <= 1) {
    throw new DomainError(409, 'El comercio necesita al menos un owner activo');
  }

  if (params.role !== undefined && params.role !== current.role) {
    this.db.prepare('UPDATE memberships SET role = ? WHERE tenant_id = ? AND user_id = ?').run(params.role, tenantId, targetUserId);
    this.audit?.record({ actorUserId: actor.userId, tenantId, action: 'member.role_changed', targetUserId, details: { from: current.role, to: params.role } });
  }
  if (params.status !== undefined && params.status !== current.status) {
    this.db.prepare('UPDATE memberships SET status = ? WHERE tenant_id = ? AND user_id = ?').run(params.status, tenantId, targetUserId);
    this.audit?.record({ actorUserId: actor.userId, tenantId, action: params.status === 'disabled' ? 'member.disabled' : 'member.enabled', targetUserId });
  }
  const updated = this.listMembers(tenantId).find((m) => m.userId === targetUserId);
  if (updated === undefined) throw new DomainError(404, 'El usuario no es miembro de este comercio');
  return updated;
}
```

(El test "el último owner" por HTTP termina en `403` porque el que queda solo no puede tocarse a sí
mismo, y el otro ya no es owner; el `409` lo cubre el test del servicio con root.)

`src/server/users/invitation-service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { MembershipService } from './membership-service.ts';
import { generateLinkToken, hashLinkToken } from '../auth/crypto.ts';
import { assignableRoles, isTenantRole, type TenantRole } from '../../shared/permissions.ts';
import { DomainError } from '../errors.ts';

export const LINK_TTL_MS = 48 * 60 * 60 * 1000;
export const LINK_GONE_MESSAGE = 'Este link ya no sirve: pedile uno nuevo a quien te lo mandó';

export type PendingInvitation = { id: string; email: string; role: TenantRole; createdAt: string; expiresAt: string; invitedByName: string };
export type InvitationInfo = { tenantName: string; role: TenantRole; email: string; invitedByName: string; accountExists: boolean; expiresAt: string };

type InvitationRow = { id: string; tenant_id: string; email: string; role: string; expires_at: string; tenant_name: string; invited_by_name: string };

/** Invitaciones por link (#19): un solo uso, 48 h, sin mail. */
export class InvitationService {
  private db: DatabaseSync;
  private auth: AuthService;
  private members: MembershipService;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; auth: AuthService; members: MembershipService; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.members = deps.members;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  create(params: { tenantId: string; actor: { userId: string; role: TenantRole }; email: string; role: TenantRole }): { id: string; token: string; expiresAt: string } {
    if (!assignableRoles(params.actor.role).includes(params.role)) throw new DomainError(403, 'No podés invitar con ese rol');
    const email = params.email.trim().toLowerCase();
    const existing = this.auth.findUserByEmail(email);
    if (existing !== undefined && this.members.getMembership(params.tenantId, existing.id) !== undefined) {
      throw new DomainError(409, 'Ese correo ya es parte del comercio');
    }
    const now = this.now();
    this.db
      .prepare('UPDATE invitations SET revoked_at = ? WHERE tenant_id = ? AND email = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .run(now.toISOString(), params.tenantId, email);
    const id = `inv_${randomUUID()}`;
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO invitations (id, tenant_id, email, role, token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, params.tenantId, email, params.role, hash, params.actor.userId, now.toISOString(), expiresAt);
    this.audit.record({ actorUserId: params.actor.userId, tenantId: params.tenantId, action: 'invitation.created', details: { email, role: params.role } });
    return { id, token: raw, expiresAt };
  }

  revoke(params: { tenantId: string; actor: { userId: string; role: TenantRole }; invitationId: string }): void {
    const row = this.db
      .prepare('SELECT email, role FROM invitations WHERE id = ? AND tenant_id = ? AND accepted_at IS NULL AND revoked_at IS NULL')
      .get(params.invitationId, params.tenantId) as { email: string; role: string } | undefined;
    if (row === undefined) throw new DomainError(404, 'La invitación no existe o ya no está pendiente');
    if (!isTenantRole(row.role) || !assignableRoles(params.actor.role).includes(row.role)) {
      throw new DomainError(403, 'No podés revocar esta invitación');
    }
    this.db.prepare('UPDATE invitations SET revoked_at = ? WHERE id = ?').run(this.now().toISOString(), params.invitationId);
    this.audit.record({ actorUserId: params.actor.userId, tenantId: params.tenantId, action: 'invitation.revoked', details: { email: row.email, role: row.role } });
  }

  listPending(tenantId: string): PendingInvitation[] {
    const rows = this.db
      .prepare(
        `SELECT i.id, i.email, i.role, i.created_at, i.expires_at, u.name AS invited_by_name
         FROM invitations i LEFT JOIN users u ON u.id = i.created_by
         WHERE i.tenant_id = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
         ORDER BY i.created_at DESC`,
      )
      .all(tenantId, this.now().toISOString()) as { id: string; email: string; role: string; created_at: string; expires_at: string; invited_by_name: string | null }[];
    return rows.flatMap((r) =>
      isTenantRole(r.role)
        ? [{ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at, invitedByName: r.invited_by_name ?? '' }]
        : [],
    );
  }

  lookup(token: string): InvitationInfo {
    const row = this.findValid(token);
    if (!isTenantRole(row.role)) throw new DomainError(410, LINK_GONE_MESSAGE);
    return {
      tenantName: row.tenant_name,
      role: row.role,
      email: row.email,
      invitedByName: row.invited_by_name,
      accountExists: this.auth.findUserByEmail(row.email) !== undefined,
      expiresAt: row.expires_at,
    };
  }

  accept(params: { token: string; password: string; name?: string | undefined }): { token: string; user: UserSession; tenantId: string } {
    const row = this.findValid(params.token);
    if (!isTenantRole(row.role)) throw new DomainError(410, LINK_GONE_MESSAGE);
    const role = row.role;
    const existing = this.auth.findUserByEmail(row.email);
    let user: UserSession;
    let sessionToken: string;
    if (existing !== undefined) {
      if (!this.auth.verifyUserPassword(existing.id, params.password)) throw new DomainError(401, 'Contraseña incorrecta');
      if (this.members.getMembership(row.tenant_id, existing.id) !== undefined) throw new DomainError(409, 'Ya sos parte de este comercio');
      sessionToken = this.auth.createSession(existing.id);
      const session = this.auth.validateSession(sessionToken);
      if (session === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
      user = session;
    } else {
      const name = params.name?.trim() ?? '';
      if (name.length < 2) throw new DomainError(400, 'El nombre debe tener al menos 2 caracteres');
      const created = this.auth.createUser({ email: row.email, password: params.password, name });
      user = created.user;
      sessionToken = created.token;
    }
    this.members.addMembership(row.tenant_id, user.id, role);
    this.db.prepare('UPDATE invitations SET accepted_at = ?, accepted_by = ? WHERE id = ?').run(this.now().toISOString(), user.id, row.id);
    this.audit.record({ actorUserId: user.id, tenantId: row.tenant_id, action: 'invitation.accepted', details: { role } });
    return { token: sessionToken, user, tenantId: row.tenant_id };
  }

  private findValid(token: string): InvitationRow {
    const row = this.db
      .prepare(
        `SELECT i.id, i.tenant_id, i.email, i.role, i.expires_at, t.name AS tenant_name, COALESCE(u.name, '') AS invited_by_name
         FROM invitations i JOIN tenants t ON t.id = i.tenant_id LEFT JOIN users u ON u.id = i.created_by
         WHERE i.token_hash = ? AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?`,
      )
      .get(hashLinkToken(token), this.now().toISOString()) as InvitationRow | undefined;
    if (row === undefined) throw new DomainError(410, LINK_GONE_MESSAGE);
    return row;
  }
}
```

`src/server/routes/user-routes.ts` (router con `mergeParams`, en la cadena del comercio):

```ts
import { Router, type Response } from 'express';
import { z } from 'zod';
import type { AuthenticatedAdminRequest } from '../middleware/auth-middleware.ts';
import { requirePermission } from '../middleware/permission-middleware.ts';
import type { MembershipService } from '../users/membership-service.ts';
import type { InvitationService } from '../users/invitation-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import { TENANT_ROLES, type TenantRole } from '../../shared/permissions.ts';
import { DomainError, sendError } from '../errors.ts';

const inviteSchema = z.object({ email: z.string().trim().email('Email inválido'), role: z.enum(TENANT_ROLES) });
const patchSchema = z.object({ role: z.enum(TENANT_ROLES).optional(), status: z.enum(['active', 'disabled']).optional() });

function actorOf(req: AuthenticatedAdminRequest): { tenantId: string; actor: { userId: string; role: TenantRole } } {
  if (req.user === undefined || req.tenantRole === undefined || req.activeTenantId === undefined) {
    throw new DomainError(401, 'No autorizado');
  }
  return { tenantId: req.activeTenantId, actor: { userId: req.user.id, role: req.tenantRole } };
}

export function createUserRoutes(deps: { members: MembershipService; invitations: InvitationService; audit: AuditLog }): Router {
  const router = Router({ mergeParams: true });

  router.get('/users', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      const { tenantId, actor } = actorOf(req);
      const members = deps.members.listMembers(tenantId).map((m) => ({
        ...m,
        canReset: actor.role === 'owner' && m.userId !== actor.userId && deps.members.isFullyOwnedBy(m.userId, actor.userId),
      }));
      res.status(200).json({ members, invitations: deps.invitations.listPending(tenantId) });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/invitations', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = inviteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(201).json(deps.invitations.create({ ...actorOf(req), ...parsed.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.delete('/invitations/:invitationId', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      deps.invitations.revoke({ ...actorOf(req), invitationId: req.params['invitationId'] ?? '' });
      res.status(200).json({ success: true });
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.patch('/users/:userId', requirePermission('users.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      res.status(200).json(deps.members.updateMember({ ...actorOf(req), targetUserId: req.params['userId'] ?? '', ...parsed.data }));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.get('/audit', requirePermission('owners.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
    try {
      res.status(200).json(deps.audit.listForTenant(actorOf(req).tenantId));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

(La Tarea 5 suma `POST /users/:userId/password-reset` a este router.)

`src/server/routes/link-routes.ts` (públicas, con el límite de auth):

```ts
import { Router, type RequestHandler } from 'express';
import { z } from 'zod';
import type { InvitationService } from '../users/invitation-service.ts';
import { passwordSchema } from '../../shared/password.ts';
import { sendError } from '../errors.ts';

const tokenSchema = z.object({ token: z.string().min(1) });
const acceptSchema = tokenSchema.extend({ password: z.string().min(1, 'Contraseña requerida'), name: z.string().optional() });

export function createInvitationLinkRoutes(invitations: InvitationService, limit: RequestHandler): Router {
  const router = Router();

  router.post('/lookup', limit, (req, res) => {
    const parsed = tokenSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Falta el token' });
      return;
    }
    try {
      res.status(200).json(invitations.lookup(parsed.data.token));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  router.post('/accept', limit, (req, res) => {
    const parsed = acceptSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
      return;
    }
    try {
      // Cuenta nueva: la contraseña cumple el mínimo; cuenta existente: se verifica tal cual
      const info = invitations.lookup(parsed.data.token);
      if (!info.accountExists) {
        const pw = passwordSchema.safeParse(parsed.data.password);
        if (!pw.success) {
          res.status(400).json({ error: pw.error.errors[0]?.message ?? 'Contraseña inválida' });
          return;
        }
      }
      res.status(200).json(invitations.accept(parsed.data));
    } catch (err: unknown) {
      sendError(res, err, 500);
    }
  });

  return router;
}
```

`container.ts`: `membershipServiceDef` pasa a `new MembershipService(c.use(systemDbDef), c.use(auditLogDef))`
y se suma:

```ts
export const invitationServiceDef = fn.singleton(
  (c) => new InvitationService({ db: c.use(systemDbDef), auth: c.use(authServiceDef), members: c.use(membershipServiceDef), audit: c.use(auditLogDef), now: c.use(clockDef) }),
);
```

`app.ts`: `createUserRoutes({ members, invitations, audit })` en la cadena del comercio y
`app.use('/api/invitations', createInvitationLinkRoutes(invitations, authLimit))`.

- [ ] **Paso 4: verlos pasar** — `pnpm test`.

- [ ] **Paso 5: chequeos y commit**

```bash
git add src/server test
git commit -m "feat: usuarios del comercio e invitaciones por link en la API (#19)"
```

Frenar para la revisión.

---

### Tarea 5: Contraseñas en el servidor: cambiar la propia y restablecer por link

**Archivos:**
- Crear: `src/server/users/password-reset-service.ts`, `test/passwords-api.test.ts`
- Modificar: `src/server/routes/auth-routes.ts` (`POST /password`), `src/server/routes/user-routes.ts`
  (`POST /users/:userId/password-reset`), `src/server/routes/link-routes.ts`
  (`createPasswordResetLinkRoutes`), `src/server/di/container.ts`, `src/server/app.ts`,
  `test/permissions-api.test.ts`

**Interfaces:**
- Consume: `AuthService.changePassword/setPassword/revokeSessions/createSession/validateSession`,
  `MembershipService.getMembership/isFullyOwnedBy`, `AuditLog`, `LINK_TTL_MS`, `LINK_GONE_MESSAGE`.
- Produce: `PasswordResetService.create({tenantId, actor:{userId, role}, targetUserId}): {token, expiresAt}`,
  `lookup(token): {email, name, expiresAt}`, `complete({token, password}): {token, user}`;
  `POST /api/auth/password`; `POST /api/password-resets/lookup` y `/complete`.

- [ ] **Paso 1: tests**

En `RUTAS`: `'POST /users/:userId/password-reset': 'owners.manage',`.

`test/passwords-api.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { TenantManager } from '../src/server/db/tenant-manager.ts';
import { createApp } from '../src/server/app.ts';

describe('contraseñas (#19)', () => {
  let app: Express;
  let owner: { token: string; id: string };
  let emp: { token: string; id: string };
  let tenantId: string;

  async function altaDe(email: string, business: string): Promise<{ token: string; user: { id: string }; tenant: { id: string } }> {
    return (await request(app).post('/api/alta').send({ name: email, email, password: 'clave-inicial', businessName: business, template: 'empty' })).body as { token: string; user: { id: string }; tenant: { id: string } };
  }

  async function sumar(tenant: string, ownerToken: string, email: string): Promise<{ token: string; user: { id: string } }> {
    const inv = (await request(app).post(`/api/tenants/${tenant}/invitations`).set('Authorization', `Bearer ${ownerToken}`).send({ email, role: 'member' })).body as { token: string };
    const lookup = (await request(app).post('/api/invitations/lookup').send({ token: inv.token })).body as { accountExists: boolean };
    return (await request(app).post('/api/invitations/accept').send({ token: inv.token, password: 'clave-inicial', ...(lookup.accountExists ? {} : { name: 'Emp' }) })).body as { token: string; user: { id: string } };
  }

  beforeEach(async () => {
    const systemDb = openSystemDb(':memory:');
    app = createApp({ systemDb, tenantManager: new TenantManager(systemDb, { inMemory: true }) }).app;
    const a = await altaDe('ana@k.com', 'Kiosco Ana');
    owner = { token: a.token, id: a.user.id };
    tenantId = a.tenant.id;
    const e = await sumar(tenantId, owner.token, 'emp@k.com');
    emp = { token: e.token, id: e.user.id };
  });

  it('cambiar la propia contraseña cierra las otras sesiones', async () => {
    const otra = ((await request(app).post('/api/auth/login').send({ email: 'emp@k.com', password: 'clave-inicial' })).body as { token: string }).token;
    const res = await request(app).post('/api/auth/password').set('Authorization', `Bearer ${emp.token}`).send({ currentPassword: 'clave-inicial', newPassword: 'clave-nueva-1' });
    expect(res.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${emp.token}`)).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${otra}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/password').set('Authorization', `Bearer ${emp.token}`).send({ currentPassword: 'mal', newPassword: 'clave-nueva-2' })).status).toBe(400);
  });

  it('el owner genera un link; sirve una vez, cierra las sesiones y deja entrar con la nueva', async () => {
    const link = (await request(app).post(`/api/tenants/${tenantId}/users/${emp.id}/password-reset`).set('Authorization', `Bearer ${owner.token}`)).body as { token: string };
    expect(((await request(app).post('/api/password-resets/lookup').send({ token: link.token })).body as { email: string }).email).toBe('emp@k.com');
    const done = await request(app).post('/api/password-resets/complete').send({ token: link.token, password: 'restablecida-1' });
    expect(done.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${emp.token}`)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'emp@k.com', password: 'restablecida-1' })).status).toBe(200);
    expect((await request(app).post('/api/password-resets/complete').send({ token: link.token, password: 'otra-clave-1' })).status).toBe(410);
  });

  it('no se puede para uno mismo, ni para alguien que también está en un comercio ajeno', async () => {
    expect((await request(app).post(`/api/tenants/${tenantId}/users/${owner.id}/password-reset`).set('Authorization', `Bearer ${owner.token}`)).status).toBe(403);
    const b = await altaDe('bea@k.com', 'Kiosco Bea');
    await sumar(b.tenant.id, b.token, 'emp@k.com');
    const res = await request(app).post(`/api/tenants/${tenantId}/users/${emp.id}/password-reset`).set('Authorization', `Bearer ${owner.token}`);
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(/soporte/);
  });
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`src/server/users/password-reset-service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { AuthService, UserSession } from '../auth/auth-service.ts';
import type { AuditLog } from '../audit/audit-log.ts';
import type { MembershipService } from './membership-service.ts';
import { generateLinkToken, hashLinkToken } from '../auth/crypto.ts';
import type { TenantRole } from '../../shared/permissions.ts';
import { DomainError } from '../errors.ts';
import { LINK_GONE_MESSAGE, LINK_TTL_MS } from './invitation-service.ts';

type ResetRow = { id: string; user_id: string; tenant_id: string; expires_at: string; email: string; name: string };

/** Links de restablecimiento (#19): los genera el owner para su gente; soporte, desde M7. */
export class PasswordResetService {
  private db: DatabaseSync;
  private auth: AuthService;
  private members: MembershipService;
  private audit: AuditLog;
  private now: () => Date;

  constructor(deps: { db: DatabaseSync; auth: AuthService; members: MembershipService; audit: AuditLog; now: () => Date }) {
    this.db = deps.db;
    this.auth = deps.auth;
    this.members = deps.members;
    this.audit = deps.audit;
    this.now = deps.now;
  }

  create(params: { tenantId: string; actor: { userId: string; role: TenantRole }; targetUserId: string }): { token: string; expiresAt: string } {
    if (params.targetUserId === params.actor.userId) {
      throw new DomainError(403, 'Para tu propia contraseña usá "Mi cuenta"');
    }
    if (this.members.getMembership(params.tenantId, params.targetUserId) === undefined) {
      throw new DomainError(404, 'El usuario no es miembro de este comercio');
    }
    if (!this.members.isFullyOwnedBy(params.targetUserId, params.actor.userId)) {
      throw new DomainError(403, 'Este usuario también está en otro comercio: pedíselo a soporte');
    }
    const now = this.now();
    this.db.prepare('DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL').run(params.targetUserId);
    const { raw, hash } = generateLinkToken();
    const expiresAt = new Date(now.getTime() + LINK_TTL_MS).toISOString();
    this.db
      .prepare('INSERT INTO password_resets (id, user_id, token_hash, created_by, tenant_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(`pwr_${randomUUID()}`, params.targetUserId, hash, params.actor.userId, params.tenantId, now.toISOString(), expiresAt);
    this.audit.record({ actorUserId: params.actor.userId, tenantId: params.tenantId, action: 'password.reset_link_created', targetUserId: params.targetUserId });
    return { token: raw, expiresAt };
  }

  lookup(token: string): { email: string; name: string; expiresAt: string } {
    const row = this.findValid(token);
    return { email: row.email, name: row.name, expiresAt: row.expires_at };
  }

  complete(params: { token: string; password: string }): { token: string; user: UserSession } {
    const row = this.findValid(params.token);
    this.auth.setPassword(row.user_id, params.password);
    this.auth.revokeSessions(row.user_id);
    this.db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').run(this.now().toISOString(), row.id);
    this.audit.record({ actorUserId: row.user_id, tenantId: row.tenant_id, action: 'password.reset', targetUserId: row.user_id });
    const token = this.auth.createSession(row.user_id);
    const user = this.auth.validateSession(token);
    if (user === undefined) throw new DomainError(401, 'No se pudo iniciar la sesión');
    return { token, user };
  }

  private findValid(token: string): ResetRow {
    const row = this.db
      .prepare(
        `SELECT r.id, r.user_id, r.tenant_id, r.expires_at, u.email, u.name
         FROM password_resets r JOIN users u ON u.id = r.user_id
         WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?`,
      )
      .get(hashLinkToken(token), this.now().toISOString()) as ResetRow | undefined;
    if (row === undefined) throw new DomainError(410, LINK_GONE_MESSAGE);
    return row;
  }
}
```

`auth-routes.ts`: `createAuthRoutes(authService, requireAdmin, limit, audit: AuditLog)` y:

```ts
const changePasswordSchema = z.object({ currentPassword: z.string().min(1, 'Contraseña actual requerida'), newPassword: passwordSchema });

router.post('/password', requireAdmin, (req: AuthenticatedAdminRequest, res: Response) => {
  const header = req.headers.authorization ?? '';
  const parsed = changePasswordSchema.safeParse(req.body);
  if (req.user === undefined) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.errors[0]?.message ?? 'Datos inválidos' });
    return;
  }
  try {
    authService.changePassword({ userId: req.user.id, currentToken: header.slice(7).trim(), ...parsed.data });
    audit.record({ actorUserId: req.user.id, tenantId: null, action: 'password.changed', targetUserId: req.user.id });
    res.status(200).json({ success: true });
  } catch (err: unknown) {
    sendError(res, err, 500);
  }
});
```

`user-routes.ts`: `deps` suma `resets: PasswordResetService` y la ruta:

```ts
router.post('/users/:userId/password-reset', requirePermission('owners.manage'), (req: AuthenticatedAdminRequest, res: Response) => {
  try {
    res.status(201).json(deps.resets.create({ ...actorOf(req), targetUserId: req.params['userId'] ?? '' }));
  } catch (err: unknown) {
    sendError(res, err, 500);
  }
});
```

`link-routes.ts`: `createPasswordResetLinkRoutes(resets, limit)` con `POST /lookup` (`tokenSchema`) y
`POST /complete` (`tokenSchema.extend({ password: passwordSchema })`), igual de forma que las de
invitación, llamando a `resets.lookup` y `resets.complete`.

`container.ts`: `passwordResetServiceDef` con las mismas dependencias que `invitationServiceDef`.
`app.ts`: `app.use('/api/password-resets', createPasswordResetLinkRoutes(resets, authLimit))`, y pasar
`audit` a `createAuthRoutes` y `resets` a `createUserRoutes`.

- [ ] **Paso 4: verlos pasar** — `pnpm test`.

- [ ] **Paso 5: chequeos y commit**

```bash
git add src/server test
git commit -m "feat: cambiar la propia contraseña y links de restablecimiento (#19)"
```

Frenar para la revisión.

---

### Tarea 6: Cliente: permisos, login sin registro y alta por `POST /api/alta`

**Archivos:**
- Crear: `src/client/state/permissions-state.ts`, `test/permissions-client.test.ts`
- Modificar: `src/client/state/auth-state.ts`, `src/client/state/navigation-state.ts`,
  `src/client/state/settings-state.ts`, `src/client/components/shell/Sidebar.tsx`,
  `src/client/components/settings/SettingsTabs.tsx`, `src/client/components/shell/Header.tsx`,
  `src/client/components/auth/AuthView.tsx`, `src/client/components/auth/LoginForm.tsx`
  (sin "Registrarse"), `src/client/state/merchant-onboarding-state.ts`,
  `src/client/components/onboarding/MerchantOnboardingView.tsx`,
  `src/client/state/onboarding-state.ts`, `src/client/components/shell/OnboardingModal.tsx`,
  `test/merchant-onboarding.test.ts`, `test/onboarding-wizard.test.ts`,
  `test/auth-client-state.test.ts`
- Borrar: `src/client/components/auth/RegisterForm.tsx`

**Interfaces:**
- Consume: `can`, `effectiveTenantRole`, `MembershipRole`, `Capability`, `PASSWORD_MIN_LENGTH`,
  `PASSWORD_MIN_MESSAGE` (compartidos); `POST /api/alta`.
- Produce:
  - `activeRoleSignal: ReadonlySignal<TenantRole | null>`, `canDo(cap): boolean` (lee
    `activeRoleSignal`, reactivo), `ROLE_LABEL: Record<MembershipRole, string>`,
    `isViewAllowed(view: ActiveNavView): boolean`,
    `isSettingsTabAllowed(tab: SettingsTab): boolean`.
  - `adoptSession(token: string): Promise<boolean>` en `auth-state`.
  - `ActiveNavView` suma `'users'`; `SettingsTab` suma `'account'`.

- [ ] **Paso 1: tests**

`test/permissions-client.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { activeRoleSignal, canDo, isViewAllowed, isSettingsTabAllowed } from '../src/client/state/permissions-state.ts';
import { activeTenantIdSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';
import type { MembershipRole } from '../src/shared/permissions.ts';

function como(role: MembershipRole): void {
  userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'T1', status: 'active', role }];
  activeTenantIdSignal.value = 't1';
}

describe('permisos en el cliente (#19)', () => {
  beforeEach(() => { como('owner'); });

  it('el member no ve masivas, usuarios ni las solapas de keys, sucursales y guía', () => {
    como('member');
    expect(activeRoleSignal.value).toBe('member');
    expect(isViewAllowed('bulk')).toBe(false);
    expect(isViewAllowed('users')).toBe(false);
    expect(isViewAllowed('catalog')).toBe(true);
    expect(isSettingsTabAllowed('pos')).toBe(false);
    expect(isSettingsTabAllowed('branches')).toBe(false);
    expect(isSettingsTabAllowed('connection')).toBe(false);
    expect(isSettingsTabAllowed('appearance')).toBe(true);
    expect(isSettingsTabAllowed('account')).toBe(true);
  });

  it('el admin ve usuarios pero no la auditoría', () => {
    como('admin');
    expect(isViewAllowed('users')).toBe(true);
    expect(canDo('owners.manage')).toBe(false);
  });

  it('root impersonando opera como owner', () => {
    como('root_impersonator');
    expect(canDo('owners.manage')).toBe(true);
  });
});
```

En `test/merchant-onboarding.test.ts` y `test/onboarding-wizard.test.ts`, los mocks de `fetch`
dejan de responder `/auth/register`, `/tenants` (POST), `/seed-preset` y `/api-keys`, y responden
`/api/alta` con `{ token, user, tenant: { id, name }, posKey: { key, branch: 'CENTRAL', pointOfSale: 'Caja 1' } }`
(y `/auth/me` como hoy). Las aserciones pasan a: una sola llamada `POST /api/alta` con
`{ name, email, password, businessName, template }` sin sesión, o `{ businessName, template }` con
`Authorization` si hay sesión; el resultado (`merchantResultSignal`, `provisionResultSignal`) usa
`posKey.key` y `tenant.id`. Un test nuevo: con `409` del alta, `errorMessageSignal` muestra el
mensaje del servidor y el paso vuelve a 1 con `isExistingAccountSignal = true`. Otro: con una
contraseña de 7 caracteres el paso 1 no avanza y muestra `PASSWORD_MIN_MESSAGE`. En
`auth-client-state.test.ts`, lo que use `register()` se borra.

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`src/client/state/permissions-state.ts`:

```ts
import { computed, effect } from '@preact/signals';
import { can, effectiveTenantRole, type Capability, type MembershipRole, type TenantRole } from '../../shared/permissions.ts';
import { activeTenantSignal } from './auth-state.ts';
import { activeViewSignal, type ActiveNavView } from './navigation-state.ts';
import { activeSettingsTabSignal, type SettingsTab } from './settings-state.ts';

/** El rol con el que se opera el comercio activo (#19); impersonando, owner hasta M7. */
export const activeRoleSignal = computed<TenantRole | null>(() => {
  const tenant = activeTenantSignal.value;
  return tenant === null ? null : effectiveTenantRole(tenant.role);
});

export function canDo(capability: Capability): boolean {
  const role = activeRoleSignal.value;
  return role !== null && can(role, capability);
}

export const ROLE_LABEL: Record<MembershipRole, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Empleado',
  root_impersonator: 'Soporte',
  support_impersonator: 'Soporte',
};

const VIEW_CAPABILITY: Record<ActiveNavView, Capability> = {
  dashboard: 'tenant.use',
  catalog: 'tenant.use',
  stock: 'tenant.use',
  customers: 'tenant.use',
  bulk: 'bulk',
  users: 'users.manage',
  settings: 'tenant.use',
};

const TAB_CAPABILITY: Record<SettingsTab, Capability> = {
  pos: 'settings.manage',
  branches: 'settings.manage',
  connection: 'settings.manage',
  appearance: 'tenant.use',
  account: 'tenant.use',
};

export function isViewAllowed(view: ActiveNavView): boolean {
  return canDo(VIEW_CAPABILITY[view]);
}

export function isSettingsTabAllowed(tab: SettingsTab): boolean {
  return canDo(TAB_CAPABILITY[tab]);
}

// Si al cambiar de comercio la vista o la solapa ya no está permitida, se vuelve a una que sí
if (typeof window !== 'undefined') {
  effect(() => {
    if (activeRoleSignal.value !== null && !isViewAllowed(activeViewSignal.value)) {
      activeViewSignal.value = 'dashboard';
    }
  });
  effect(() => {
    if (activeRoleSignal.value !== null && !isSettingsTabAllowed(activeSettingsTabSignal.value)) {
      activeSettingsTabSignal.value = 'appearance';
    }
  });
}
```

Para no crear un ciclo de imports (`settings-state` → `permissions-state` → `settings-state`), el
efecto de `settings-state.ts` que carga keys y sucursales chequea el rol con `can` directo:

```ts
effect(() => {
  const tenantId = effectiveTenantIdSignal.value;
  const token = tokenSignal.value;
  const tenant = activeTenantSignal.value;
  if (tenantId && token && tenant !== null && can(effectiveTenantRole(tenant.role), 'settings.manage')) {
    void fetchApiKeys();
    void fetchSettingsBranches();
  }
});
```

`auth-state.ts`: `TenantMembershipItem.role: MembershipRole`; borrar `register()`; agregar:

```ts
/** Adopta una sesión que dio el servidor (alta, invitación, restablecimiento). */
export async function adoptSession(token: string): Promise<boolean> {
  tokenSignal.value = token;
  setStoredToken(token);
  return fetchProfile();
}
```

`navigation-state.ts`: `ActiveNavView` suma `'users'`. `settings-state.ts`: `SettingsTab` suma
`'account'`.

`Sidebar.tsx`: ítem `{ id: 'users', label: 'Usuarios', icon: … }` (ícono de personas, el mismo
trazo que el de clientes con `d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z"`),
entre "Operaciones Masivas" y "Configuración"; el `map` filtra con
`navItems.filter((item) => isViewAllowed(item.id))`.

`SettingsTabs.tsx`: suma `{ id: 'account', label: 'Mi cuenta', icon: '🔑' }` antes de Apariencia y
filtra `TABS.filter((t) => isSettingsTabAllowed(t.id))`. (`SettingsView` renderiza `AccountSection`
en la Tarea 7; hasta entonces la solapa muestra nada.)

`Header.tsx`: debajo del nombre del comercio activo, en lugar del `tenantId`, una etiqueta
`{ROLE_LABEL[activeTenant.role]} · {activeTenant.tenantId}`.

`AuthView.tsx`: sin `authViewModeSignal` ni `RegisterForm`; título fijo "Iniciar Sesión",
`<LoginForm />` sin `onSwitchToRegister`. `LoginForm.tsx`: borrar la prop y el link
"Registrarse". Borrar `RegisterForm.tsx`.

`merchant-onboarding-state.ts`:
- Paso 1, cuenta nueva: solo valida en el cliente (nombre, mail con `@`,
  `userPasswordSignal.value.length < PASSWORD_MIN_LENGTH` → `PASSWORD_MIN_MESSAGE`) y pasa al paso 2;
  ya no llama a `auth/register`. Cuenta existente: `login` como hoy.
- `executeMerchantProvisioning` reemplaza el registro, `tenants`, `seed-preset` y `api-keys` por:

```ts
const authenticated = isAuthenticatedSignal.value;
const res = await apiFetch<{
  token?: string;
  tenant: { id: string; name: string };
  posKey: { key: string; branch: string; pointOfSale: string };
}>('alta', {
  method: 'POST',
  token: authenticated ? tokenSignal.value : null,
  body: authenticated
    ? { businessName, template: preset }
    : { name: userNameSignal.value.trim(), email: userEmailSignal.value.trim(), password: userPasswordSignal.value, businessName, template: preset },
});
if (res.token !== undefined) {
  await adoptSession(res.token);
} else {
  await fetchProfile();
}
setActiveTenant(res.tenant.id);
const tenantId = res.tenant.id;
const apiKey = res.posKey.key;
const branchCode = res.posKey.branch;
const posTerminalName = res.posKey.pointOfSale;
```

  y en el `catch`, si es `ApiError` con `status === 409`: `isExistingAccountSignal.value = true`,
  `merchantStepSignal.value = 1`, con el mensaje del servidor; si no, como hoy (paso 2). Se borra
  `sanitizeToSlug` (lo hace el servidor) y su test.
- `MerchantOnboardingView.tsx`: placeholder `Mínimo ${String(PASSWORD_MIN_LENGTH)} caracteres`.

`onboarding-state.ts` ("Crear nuevo comercio…", con sesión): quedan dos pasos (nombre y rubro).
Se borran `slugSignal`, `tenantIdSignal`, `branchNameSignal`, `branchCodeSignal`, `posNameSignal`,
`generateSlug` y el paso 3; `nextStep` en el paso 2 llama a `submitOnboarding`, que hace
`apiFetch('alta', { method: 'POST', token, body: { businessName: name, template: preset } })` y arma
`provisionResultSignal` con `tenant.id` y `posKey`. `OnboardingModal.tsx`: se borran los inputs de
slug, identificador, sucursal y terminal (líneas que usan esas señales) y el indicador de pasos pasa
a 2 + resultado.

- [ ] **Paso 4: verlos pasar** — `pnpm test`.

- [ ] **Paso 5: chequeos y commit** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

```bash
git add src/client test
git commit -m "feat: el admin esconde lo que el rol no permite y el alta usa POST /api/alta (#19)"
```

Frenar para la revisión.

---

### Tarea 7: Cliente: vista Usuarios y Mi cuenta

**Archivos:**
- Crear: `src/client/state/users-state.ts`, `src/client/state/account-state.ts`,
  `src/client/components/users/UsersView.tsx`, `MembersTable.tsx`, `InvitationsTable.tsx`,
  `InviteModal.tsx`, `LinkReadyModal.tsx`, `ActivityList.tsx`,
  `src/client/components/settings/AccountSection.tsx`, `test/users-client.test.ts`,
  `test/account-client.test.ts`
- Modificar: `src/client/App.tsx`, `src/client/components/settings/SettingsView.tsx`

**Interfaces:**
- Consume: `canDo`, `assignableRoles`, `activeRoleSignal`, `ROLE_LABEL`, rutas de las Tareas 4 y 5.
- Produce:
  - `users-state`: `membersSignal`, `invitationsSignal`, `auditSignal`, `inviteModalOpenSignal`,
    `inviteFormSignal: {email, role}`, `inviteErrorSignal`, `linkReadySignal: LinkReady | null`
    (`LinkReady = { kind: 'invitation' | 'reset'; url: string; email: string; expiresAt: string }`),
    `loadUsers()`, `loadAudit()`, `submitInvite()`, `reinvite(inv)`, `revokeInvitation(id)`,
    `changeRole(userId, role)`, `setMemberStatus(userId, status)`, `createResetLink(member)`,
    `buildLinkUrl(kind, token, origin)`, `whatsappShareUrl(text)`, `linkShareText(link, tenantName)`,
    `AUDIT_LABEL: Record<string, string>`.
  - `account-state`: `accountFormSignal: {current, next, confirm}`, `accountErrorSignal`,
    `accountSavingSignal`, `submitChangePassword()`.

- [ ] **Paso 1: tests**

`test/users-client.test.ts` (fetch mockeado con `vi.spyOn(globalThis, 'fetch')`, como
`settings-client.test.ts`):

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  buildLinkUrl, whatsappShareUrl, linkShareText, submitInvite, inviteFormSignal, linkReadySignal,
  loadUsers, membersSignal, invitationsSignal, setMemberStatus,
} from '../src/client/state/users-state.ts';
import { tokenSignal, activeTenantIdSignal, userTenantsSignal } from '../src/client/state/auth-state.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('vista Usuarios (#19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenSignal.value = 'tok';
    userTenantsSignal.value = [{ tenantId: 't1', slug: 't1', name: 'Kiosco Ana', status: 'active', role: 'owner' }];
    activeTenantIdSignal.value = 't1';
    linkReadySignal.value = null;
  });

  it('arma los links con el token en el fragmento', () => {
    expect(buildLinkUrl('invitation', 'abc', 'https://mini.contax.ar')).toBe('https://mini.contax.ar/invitacion#t=abc');
    expect(buildLinkUrl('reset', 'abc', 'https://mini.contax.ar')).toBe('https://mini.contax.ar/restablecer#t=abc');
  });

  it('el mensaje de WhatsApp lleva el link y el aviso de 48 h', () => {
    const text = linkShareText({ kind: 'invitation', url: 'https://x/invitacion#t=a', email: 'j@k.com', expiresAt: '' }, 'Kiosco Ana');
    expect(text).toContain('Kiosco Ana');
    expect(text).toContain('https://x/invitacion#t=a');
    expect(text).toContain('48 h');
    expect(whatsappShareUrl('hola mundo')).toBe('https://wa.me/?text=hola%20mundo');
  });

  it('invitar muestra el link listo y recarga la lista', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ id: 'inv1', token: 'tk', expiresAt: '2026-10-03T10:00:00Z' }, 201))
      .mockResolvedValueOnce(json({ members: [], invitations: [{ id: 'inv1', email: 'j@k.com', role: 'member', createdAt: '', expiresAt: '', invitedByName: 'Ana' }] }));
    inviteFormSignal.value = { email: 'j@k.com', role: 'member' };
    await submitInvite();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/tenants/t1/invitations');
    expect(linkReadySignal.value?.url.endsWith('/invitacion#t=tk')).toBe(true);
    expect(invitationsSignal.value).toHaveLength(1);
  });

  it('desactivar manda PATCH con status y recarga', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ members: [{ userId: 'u2', name: 'J', email: 'j@k.com', role: 'member', status: 'disabled', joinedAt: '', canReset: true }], invitations: [] }));
    await setMemberStatus('u2', 'disabled');
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe('PATCH');
    expect(init?.body).toBe(JSON.stringify({ status: 'disabled' }));
    expect(membersSignal.value[0]?.status).toBe('disabled');
  });

  it('loadUsers llena miembros e invitaciones', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ members: [{ userId: 'u1', name: 'Ana', email: 'a@k.com', role: 'owner', status: 'active', joinedAt: '', canReset: false }], invitations: [] }));
    await loadUsers();
    expect(membersSignal.value[0]?.name).toBe('Ana');
  });
});
```

`test/account-client.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { accountFormSignal, accountErrorSignal, submitChangePassword } from '../src/client/state/account-state.ts';
import { tokenSignal } from '../src/client/state/auth-state.ts';

describe('Mi cuenta (#19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    tokenSignal.value = 'tok';
    accountErrorSignal.value = null;
  });

  it('valida mínimo y confirmación antes de llamar al servidor', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    accountFormSignal.value = { current: 'vieja', next: 'corta', confirm: 'corta' };
    await submitChangePassword();
    expect(accountErrorSignal.value).toBe('La contraseña debe tener al menos 8 caracteres');
    accountFormSignal.value = { current: 'vieja', next: 'clave-nueva-1', confirm: 'otra-cosa-1' };
    await submitChangePassword();
    expect(accountErrorSignal.value).toBe('Las contraseñas no coinciden');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('manda la actual y la nueva, y limpia el formulario', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ success: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }),
    );
    accountFormSignal.value = { current: 'vieja-1234', next: 'clave-nueva-1', confirm: 'clave-nueva-1' };
    await submitChangePassword();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/password');
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ currentPassword: 'vieja-1234', newPassword: 'clave-nueva-1' }));
    expect(accountFormSignal.value).toEqual({ current: '', next: '', confirm: '' });
  });
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`src/client/state/users-state.ts`:

```ts
import { signal, effect } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal, effectiveTenantIdSignal, activeTenantSignal } from './auth-state.ts';
import { activeViewSignal } from './navigation-state.ts';
import { canDo } from './permissions-state.ts';
import { showToast } from './toast-state.ts';
import type { TenantRole } from '../../shared/permissions.ts';

export type MemberItem = { userId: string; name: string; email: string; role: TenantRole; status: 'active' | 'disabled'; joinedAt: string; canReset: boolean };
export type InvitationItem = { id: string; email: string; role: TenantRole; createdAt: string; expiresAt: string; invitedByName: string };
export type AuditItem = { id: string; at: string; action: string; actorName: string; targetName: string | null; details: Record<string, unknown> };
export type LinkReady = { kind: 'invitation' | 'reset'; url: string; email: string; expiresAt: string };

export const membersSignal = signal<MemberItem[]>([]);
export const invitationsSignal = signal<InvitationItem[]>([]);
export const auditSignal = signal<AuditItem[]>([]);
export const usersLoadingSignal = signal<boolean>(false);
export const inviteModalOpenSignal = signal<boolean>(false);
export const inviteFormSignal = signal<{ email: string; role: TenantRole }>({ email: '', role: 'member' });
export const inviteErrorSignal = signal<string | null>(null);
export const linkReadySignal = signal<LinkReady | null>(null);

export const AUDIT_LABEL: Record<string, string> = {
  'tenant.created': 'creó el comercio',
  'invitation.created': 'invitó a',
  'invitation.revoked': 'revocó la invitación de',
  'invitation.accepted': 'aceptó la invitación',
  'member.role_changed': 'cambió el rol de',
  'member.disabled': 'desactivó a',
  'member.enabled': 'reactivó a',
  'password.reset_link_created': 'generó un link de restablecimiento para',
  'password.reset': 'restableció su contraseña',
  'password.changed': 'cambió su contraseña',
};

export function buildLinkUrl(kind: LinkReady['kind'], token: string, origin: string): string {
  return `${origin}/${kind === 'invitation' ? 'invitacion' : 'restablecer'}#t=${token}`;
}

export function linkShareText(link: LinkReady, tenantName: string): string {
  return link.kind === 'invitation'
    ? `Te invito a ${tenantName} en mini contax: ${link.url} (sirve una vez y vence en 48 h)`
    : `Para elegir tu nueva contraseña de mini contax: ${link.url} (sirve una vez y vence en 48 h)`;
}

export function whatsappShareUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

function base(): string {
  return `tenants/${effectiveTenantIdSignal.value ?? ''}`;
}

function origin(): string {
  return typeof window === 'undefined' ? 'http://localhost:4100' : window.location.origin;
}

function fail(title: string, err: unknown): void {
  showToast({ type: 'error', title, message: err instanceof Error ? err.message : 'Error inesperado' });
}

export async function loadUsers(): Promise<void> {
  usersLoadingSignal.value = true;
  try {
    const res = await apiFetch<{ members: MemberItem[]; invitations: InvitationItem[] }>(`${base()}/users`, { token: tokenSignal.value });
    membersSignal.value = res.members;
    invitationsSignal.value = res.invitations;
  } catch (err: unknown) {
    fail('No se pudieron cargar los usuarios', err);
  } finally {
    usersLoadingSignal.value = false;
  }
}

export async function loadAudit(): Promise<void> {
  try {
    auditSignal.value = await apiFetch<AuditItem[]>(`${base()}/audit`, { token: tokenSignal.value });
  } catch (err: unknown) {
    fail('No se pudo cargar la actividad', err);
  }
}

async function invite(email: string, role: TenantRole): Promise<void> {
  const res = await apiFetch<{ id: string; token: string; expiresAt: string }>(`${base()}/invitations`, {
    method: 'POST',
    token: tokenSignal.value,
    body: { email, role },
  });
  linkReadySignal.value = { kind: 'invitation', url: buildLinkUrl('invitation', res.token, origin()), email, expiresAt: res.expiresAt };
  await loadUsers();
}

export async function submitInvite(): Promise<void> {
  inviteErrorSignal.value = null;
  const { email, role } = inviteFormSignal.value;
  if (!email.includes('@')) {
    inviteErrorSignal.value = 'Ingresá un correo válido';
    return;
  }
  try {
    await invite(email.trim(), role);
    inviteModalOpenSignal.value = false;
    inviteFormSignal.value = { email: '', role: 'member' };
  } catch (err: unknown) {
    inviteErrorSignal.value = err instanceof Error ? err.message : 'No se pudo invitar';
  }
}

export async function reinvite(inv: InvitationItem): Promise<void> {
  try {
    await invite(inv.email, inv.role);
  } catch (err: unknown) {
    fail('No se pudo generar el link', err);
  }
}

export async function revokeInvitation(id: string): Promise<void> {
  try {
    await apiFetch(`${base()}/invitations/${id}`, { method: 'DELETE', token: tokenSignal.value });
    await loadUsers();
  } catch (err: unknown) {
    fail('No se pudo revocar', err);
  }
}

async function patchMember(userId: string, body: { role?: TenantRole; status?: 'active' | 'disabled' }): Promise<void> {
  try {
    await apiFetch(`${base()}/users/${userId}`, { method: 'PATCH', token: tokenSignal.value, body });
    await loadUsers();
  } catch (err: unknown) {
    fail('No se pudo guardar el cambio', err);
  }
}

export function changeRole(userId: string, role: TenantRole): Promise<void> {
  return patchMember(userId, { role });
}

export function setMemberStatus(userId: string, status: 'active' | 'disabled'): Promise<void> {
  return patchMember(userId, { status });
}

export async function createResetLink(member: MemberItem): Promise<void> {
  try {
    const res = await apiFetch<{ token: string; expiresAt: string }>(`${base()}/users/${member.userId}/password-reset`, {
      method: 'POST',
      token: tokenSignal.value,
    });
    linkReadySignal.value = { kind: 'reset', url: buildLinkUrl('reset', res.token, origin()), email: member.email, expiresAt: res.expiresAt };
  } catch (err: unknown) {
    fail('No se pudo generar el link', err);
  }
}

export function currentTenantName(): string {
  return activeTenantSignal.value?.name ?? 'el comercio';
}

// Carga al entrar a Usuarios o al cambiar de comercio estando ahí
if (typeof window !== 'undefined') {
  effect(() => {
    if (activeViewSignal.value === 'users' && effectiveTenantIdSignal.value && tokenSignal.value && canDo('users.manage')) {
      void loadUsers();
      if (canDo('owners.manage')) void loadAudit();
    }
  });
}
```

`src/client/state/account-state.ts`:

```ts
import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { tokenSignal } from './auth-state.ts';
import { showToast } from './toast-state.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE } from '../../shared/password.ts';

export const accountFormSignal = signal<{ current: string; next: string; confirm: string }>({ current: '', next: '', confirm: '' });
export const accountErrorSignal = signal<string | null>(null);
export const accountSavingSignal = signal<boolean>(false);

/** Cambiar la propia contraseña (#19): cierra las sesiones de los otros equipos. */
export async function submitChangePassword(): Promise<void> {
  accountErrorSignal.value = null;
  const { current, next, confirm } = accountFormSignal.value;
  if (next.length < PASSWORD_MIN_LENGTH) {
    accountErrorSignal.value = PASSWORD_MIN_MESSAGE;
    return;
  }
  if (next !== confirm) {
    accountErrorSignal.value = 'Las contraseñas no coinciden';
    return;
  }
  accountSavingSignal.value = true;
  try {
    await apiFetch('auth/password', { method: 'POST', token: tokenSignal.value, body: { currentPassword: current, newPassword: next } });
    accountFormSignal.value = { current: '', next: '', confirm: '' };
    showToast({ type: 'success', title: 'Contraseña cambiada', message: 'Se cerró la sesión en tus otros equipos' });
  } catch (err: unknown) {
    accountErrorSignal.value = err instanceof Error ? err.message : 'No se pudo cambiar la contraseña';
  } finally {
    accountSavingSignal.value = false;
  }
}
```

Componentes (estilo de los existentes: `Card`, `Button`, `Input`, `Modal`, `PageHeader`, `Table`,
clases Tailwind con variantes `dark:`):

- `UsersView.tsx`: `PageHeader` ("Usuarios", subtítulo "Quién entra a {comercio} y con qué rol"), botón
  "Invitar" (`inviteModalOpenSignal.value = true`), `<MembersTable />`, `<InvitationsTable />` si hay
  pendientes, `<ActivityList />` si `canDo('owners.manage')`, `<InviteModal />` y `<LinkReadyModal />`.
- `MembersTable.tsx`: columnas Nombre, Correo, Rol, Estado, Desde, Acciones. La fila propia
  (`userId === currentUserSignal.value?.id`) muestra "Vos" y ninguna acción. Rol: si el rol de la fila
  es `owner` y no `canDo('owners.manage')`, texto fijo; si no, un `<select>` con
  `assignableRoles(activeRoleSignal.value)` (etiquetas de `ROLE_LABEL`) que llama a
  `changeRole`. Acciones: "Desactivar"/"Reactivar" (`setMemberStatus`; para owners solo con
  `owners.manage`) y, con `canDo('owners.manage')`, "Link para restablecer"
  (`createResetLink(m)`), con `disabled={!m.canReset}` y `title="Este usuario también está en otro comercio: pedíselo a soporte"` cuando no se puede.
- `InvitationsTable.tsx`: Correo, Rol, Vence (fecha local), Invitó, con "Generar link nuevo"
  (`reinvite`) y "Revocar" (`revokeInvitation`).
- `InviteModal.tsx`: `Modal` con `Input` de correo y `Select` de rol (opciones de
  `assignableRoles(activeRoleSignal.value)`), error de `inviteErrorSignal`, botón "Crear link"
  (`submitInvite`).
- `LinkReadyModal.tsx`: abierto si `linkReadySignal.value !== null`. Título "Link listo para
  {email}", el link en un `<input readonly>`, botones "Copiar" (`navigator.clipboard.writeText(url)`
  y toast) y "Compartir por WhatsApp" (`<a href={whatsappShareUrl(linkShareText(link, currentTenantName()))} target="_blank" rel="noopener">`),
  y el aviso "Sirve una sola vez y vence en 48 h. No lo vas a poder ver de nuevo: si se pierde,
  generá otro." Cerrar: `linkReadySignal.value = null`.
- `ActivityList.tsx`: lista de `auditSignal`: fecha local, "**{actorName}** {AUDIT_LABEL[action] ?? action} **{targetName}**"
  y, si `details.email`, el correo; "Sin actividad todavía" si está vacía.
- `AccountSection.tsx`: `Card` "Cambiar contraseña" con tres `Input type="password"` (actual, nueva
  con `helperText` del mínimo, repetir), error de `accountErrorSignal` y botón "Guardar"
  (`submitChangePassword`, `loading={accountSavingSignal.value}`).

`App.tsx`: `{currentView === 'users' && <UsersView />}`. `SettingsView.tsx`:
`{activeTab === 'account' && <AccountSection />}`.

- [ ] **Paso 4: verlos pasar** — `pnpm test`.

- [ ] **Paso 5: chequeos y commit** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

```bash
git add src/client test
git commit -m "feat: vista Usuarios con invitaciones, links y actividad, y Mi cuenta (#19)"
```

Frenar para la revisión.

---

### Tarea 8: Cliente: páginas `/invitacion` y `/restablecer`

**Archivos:**
- Crear: `src/client/state/link-pages-state.ts`, `src/client/components/links/InvitationView.tsx`,
  `src/client/components/links/ResetPasswordView.tsx`, `test/link-pages.test.ts`
- Modificar: `src/client/state/route-state.ts`, `src/client/App.tsx`,
  `test/route-and-landing.test.ts`

**Interfaces:**
- Consume: `adoptSession`, `setActiveTenant`, `navigate`, `PASSWORD_MIN_LENGTH/MESSAGE`, rutas
  públicas de las Tareas 4 y 5.
- Produce: `AppRoute` suma `'invitacion' | 'restablecer'`; `readLinkToken(hash): string | null`;
  `linkTokenSignal`, `invitationInfoSignal`, `resetInfoSignal`, `linkErrorSignal`,
  `linkFormSignal: {name, password, confirm}`, `linkSubmittingSignal`,
  `initLinkPageFromUrl()`, `submitInvitation()`, `submitReset()`.

- [ ] **Paso 1: tests**

En `test/route-and-landing.test.ts`, sumar a la tabla `['/invitacion', 'invitacion']` y
`['/restablecer', 'restablecer']`.

`test/link-pages.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  readLinkToken, linkTokenSignal, invitationInfoSignal, linkFormSignal, linkErrorSignal,
  loadInvitation, submitInvitation, submitReset,
} from '../src/client/state/link-pages-state.ts';
import { tokenSignal } from '../src/client/state/auth-state.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('páginas de links (#19)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    linkErrorSignal.value = null;
    invitationInfoSignal.value = null;
    tokenSignal.value = null;
  });

  it('lee el token del fragmento', () => {
    expect(readLinkToken('#t=abc')).toBe('abc');
    expect(readLinkToken('')).toBeNull();
  });

  it('un link que ya no sirve muestra el mensaje del servidor', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(json({ error: 'Este link ya no sirve: pedile uno nuevo a quien te lo mandó' }, 410));
    linkTokenSignal.value = 'viejo';
    await loadInvitation();
    expect(linkErrorSignal.value).toBe('Este link ya no sirve: pedile uno nuevo a quien te lo mandó');
  });

  it('aceptar con cuenta nueva pide nombre, mínimo y confirmación, y adopta la sesión', async () => {
    invitationInfoSignal.value = { tenantName: 'K', role: 'member', email: 'j@k.com', invitedByName: 'Ana', accountExists: false, expiresAt: '' };
    linkTokenSignal.value = 'tk';
    linkFormSignal.value = { name: 'Juan', password: 'corta', confirm: 'corta' };
    await submitInvitation();
    expect(linkErrorSignal.value).toBe('La contraseña debe tener al menos 8 caracteres');

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ token: 'sesion', user: { id: 'u' }, tenantId: 't1' }))
      .mockResolvedValueOnce(json({ user: { id: 'u', email: 'j@k.com', name: 'Juan', globalRole: 'user' }, tenants: [] }));
    linkFormSignal.value = { name: 'Juan', password: 'clave-juan-1', confirm: 'clave-juan-1' };
    await submitInvitation();
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/invitations/accept');
    expect(tokenSignal.value).toBe('sesion');
  });

  it('restablecer manda token y contraseña', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(json({ token: 'sesion2', user: { id: 'u' } }))
      .mockResolvedValueOnce(json({ user: { id: 'u', email: 'j@k.com', name: 'Juan', globalRole: 'user' }, tenants: [] }));
    linkTokenSignal.value = 'tk';
    linkFormSignal.value = { name: '', password: 'nueva-clave-1', confirm: 'nueva-clave-1' };
    await submitReset();
    expect(fetchMock.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ token: 'tk', password: 'nueva-clave-1' }));
    expect(tokenSignal.value).toBe('sesion2');
  });
});
```

- [ ] **Paso 2: verlos fallar.**

- [ ] **Paso 3: implementar**

`route-state.ts`: `AppRoute = 'landing' | 'admin' | 'alta' | 'invitacion' | 'restablecer'` y en
`routeFromPath`: `if (path === '/invitacion') return 'invitacion'; if (path === '/restablecer') return 'restablecer';`.

`src/client/state/link-pages-state.ts`:

```ts
import { signal } from '@preact/signals';
import { apiFetch } from '../api/client.ts';
import { adoptSession, setActiveTenant } from './auth-state.ts';
import { navigate, routeFromPath } from './route-state.ts';
import { PASSWORD_MIN_LENGTH, PASSWORD_MIN_MESSAGE } from '../../shared/password.ts';
import type { TenantRole } from '../../shared/permissions.ts';

export type InvitationInfo = { tenantName: string; role: TenantRole; email: string; invitedByName: string; accountExists: boolean; expiresAt: string };
export type ResetInfo = { email: string; name: string; expiresAt: string };

export const linkTokenSignal = signal<string | null>(null);
export const invitationInfoSignal = signal<InvitationInfo | null>(null);
export const resetInfoSignal = signal<ResetInfo | null>(null);
export const linkErrorSignal = signal<string | null>(null);
export const linkFormSignal = signal<{ name: string; password: string; confirm: string }>({ name: '', password: '', confirm: '' });
export const linkSubmittingSignal = signal<boolean>(false);

/** El token viaja en el fragmento (#19): no llega al servidor ni a los logs. */
export function readLinkToken(hash: string): string | null {
  return new URLSearchParams(hash.replace(/^#/, '')).get('t');
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : 'Error inesperado';
}

export async function loadInvitation(): Promise<void> {
  try {
    invitationInfoSignal.value = await apiFetch<InvitationInfo>('invitations/lookup', { method: 'POST', body: { token: linkTokenSignal.value ?? '' } });
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  }
}

export async function loadReset(): Promise<void> {
  try {
    resetInfoSignal.value = await apiFetch<ResetInfo>('password-resets/lookup', { method: 'POST', body: { token: linkTokenSignal.value ?? '' } });
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  }
}

/** En /invitacion o /restablecer: guarda el token en memoria, lo saca de la URL y consulta el link. */
export function initLinkPageFromUrl(): void {
  if (typeof window === 'undefined') return;
  const route = routeFromPath(window.location.pathname);
  if (route !== 'invitacion' && route !== 'restablecer') return;
  linkTokenSignal.value = readLinkToken(window.location.hash);
  window.history.replaceState(null, '', window.location.pathname);
  if (linkTokenSignal.value === null) {
    linkErrorSignal.value = 'Este link ya no sirve: pedile uno nuevo a quien te lo mandó';
    return;
  }
  void (route === 'invitacion' ? loadInvitation() : loadReset());
}

function checkNewPassword(): boolean {
  const { password, confirm } = linkFormSignal.value;
  if (password.length < PASSWORD_MIN_LENGTH) {
    linkErrorSignal.value = PASSWORD_MIN_MESSAGE;
    return false;
  }
  if (password !== confirm) {
    linkErrorSignal.value = 'Las contraseñas no coinciden';
    return false;
  }
  return true;
}

export async function submitInvitation(): Promise<void> {
  linkErrorSignal.value = null;
  const info = invitationInfoSignal.value;
  if (info === null) return;
  const { name, password } = linkFormSignal.value;
  if (!info.accountExists) {
    if (name.trim().length < 2) {
      linkErrorSignal.value = 'Escribí tu nombre';
      return;
    }
    if (!checkNewPassword()) return;
  }
  linkSubmittingSignal.value = true;
  try {
    const res = await apiFetch<{ token: string; tenantId: string }>('invitations/accept', {
      method: 'POST',
      body: { token: linkTokenSignal.value ?? '', password, ...(info.accountExists ? {} : { name: name.trim() }) },
    });
    await adoptSession(res.token);
    setActiveTenant(res.tenantId);
    navigate('/admin');
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  } finally {
    linkSubmittingSignal.value = false;
  }
}

export async function submitReset(): Promise<void> {
  linkErrorSignal.value = null;
  if (!checkNewPassword()) return;
  linkSubmittingSignal.value = true;
  try {
    const res = await apiFetch<{ token: string }>('password-resets/complete', {
      method: 'POST',
      body: { token: linkTokenSignal.value ?? '', password: linkFormSignal.value.password },
    });
    await adoptSession(res.token);
    navigate('/admin');
  } catch (err: unknown) {
    linkErrorSignal.value = message(err);
  } finally {
    linkSubmittingSignal.value = false;
  }
}
```

(Si `apiFetch` con un `401` en `accept` dispara el `logout` global: no pasa, porque el pedido no
manda `token`; el `401` "Contraseña incorrecta" solo se muestra como error.)

`InvitationView.tsx` y `ResetPasswordView.tsx`: el mismo marco que `AuthView` (fondo, `Logo`,
"mini contax", `ThemeToggle`, `Card`, `versionLabel()` al pie).
- Invitación: con `linkErrorSignal` y sin info, solo el mensaje y un link "Ir a mini contax" (`/`).
  Con info: "**{invitedByName}** te invitó a **{tenantName}** como **{ROLE_LABEL[role]}**". Si
  `accountExists`: "Entrá con tu contraseña de {email}" y un campo de contraseña; si no: nombre,
  contraseña (helper con el mínimo) y repetir. Botón "Aceptar invitación" (`submitInvitation`). Sin
  info ni error: "Cargando…".
- Restablecer: "Nueva contraseña para {email}", dos campos y "Guardar y entrar" (`submitReset`).

`App.tsx`: llamar a `initLinkPageFromUrl()` junto a `initMerchantOnboardingFromUrl()`, y antes del
chequeo de autenticación:

```tsx
if (routeSignal.value === 'invitacion') return <InvitationView />;
if (routeSignal.value === 'restablecer') return <ResetPasswordView />;
```

- [ ] **Paso 4: verlos pasar** — `pnpm test`.

- [ ] **Paso 5: chequeos y commit** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.

```bash
git add src/client test
git commit -m "feat: páginas para aceptar invitaciones y restablecer la contraseña (#19)"
```

Frenar para la revisión.

---

### Tarea 9: Seed de desarrollo, e2e, documentación y versión 0.3.0

**Archivos:**
- Modificar: `src/server/db/dev-seed.ts`, `src/client/state/dev-login.ts` (si lista credenciales),
  `test/bootstrap.test.ts`, `e2e/demo-onboarding.spec.ts`, `AGENTS.md`, `deploy/README.md`,
  `PLAN.md` (si lleva el estado de las etapas), `package.json`
- Crear: `e2e/roles-invitations.spec.ts`

**Interfaces:**
- Consume: todo lo anterior.
- Produce: `DEV_ADMIN2_EMAIL = 'admin2@local.test'`, `DEV_MEMBER_EMAIL = 'empleado@local.test'`
  (contraseña `DEV_ADMIN_PASS`) en `dev-seed.ts`.

- [ ] **Paso 1: tests**

En `test/bootstrap.test.ts`, fuera de producción:

```ts
it('el seed de desarrollo suma un admin y un empleado en tienda-demo (#19)', () => {
  // con el bundle del test existente, después de bootstrap()
  const rows = bundle.systemDb
    .prepare("SELECT u.email, m.role FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = 'tienda-demo' ORDER BY u.email")
    .all() as { email: string; role: string }[];
  expect(rows).toEqual(expect.arrayContaining([
    { email: 'admin2@local.test', role: 'admin' },
    { email: 'empleado@local.test', role: 'member' },
  ]));
});
```

(Y que en producción no existan: el test de producción que ya hay verifica que no se crean usuarios;
sumar estas dos direcciones a esa aserción.)

`e2e/roles-invitations.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/** Criterio de aceptación de #19: el owner invita a un empleado por link, y el empleado no ve lo que no le toca. */
test('el owner invita a un empleado; el empleado entra y no ve usuarios ni operaciones masivas', async ({ page, request, browser }) => {
  const id = randomUUID().slice(0, 8);
  const alta = await request.post('/api/alta', {
    data: { name: 'Owner E2E', email: `owner-${id}@local.test`, password: 'clave-owner-1', businessName: `Kiosco Roles ${id}`, template: 'kiosco' },
  });
  expect(alta.status()).toBe(201);
  const { token } = (await alta.json()) as { token: string };

  // El owner entra, invita desde Usuarios y copia el link
  await page.addInitScript((t) => { window.localStorage.setItem('mini_erp_token', t); }, token);
  await page.goto('/admin');
  await page.getByRole('button', { name: 'Usuarios' }).click();
  await page.getByRole('button', { name: 'Invitar' }).click();
  await page.getByLabel('Correo').fill(`empleado-${id}@local.test`);
  await page.getByRole('button', { name: 'Crear link' }).click();
  const link = await page.getByRole('textbox', { name: 'Link' }).inputValue();
  expect(link).toContain('/invitacion#t=');

  // El empleado abre el link en otro navegador (sin la sesión del owner)
  const other = await browser.newContext();
  const emp = await other.newPage();
  await emp.goto(link);
  await expect(emp.getByText('como Empleado')).toBeVisible();
  expect(emp.url()).not.toContain('#t=');
  await emp.getByLabel('Tu nombre').fill('Empleado E2E');
  await emp.getByLabel('Contraseña', { exact: true }).fill('clave-emp-12');
  await emp.getByLabel('Repetir contraseña').fill('clave-emp-12');
  await emp.getByRole('button', { name: 'Aceptar invitación' }).click();

  await expect(emp.getByRole('button', { name: 'Catálogo & Precios' })).toBeVisible();
  await expect(emp.getByRole('button', { name: 'Usuarios' })).toHaveCount(0);
  await expect(emp.getByRole('button', { name: 'Operaciones Masivas' })).toHaveCount(0);
  await other.close();
});
```

(Las etiquetas `Correo`, `Link`, `Tu nombre`, `Contraseña`, `Repetir contraseña` son las de
`InviteModal`, `LinkReadyModal` e `InvitationView`: ajustar acá o allá para que coincidan; el
`<input readonly>` del link lleva `aria-label="Link"`.)

`e2e/demo-onboarding.spec.ts`: el placeholder pasa a `Mínimo 8 caracteres` y la contraseña
`prueba-e2e` (10 caracteres) sigue sirviendo; el resto del recorrido no cambia (el alta ahora es
un solo pedido, invisible para el e2e).

- [ ] **Paso 2: verlos fallar** — `pnpm test test/bootstrap.test.ts` y `pnpm test:e2e`.

- [ ] **Paso 3: implementar**

`dev-seed.ts`, después de asegurar `tienda-demo`:

```ts
export const DEV_ADMIN2_EMAIL = 'admin2@local.test';
export const DEV_MEMBER_EMAIL = 'empleado@local.test';

// Usuarios para probar los roles a mano (#19)
for (const [email, name, role] of [
  [DEV_ADMIN2_EMAIL, 'Admin Demo', 'admin'],
  [DEV_MEMBER_EMAIL, 'Empleado Demo', 'member'],
] as const) {
  const existing = params.authService.findUserByEmail(email);
  const userId = existing?.id ?? params.authService.createUser({ email, password: DEV_ADMIN_PASS, name }).user.id;
  params.systemDb
    .prepare("INSERT OR IGNORE INTO memberships (user_id, tenant_id, role, status, created_at) VALUES (?, ?, ?, 'active', ?)")
    .run(userId, DEV_TENANT_ID, role, new Date().toISOString());
}
```

(`DEV_ADMIN_PASS = 'admin123'` tiene 8 caracteres: cumple el mínimo.)

`AGENTS.md`, en "Arquitectura", una viñeta nueva **Roles e invitaciones (#19)**:
- matriz en `src/shared/permissions.ts` (capacidades `tenant.use`, `bulk`, `settings.manage`,
  `users.manage`, `owners.manage`); `requirePermission` en **cada** ruta de
  `/api/tenants/:tenantId` y `test/permissions-api.test.ts` falla si una ruta no está en su tabla;
  el cliente esconde con `canDo` (`state/permissions-state.ts`);
- root y support impersonando cuentan como owner hasta M7;
- links de invitación y restablecimiento de un solo uso, 48 h, token en el fragmento, hasheado;
- sin registro suelto: una cuenta nace en `POST /api/alta` o aceptando una invitación;
- contraseña mínima de 8 en `src/shared/password.ts`;
- auditoría en `audit_log` (`AuditLog`), la ve el owner en Usuarios → Actividad;
- esquema de sistema 4 sin migraciones: una `data/` vieja se borra.
Y en "Estado": M2 hecha.

`deploy/README.md`, sección nueva **"Reiniciar producción (M2, #19)"**, que corre el usuario
después del merge, el tag `v0.3.0` y el deploy:

```bash
ssh <usuario>@mini.contax.ar
sudo systemctl stop mini-erp
sudo rm -rf /var/lib/mini-erp/*
sudo systemctl start mini-erp
sudo -u minierp bash -c 'set -a; . /etc/mini-erp/env; cd /opt/mini-erp/current && node scripts/create-root.ts'
curl -s https://mini.contax.ar/health
```

con la aclaración de que se pierde todo (comercios, cuentas, demos y el root, que se vuelve a crear
con mínimo de 8 caracteres) y de que los backups de `mini-erp-backup.timer` quedan con datos viejos
hasta la próxima corrida. (Revisar al escribir que `/var/lib/mini-erp` sea el directorio de datos
según `deploy/` y que el arranque recree la base vacía.)

Versión: `pnpm version minor --no-git-tag-version` (0.2.1 → **0.3.0**); `test/release-version.test.ts`
y `/health` la toman de `package.json`.

- [ ] **Paso 4: verlos pasar** — `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e`.

- [ ] **Paso 5: commit**

```bash
git add src/server/db/dev-seed.ts test e2e AGENTS.md deploy/README.md PLAN.md package.json
git commit -m "docs: roles e invitaciones en AGENTS.md, reinicio de producción y versión 0.3.0 (#19)"
```

Frenar para la revisión. Después: informe final con la prueba manual, y el PR (merge commit,
`Closes #19`) cuando el usuario lo apruebe.
