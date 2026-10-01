# M1 · Marca y limpieza: plan de implementación

> **Para agentes:** se ejecuta con superpowers:executing-plans, **inline y tarea por tarea** (nunca un
> subagente por tarea, AGENTS.md). Al terminar cada tarea: verificar, commitear y frenar para la
> revisión del usuario. Pasos con casillas (`- [ ]`).

**Objetivo:** que `https://mini.contax.ar` se vea como **mini contax** (logo, favicon, versión de mini,
textos para el comerciante), sin restos de desarrollo, y que el dashboard muestre el ranking real de
las ventas del POS (#18, con #15 y #7).

**Arquitectura:** cambios de cliente (componente `Logo`, versión inyectada por Vite, textos) con un
test de guardia contra la marca vieja; en el servidor, el ranking pasa a leer las líneas con un
esquema Zod del contrato y la fórmula del POS, y el seed de historial se alinea al contrato. En el
estado del dashboard, un effect por cosa que se carga.

**Stack:** Node 24 (strip de tipos), Express 4, `node:sqlite`, Zod 3, Preact + `@preact/signals`,
Tailwind v4, Vite, Vitest, Playwright.

**Spec:** [`docs/superpowers/specs/2026-10-01-mvp-mini-contax-design.md`](../specs/2026-10-01-mvp-mini-contax-design.md),
secciones "Marca" y "Etapas y orden" (M1). Issue rauldiazsolis/mini-erp#18; bugs #15 y #7. Las
decisiones de detalle se tomaron en el brainstorming del 2026-10-01 y están resumidas abajo.

## Decisiones del brainstorming

- **Logo de la app**: el ticket "T3" (ticket blanco de esquinas rectas con corte dentado, "c" y un
  renglón en indigo, sobre cuadrado `#4f46e5` con `rx=8`). **Favicon**: el "B2" (ticket que ocupa casi
  todo el cuadrado, bordes finos arriba y a los costados, corte de 4 dientes y "c" grande). Colores
  como hoy (`indigo-600` = `#4f46e5`).
- **Ranking**: las líneas `freeform` entran agrupadas por descripción normalizada (sin distinguir
  mayúsculas ni espacios), con una marca "sin código". Productos borrados: "Producto eliminado".
- **#7**: un effect carga sucursales (depende de tenant y token) y otro el resumen (tenant, token y
  filtros). Reemplaza al `untracked` que sugería el issue y también evita el resumen doble inicial.
- Afuera: nombre del repo y del paquete, `/health`, `GET /info`, la clave `mini_erp_theme_mode`, los
  🚀 de botones que no son marca, los textos que usa el e2e ("Continuar a Datos del Negocio →",
  "Aprovisionar Mi Comercio", "Probar la demo") y la versión de `package.json` (sigue `0.1.0`).

## Restricciones globales

- Todo en español: código, comentarios, commits, docs. Marca escrita siempre **"mini contax"** (en
  minúsculas).
- TypeScript estricto: sin `any`, sin `as` ni `!` para callar errores; `unknown` solo en fronteras y
  validado con Zod. Imports relativos con extensión. Sin hooks de Preact (solo signals).
- Opcionales con `exactOptionalPropertyTypes`: en resultados propios la propiedad se omite
  (`...(x === undefined ? {} : { x })`).
- Sin dependencias nuevas.
- Verificación de cada tarea (PowerShell): `pnpm lint; if ($?) { pnpm typecheck }; if ($?) { pnpm test }`
  y `pnpm build` si se toca el cliente. git y gh desde Bash.
- Textos prohibidos en la UI (los vigila el test de la Tarea 4): `mini-erp`/`Mini-ERP`, `Express`
  (palabra suelta), `Multitenant`, `Connector v<n>`, `Puerto: <n>`, `TPV`.

---

### Task 1: Logo, favicon, título y versión de mini

**Files:**
- Create: `src/client/components/ui/Logo.tsx`
- Create: `src/client/public/favicon.svg`
- Create: `src/client/state/app-version.ts`
- Create: `test/brand.test.ts`
- Modify: `vite.config.ts`, `src/client/vite-env.d.ts`, `src/client/index.html`

**Interfaces:**
- Produces: `Logo(props: { class?: string | undefined })` (SVG del T3, `aria-hidden`); `APP_VERSION: string`;
  `resolveAppVersion(raw: string | undefined): string`; `versionLabel(version?: string): string`
  (`'mini contax v0.1.0'`); `appVersionDefine` exportado de `vite.config.ts`.

- [ ] **Step 1: Test que falla** (`test/brand.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { appVersionDefine } from '../vite.config.ts';
import { resolveAppVersion, versionLabel } from '../src/client/state/app-version.ts';

const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as { version: string };

describe('Marca mini contax (#18)', () => {
  it('Vite inyecta la versión de package.json', () => {
    expect(appVersionDefine['import.meta.env.VITE_APP_VERSION']).toBe(JSON.stringify(pkg.version));
  });

  it('la versión cae en "dev" si no se inyectó', () => {
    expect(resolveAppVersion('0.1.0')).toBe('0.1.0');
    expect(resolveAppVersion(undefined)).toBe('dev');
    expect(resolveAppVersion('  ')).toBe('dev');
  });

  it('la etiqueta dice mini contax y la versión', () => {
    expect(versionLabel('0.1.0')).toBe('mini contax v0.1.0');
    expect(versionLabel('dev')).toBe('mini contax (desarrollo)');
  });

  it('index.html tiene el título y el favicon', () => {
    const html = readFileSync('src/client/index.html', 'utf-8');
    expect(html).toContain('<title>mini contax</title>');
    expect(html).toContain('<link rel="icon" type="image/svg+xml" href="/favicon.svg" />');
    expect(readFileSync('src/client/public/favicon.svg', 'utf-8')).toContain('<svg');
  });
});
```

- [ ] **Step 2: Correr y ver que falla**: `pnpm vitest run test/brand.test.ts` → falla (no existen
  `appVersionDefine` ni `app-version.ts`).

- [ ] **Step 3: Implementar**

`vite.config.ts`:

```typescript
import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';
import pkg from './package.json' with { type: 'json' };

/** La versión de mini (la de package.json) para el cliente; solo viaja el número, no el package.json. */
export const appVersionDefine = {
  'import.meta.env.VITE_APP_VERSION': JSON.stringify(pkg.version),
};

export default defineConfig({
  plugins: [preact(), tailwindcss()],
  root: resolve(import.meta.dirname, 'src/client'),
  define: appVersionDefine,
  build: {
    outDir: resolve(import.meta.dirname, 'dist/client'),
    emptyOutDir: true,
  },
  server: {
    port: 4100,
  },
});
```

`src/client/vite-env.d.ts`: sumar a `ImportMetaEnv`

```typescript
  /** Versión de mini (la de package.json), la inyecta `vite.config.ts` al compilar (#18). */
  readonly VITE_APP_VERSION?: string;
```

`src/client/state/app-version.ts`:

```typescript
/** Versión de mini que se muestra en el pie del menú y del login (#18). */
export function resolveAppVersion(raw: string | undefined): string {
  const value = raw?.trim() ?? '';
  return value === '' ? 'dev' : value;
}

export const APP_VERSION: string = resolveAppVersion(import.meta.env.VITE_APP_VERSION);

export function versionLabel(version: string = APP_VERSION): string {
  return version === 'dev' ? 'mini contax (desarrollo)' : `mini contax v${version}`;
}
```

`src/client/components/ui/Logo.tsx` (T3):

```tsx
/** Logo de mini contax (#18): un ticket de caja con la "c" de Contax. El favicon es otra variante. */
export function Logo(props: { class?: string | undefined }) {
  return (
    <svg class={props.class ?? 'w-10 h-10'} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path d="M9.5 6.5h13v19l-2.17-1.5-2.16 1.5-2.17-1.5-2.17 1.5-2.16-1.5-2.17 1.5z" fill="#fff" />
      <path d="M18.3 11.7A3.3 3.3 0 1 0 18.3 16.3" fill="none" stroke="#4f46e5" stroke-width="2.2" stroke-linecap="round" />
      <path d="M12.5 20.5h7" stroke="#4f46e5" stroke-width="1.6" stroke-linecap="round" />
    </svg>
  );
}
```

`src/client/public/favicon.svg` (B2):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#4f46e5"/>
  <path d="M8 3H24A5 5 0 0 1 29 8V25.5L25.75 22.5L22.5 25.5L19.25 22.5L16 25.5L12.75 22.5L9.5 25.5L6.25 22.5L3 25.5V8A5 5 0 0 1 8 3Z" fill="#fff"/>
  <path d="M19.89 9.11A5.5 5.5 0 1 0 19.89 16.89" fill="none" stroke="#4f46e5" stroke-width="3.4" stroke-linecap="round"/>
</svg>
```

`src/client/index.html`: `<title>mini contax</title>` y, debajo,
`<link rel="icon" type="image/svg+xml" href="/favicon.svg" />`. (Vite sirve `src/client/public/` en
desarrollo y lo copia a `dist/client/` al compilar; en producción lo sirve `express.static`.)

- [ ] **Step 4: Verificar**: `pnpm vitest run test/brand.test.ts` en verde; después lint, typecheck,
  test y `pnpm build` (confirmar que `dist/client/favicon.svg` existe).

- [ ] **Step 5: Commit**: `feat: logo, favicon y versión de mini contax (#18)`.

---

### Task 2: Login sin restos de desarrollo

**Files:**
- Create: `src/client/state/dev-login.ts`
- Modify: `src/client/components/auth/LoginForm.tsx`, `src/client/components/auth/AuthView.tsx`
- Test: `test/brand.test.ts`

**Interfaces:**
- Consumes: `Logo`, `versionLabel` (Task 1).
- Produces: `devLoginDefaults(isDev: boolean): { email: string; password: string }`.

- [ ] **Step 1: Test que falla** (sumar a `test/brand.test.ts`)

```typescript
import { devLoginDefaults } from '../src/client/state/dev-login.ts';

describe('Login sin datos de desarrollo en producción (#18)', () => {
  it('precarga el admin del seed solo en desarrollo', () => {
    expect(devLoginDefaults(true)).toEqual({ email: 'admin@local.test', password: 'admin123' });
    expect(devLoginDefaults(false)).toEqual({ email: '', password: '' });
  });
});
```

- [ ] **Step 2: Correr y ver que falla** (no existe `dev-login.ts`).

- [ ] **Step 3: Implementar**

`src/client/state/dev-login.ts`:

```typescript
/** Las credenciales del seed de desarrollo (`src/server/db/dev-seed.ts`); en producción no existen. */
const DEV_ADMIN = { email: 'admin@local.test', password: 'admin123' };

/** Lo que precarga el login: el admin del seed en desarrollo, nada en producción (#18). */
export function devLoginDefaults(isDev: boolean): { email: string; password: string } {
  return isDev ? { ...DEV_ADMIN } : { email: '', password: '' };
}
```

`LoginForm.tsx`:
- `const initial = devLoginDefaults(import.meta.env.DEV);` y los signals arrancan con
  `initial.email` / `initial.password`.
- `handleFillDemo` usa `devLoginDefaults(true)`; el botón se renderiza solo con
  `import.meta.env.DEV` y dice "Rellenar credenciales de desarrollo".

`AuthView.tsx`:
- Ícono del rayo → `<Logo class="w-14 h-14 mb-4 inline-block" />`.
- Título `mini contax`; subtítulo "Caja, stock, clientes y cuentas corrientes de tu comercio".
- Recuadro de alta: "¿Todavía no tenés tu comercio en mini contax?" y botón "Crear mi comercio"
  (sin 🚀; mismo `openMerchantOnboarding`). El comentario JSX pasa a "Acceso directo al alta".
- Pie: `{versionLabel()}` en lugar de "offline-pos • Mini-ERP Multitenant v4.2.0".

- [ ] **Step 4: Verificar** (lint, typecheck, test, build).
- [ ] **Step 5: Commit**: `feat: login de mini contax sin credenciales de desarrollo en producción (#18)`.

---

### Task 3: Landing para el comerciante

**Files:**
- Modify: `src/client/components/landing/LandingView.tsx`

**Interfaces:**
- Consumes: `Logo`, `versionLabel` (Task 1); `POS_VERSION`, `buildDemoUrl`, `posBaseUrl`,
  `publishedPosOrigin` (sin cambios).

- [ ] **Step 1: Implementar** (es solo texto y maquetado; lo cubren el test de guardia de la Tarea 4 y
  el e2e, que busca el link "Probar la demo")
- Comentario del componente: "Landing en la raíz (#9, #18): le habla al comerciante y abre el POS en
  demo contra este backend…".
- Encabezado: `<Logo class="w-8 h-8" />` + "mini contax"; link "Entrar" a `/admin`.
- `h1`: "Tu comercio, con un POS que vende aunque se corte internet" (queda).
- Párrafo: "Caja, catálogo, stock, clientes y cuentas corrientes en un solo lugar. El punto de venta
  sigue vendiendo sin internet y mini contax ordena todo cuando vuelve la conexión. Probalo con un
  comercio de ejemplo, sin registrarte."
- Botón "Probar la demo" (igual).
- Nota chica: en desarrollo, "Abre una copia local del POS {POS_VERSION} publicado, servida por este
  backend."; en producción, "Se abre el punto de venta con un comercio de ejemplo."
- Pie nuevo: `{versionLabel()} · powered by <a href="https://github.com/rauldiazsolis/offline-pos">offline-pos</a>`
  en `text-xs text-slate-500`.

- [ ] **Step 2: Verificar** (lint, typecheck, test, build) y `pnpm test:e2e` (toca el recorrido de la
  demo).
- [ ] **Step 3: Commit**: `feat: landing de mini contax para el comerciante (#18)`.

---

### Task 4: Admin y alta con la marca, y test de guardia

**Files:**
- Modify: `src/client/components/shell/Sidebar.tsx`, `src/client/components/shell/OnboardingModal.tsx`,
  `src/client/components/settings/AppearanceSection.tsx`, `src/client/components/settings/PosKeysSection.tsx`,
  `src/client/components/dashboard/TopProductsTable.tsx`, `src/client/components/onboarding/MerchantOnboardingView.tsx`
- Test: `test/brand.test.ts`

**Interfaces:**
- Consumes: `Logo`, `versionLabel` (Task 1).

- [ ] **Step 1: Test de guardia que falla** (sumar a `test/brand.test.ts`)

```typescript
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

function clientUiFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return clientUiFiles(path);
    return path.endsWith('.tsx') || path.endsWith('.html') ? [path] : [];
  });
}

const FORBIDDEN: RegExp[] = [/mini-erp/i, /\bExpress\b/, /Multitenant/i, /Connector v\d/, /Puerto: \d/, /\bTPV\b/];

describe('Sin la marca vieja en la UI (#18)', () => {
  it.each(clientUiFiles('src/client'))('%s', (file) => {
    const source = readFileSync(file, 'utf-8');
    for (const pattern of FORBIDDEN) {
      expect(source, `${file} contiene ${String(pattern)}`).not.toMatch(pattern);
    }
  });
});
```

- [ ] **Step 2: Correr y ver que falla** en `Sidebar.tsx`, `OnboardingModal.tsx`,
  `AppearanceSection.tsx`, `PosKeysSection.tsx`, `TopProductsTable.tsx` y
  `MerchantOnboardingView.tsx` (y en cualquier otro que aparezca: se corrige igual).

- [ ] **Step 3: Implementar**
- `Sidebar.tsx`: el cuadrado con el rayo → `<Logo class="w-10 h-10" />`; nombre "mini contax", sin la
  línea "Connector v4.2.0". El pie "Offline-POS · Online · Puerto: 4100 • Express" →
  `<div class="px-3 text-[11px] text-slate-500 dark:text-slate-400">{versionLabel()}</div>`.
- `OnboardingModal.tsx`: "Nuevo comercio en mini contax".
- `AppearanceSection.tsx`: "Elegí cómo ver el panel de mini contax. Tu preferencia se guarda en este
  navegador."
- `PosKeysSection.tsx`: "Creá tu primera llave para vincular tu caja con mini contax."
- `TopProductsTable.tsx`: se va el pie ("Datos auditados del TPV" / "Connector v4.2.0").
- `MerchantOnboardingView.tsx`: el 🚀 del encabezado → `<Logo class="w-10 h-10" />`; título
  "mini contax", subtítulo "Alta de tu comercio"; "Ir al Panel Mini-ERP →" e "Ingresar al Panel de
  Mini-ERP →" → "Ir al panel de mini contax →".

- [ ] **Step 4: Verificar** (lint, typecheck, test, build) y `pnpm test:e2e` (toca el alta).
- [ ] **Step 5: Commit**: `feat: admin y alta con la marca mini contax (#18, #16)`.

---

### Task 5: Ranking real de las ventas del POS (#15)

**Files:**
- Create: `src/server/dashboard/sale-lines.ts`
- Create: `test/dashboard-top-products.test.ts`
- Modify: `src/server/dashboard/dashboard-service.ts` (tipo `TopProductItem` y `calculateTopProducts`)
- Modify: `src/server/seeds/demo-activity-generator.ts` (líneas y medio de pago del contrato)
- Modify: `src/client/state/dashboard-state.ts` (tipo `TopProductItem`),
  `src/client/components/dashboard/TopProductsTable.tsx`, `test/dashboard-client.test.ts` (mock)

**Interfaces:**
- Produces: `saleLineSchema` (Zod, unión por `kind`), `type SaleLine`, `roundAmount(value: number): number`,
  `lineTotal(line: SaleLine): number`, `parseSaleLines(payload: string): SaleLine[]`;
  `TopProductItem = { key: string; kind: 'product' | 'freeform'; productId?: string; name: string; unitsSold: number; totalRevenue: number }`
  (mismo tipo en servidor y cliente).

- [ ] **Step 1: Test que falla** (`test/dashboard-top-products.test.ts`)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { DashboardService } from '../src/server/dashboard/dashboard-service.ts';
import { lineTotal, saleLineSchema } from '../src/server/dashboard/sale-lines.ts';
import { generateHistoricalDemoActivity } from '../src/server/seeds/demo-activity-generator.ts';

function insertProduct(db: DatabaseSync, id: string, name: string, price: number): void {
  const now = new Date().toISOString();
  db.prepare('INSERT INTO products (id, sku, name, price, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').run(
    id, `SKU-${id}`, name, price, now, now,
  );
}

function insertSale(db: DatabaseSync, id: string, payload: string, total: number): void {
  db.prepare(
    `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at)
     VALUES (?, ?, 'pos_1', 'CENTRAL', 'Caja 1', ?, NULL, ?)`,
  ).run(id, payload, total, new Date().toISOString());
}

describe('Total de línea como el POS (#15)', () => {
  it.each([
    [{ kind: 'product', productId: 'p', qty: 2, unitPrice: 1000 }, 2000],
    [{ kind: 'product', productId: 'p', qty: 2, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }, 1800],
    [{ kind: 'freeform', description: 'x', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 100 } }, 400],
    [{ kind: 'product', productId: 'p', qty: -1, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }, -900],
    [{ kind: 'product', productId: 'p', qty: 1, unitPrice: 100, discount: { type: 'amount', value: 500 } }, 0],
    [{ kind: 'product', productId: 'p', qty: 0.333, unitPrice: 1000 }, 333],
  ])('%j → %d', (raw, expected) => {
    expect(lineTotal(saleLineSchema.parse(raw))).toBe(expected);
  });
});

describe('Ranking de más vendidos con ventas del POS (#15)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    initTenantDb(db);
    insertProduct(db, 'p1', 'Alfajor Triple Dulce de Leche', 950);
    insertProduct(db, 'p2', 'Gaseosa 500 ml', 1000);
  });

  it('nombres del catálogo, importes con descuento, freeform agrupadas y productos borrados', () => {
    insertSale(db, 's1', JSON.stringify({
      id: 's1', status: 'closed', total: 3150, createdAt: new Date().toISOString(),
      payments: [{ method: 'cash', amount: 3150 }],
      lines: [
        { kind: 'product', productId: 'p1', qty: 1, unitPrice: 950 },
        { kind: 'product', productId: 'p2', qty: 2, unitPrice: 1000, discount: { type: 'percentage', value: 10 } },
        { kind: 'freeform', description: 'Varios ', qty: 1, unitPrice: 500, discount: { type: 'amount', value: 100 } },
        { name: 'línea inventada', lineTotal: 99999 },
      ],
    }), 3150);
    insertSale(db, 's2', JSON.stringify({
      id: 's2', status: 'closed', total: 500, createdAt: new Date().toISOString(),
      payments: [{ method: 'cash', amount: 500 }],
      lines: [
        { kind: 'freeform', description: '  VARIOS', qty: 1, unitPrice: 300 },
        { kind: 'product', productId: 'p-borrado', qty: 1, unitPrice: 200 },
      ],
    }), 500);
    insertSale(db, 's3', JSON.stringify({
      id: 's3', status: 'closed', total: -900, createdAt: new Date().toISOString(),
      payments: [{ method: 'cash', amount: -900 }],
      lines: [{ kind: 'product', productId: 'p2', qty: -1, unitPrice: 1000, discount: { type: 'percentage', value: 10 } }],
    }), -900);
    insertSale(db, 's4', '{no es json', 0);

    const { topProducts } = new DashboardService(db).getSummary({ period: 'today' });

    expect(topProducts).toEqual([
      { key: 'freeform:varios', kind: 'freeform', name: 'Varios', unitsSold: 2, totalRevenue: 700 },
      { key: 'product:p1', kind: 'product', productId: 'p1', name: 'Alfajor Triple Dulce de Leche', unitsSold: 1, totalRevenue: 950 },
      { key: 'product:p2', kind: 'product', productId: 'p2', name: 'Gaseosa 500 ml', unitsSold: 1, totalRevenue: 900 },
      { key: 'product:p-borrado', kind: 'product', productId: 'p-borrado', name: 'Producto eliminado', unitsSold: 1, totalRevenue: 200 },
    ]);
  });

  it('el historial simulado de las demos usa líneas y medios de pago del contrato', () => {
    insertProduct(db, 'p3', 'Yerba 1 kg', 3200);
    db.prepare("INSERT INTO branches (id, name, code, created_at) VALUES ('b1', 'Central', 'CENTRAL', ?)").run(new Date().toISOString());
    generateHistoricalDemoActivity(db, 'b1');

    const rows = db.prepare('SELECT payload FROM sales').all() as Array<{ payload: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const sale = JSON.parse(row.payload) as { lines: Array<Record<string, unknown>>; payments: Array<{ method: string }> };
      for (const line of sale.lines) {
        expect(saleLineSchema.safeParse(line).success).toBe(true);
        expect(line).not.toHaveProperty('name');
        expect(line).not.toHaveProperty('lineTotal');
      }
      for (const payment of sale.payments) {
        expect(['cash', 'debit', 'credit', 'transfer', 'qr', 'account']).toContain(payment.method);
      }
    }
  });
});
```

(Las columnas de `branches` son `id, name, code, created_at`. El `as` del `JSON.parse` en un test es
aceptable, como en los tests existentes.)

- [ ] **Step 2: Correr y ver que falla** (no existe `sale-lines.ts`).

- [ ] **Step 3: Implementar**

`src/server/dashboard/sale-lines.ts`:

```typescript
import { z } from 'zod';

/** Líneas de venta del contrato (`ProductSaleLine` / `FreeformSaleLine`), para leer el payload guardado. */
const discountSchema = z.object({ type: z.enum(['amount', 'percentage']), value: z.number() });

export const saleLineSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('product'),
    productId: z.string().min(1),
    qty: z.number(),
    unitPrice: z.number(),
    discount: discountSchema.optional(),
  }),
  z.object({
    kind: z.literal('freeform'),
    description: z.string(),
    qty: z.number(),
    unitPrice: z.number(),
    discount: discountSchema.optional(),
  }),
]);

export type SaleLine = z.infer<typeof saleLineSchema>;

export function roundAmount(value: number): number {
  return Math.round((value + Math.sign(value) * Number.EPSILON) * 100) / 100;
}

/**
 * Total de la línea con su descuento, con la misma fórmula del POS (`calculateLineTotal` en
 * offline-pos `src/domain/totals.ts`): el descuento se toma sobre el valor absoluto, con el signo de
 * la línea, y nunca supera la línea. El ajuste global del ticket no es de ninguna línea.
 */
export function lineTotal(line: SaleLine): number {
  const subtotal = line.unitPrice * line.qty;
  const magnitude = Math.abs(subtotal);
  const discount =
    line.discount === undefined
      ? 0
      : line.discount.type === 'amount'
        ? line.discount.value
        : magnitude * (line.discount.value / 100);
  return roundAmount(subtotal - Math.sign(subtotal) * Math.min(discount, magnitude));
}

const storedSaleSchema = z.object({ lines: z.array(z.unknown()) });

/** Las líneas válidas de una venta guardada; un payload roto o una línea que no valida se saltean. */
export function parseSaleLines(payload: string): SaleLine[] {
  let raw: unknown;
  try {
    raw = JSON.parse(payload);
  } catch {
    return [];
  }
  const sale = storedSaleSchema.safeParse(raw);
  if (!sale.success) return [];
  return sale.data.lines.flatMap((line) => {
    const parsed = saleLineSchema.safeParse(line);
    return parsed.success ? [parsed.data] : [];
  });
}
```

`dashboard-service.ts`:

```typescript
export type TopProductItem = {
  key: string;
  kind: 'product' | 'freeform';
  productId?: string;
  name: string;
  unitsSold: number;
  totalRevenue: number;
};
```

```typescript
  /**
   * Top 5 por unidades (#15): productos por `productId`, con el nombre del catálogo; líneas
   * `freeform` agrupadas por descripción normalizada. Importes con la fórmula del POS.
   */
  private calculateTopProducts(sales: SaleRow[]): TopProductItem[] {
    type Entry = { key: string; kind: 'product' | 'freeform'; productId?: string; label: string; units: number; revenue: number };
    const entries = new Map<string, Entry>();

    for (const sale of sales) {
      for (const line of parseSaleLines(sale.payload)) {
        let key: string;
        let fresh: Entry;
        if (line.kind === 'product') {
          key = `product:${line.productId}`;
          fresh = { key, kind: 'product', productId: line.productId, label: '', units: 0, revenue: 0 };
        } else {
          const normalized = line.description.trim().replace(/\s+/g, ' ').toLowerCase();
          if (normalized === '') continue;
          key = `freeform:${normalized}`;
          fresh = { key, kind: 'freeform', label: line.description.trim().replace(/\s+/g, ' '), units: 0, revenue: 0 };
        }
        const entry = entries.get(key) ?? fresh;
        entry.units += line.qty;
        entry.revenue += lineTotal(line);
        entries.set(key, entry);
      }
    }

    const top = Array.from(entries.values())
      .sort((a, b) => b.units - a.units || b.revenue - a.revenue)
      .slice(0, 5);
    const names = this.productNames(top.flatMap((e) => (e.productId === undefined ? [] : [e.productId])));

    return top.map((e) => ({
      key: e.key,
      kind: e.kind,
      ...(e.productId === undefined ? {} : { productId: e.productId }),
      name: e.productId === undefined ? e.label : (names.get(e.productId) ?? 'Producto eliminado'),
      unitsSold: Math.round(e.units * 1000) / 1000,
      totalRevenue: roundAmount(e.revenue),
    }));
  }

  private productNames(ids: string[]): Map<string, string> {
    if (ids.length === 0) return new Map();
    const rows = this.db
      .prepare(`SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(', ')})`)
      .all(...ids) as unknown as Array<{ id: string; name: string }>;
    return new Map(rows.map((r) => [r.id, r.name]));
  }
```

(Import: `import { lineTotal, parseSaleLines, roundAmount } from './sale-lines.ts';`. La variante
freeform toma como etiqueta la primera descripción que aparece.)

`demo-activity-generator.ts`: las líneas pasan a `{ kind: 'product', productId, qty, unitPrice }` (sin
`name` ni `lineTotal`; el total de la venta se sigue sumando con `price * qty`), y el medio de pago
`'card'` pasa a `'debit'`.

Cliente: `TopProductItem` de `dashboard-state.ts` igual al del servidor. En `TopProductsTable.tsx`,
`key={item.key}` y, si `item.kind === 'freeform'`, una marca chica después del nombre:
`<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">sin código</span>`.
En `test/dashboard-client.test.ts`, el mock de `topProducts` suma `key` y `kind: 'product'`.

- [ ] **Step 4: Verificar**: el test nuevo y `test/dashboard-summary.test.ts` en verde; después lint,
  typecheck, test y build.
- [ ] **Step 5: Commit**: `fix: el ranking del dashboard lee las ventas como las manda el POS (#15)`.

---

### Task 6: Una sola carga por cambio de filtro (#7)

**Files:**
- Modify: `src/client/state/dashboard-state.ts` (los dos `effect` del final)
- Create: `test/dashboard-effects.test.ts`

**Interfaces:**
- Produces: `registerDashboardEffects(): () => void` (registra los effects y devuelve con qué
  desregistrarlos).

- [ ] **Step 1: Test que falla** (`test/dashboard-effects.test.ts`)

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../src/client/api/client.ts', () => ({ apiFetch: vi.fn(() => Promise.resolve([])) }));

import { apiFetch } from '../src/client/api/client.ts';
import { activeTenantIdSignal, tokenSignal } from '../src/client/state/auth-state.ts';
import { registerDashboardEffects, selectedPeriodSignal, selectedBranchSignal } from '../src/client/state/dashboard-state.ts';

const calls = (fragment: string): number =>
  vi.mocked(apiFetch).mock.calls.filter(([endpoint]) => endpoint.includes(fragment)).length;

describe('Recargas del dashboard (#7)', () => {
  let dispose: (() => void) | undefined;

  afterEach(() => {
    dispose?.();
    vi.mocked(apiFetch).mockClear();
  });

  it('carga una vez al entrar, una vez el resumen por filtro y las sucursales solo por tenant', () => {
    tokenSignal.value = 'token';
    activeTenantIdSignal.value = 'kiosco';
    selectedPeriodSignal.value = 'week';
    selectedBranchSignal.value = '';
    dispose = registerDashboardEffects();
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(1);

    vi.mocked(apiFetch).mockClear();
    selectedPeriodSignal.value = 'today';
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(0);

    vi.mocked(apiFetch).mockClear();
    selectedBranchSignal.value = 'branch-central';
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(0);

    vi.mocked(apiFetch).mockClear();
    activeTenantIdSignal.value = 'almacen';
    expect(calls('/dashboard/summary')).toBe(1);
    expect(calls('/branches')).toBe(1);
  });
});
```

- [ ] **Step 2: Correr y ver que falla** (no existe `registerDashboardEffects`).

- [ ] **Step 3: Implementar** (reemplaza el bloque final de `dashboard-state.ts`)

```typescript
/**
 * Reactividad sin hooks (#7): un effect por cosa que se carga. Las sucursales dependen solo del
 * tenant y del token; el resumen, de eso y de los filtros. Así un filtro recarga solo el resumen, una
 * vez, y al entrar no se pide dos veces.
 */
export function registerDashboardEffects(): () => void {
  const disposeBranches = effect(() => {
    if (effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchBranches();
    }
  });

  const disposeSummary = effect(() => {
    const filters = { period: selectedPeriodSignal.value, branch: selectedBranchSignal.value };
    if (effectiveTenantIdSignal.value && tokenSignal.value) {
      void fetchDashboardData(filters);
    }
  });

  return () => {
    disposeBranches();
    disposeSummary();
  };
}

if (typeof window !== 'undefined') {
  registerDashboardEffects();
}
```

(`fetchBranches` y `fetchDashboardData` leen tenant y token antes del primer `await`: son las mismas
dependencias que ya tiene cada effect, así que no suman suscripciones.)

- [ ] **Step 4: Verificar** (lint, typecheck, test, build).
- [ ] **Step 5: Commit**: `fix: cambiar un filtro del dashboard recarga una sola vez el resumen (#7)`.

---

### Task 7: Docs, e2e e informe

**Files:**
- Modify: `AGENTS.md` (sección Cliente y Estado), `PLAN.md` si lista etapas, `README.md` si nombra la
  marca vieja en lo que ve un comerciante.

- [ ] **Step 1: Docs**: en `AGENTS.md`, bajo **Cliente**, un punto "Marca (#18): mini contax; logo en
  `components/ui/Logo.tsx` (ticket) y favicon `public/favicon.svg`; la versión de mini sale de
  `package.json` (`appVersionDefine` en `vite.config.ts`, `state/app-version.ts`); `test/brand.test.ts`
  vigila que no vuelva la marca vieja a la UI. Credenciales del seed solo en desarrollo
  (`state/dev-login.ts`)." En **Estado**, M1 hecha.
- [ ] **Step 2: Verificación completa**: `pnpm lint; pnpm typecheck; pnpm test; pnpm build; pnpm test:e2e`.
- [ ] **Step 3: Commit**: `docs: marca mini contax en AGENTS.md (#18)`.
- [ ] **Step 4: Informe final** con la prueba manual paso a paso (landing, login en desarrollo y lo que
  cambia en producción, admin con logo y versión, favicon en los dos temas, ranking con una venta del
  POS con descuento y una línea manual, un solo pedido por filtro en la pestaña Red). PR con
  "Closes #18", "Closes #15" y "Closes #7" cuando el usuario lo apruebe.
