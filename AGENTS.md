# AGENTS.md

Reglas para trabajar en este repo. Cada decisión nueva de arquitectura o de convención se anota acá
en el mismo trabajo que la toma. La historia de las fases está en [`PLAN.md`](./PLAN.md).

## Qué es esto

`mini-erp` es un backend multitenant (Express + SQLite) con un admin web (Preact) que implementa el
**Connector API** de [offline-pos](https://github.com/rauldiazsolis/offline-pos), un POS web
offline-first. Es **un backend más** de los que usan el POS: el POS no lo conoce ni tiene código para
él. Hasta el 2026-09-29 vivía en `mini-erp/` dentro de offline-pos (epic
rauldiazsolis/offline-pos#161); la historia de esa carpeta se conservó al mudarlo.

## Relación con offline-pos y el contrato

- El contrato lo define y lo publica offline-pos. **Acá nunca se cambia**: si el mini-erp necesita
  algo del contrato, se abre un issue en offline-pos.
- **Contrato publicado**: la copia en `docs/connector-api.openapi.yaml`, con su procedencia en
  `contract.json`. Hoy: POS `0.1.0`, contrato **4.4.0**, piso **4.0.0**.
- **Contrato implementado**: **4.2.0** (4.1.0 suma `Sale.ticket`, el número del ticket en su día;
  4.2.0 suma `CustomerPayment.receipt` y define `balance` como el saldo de cualquier cliente, tenga o
  no crédito). Es compatible con el POS por el piso. Lo que falta de 4.4.0 (capacidades,
  `/demo-sessions`, `notices`, la vuelta del onboarding) es #2.
- **Actualizar la copia**: `pnpm contract:update <versión del POS>`. Siempre de una carpeta publicada
  (`https://offline-pos.pages.dev/<versión>/`), nunca de `main` de offline-pos. El diff del OpenAPI
  muestra qué cambió; implementarlo es trabajo aparte, con su issue.
- La guía para integradores está publicada junto al OpenAPI (`/<versión>/docs/`).

## Cómo trabajamos

Las mismas convenciones que offline-pos.

- **Idioma**: todo en español (respuestas, specs, planes, commits, comentarios e issues), aunque el
  pedido o las instrucciones de un skill vengan en inglés.
- **Plan antes de codear**: un trabajo de varios pasos arranca con brainstorming y un plan que el
  usuario revisa y aprueba. El plan se ejecuta **inline** (`superpowers:executing-plans`, tarea por
  tarea y con checkpoints), no con un subagente por tarea. Specs y planes en `docs/superpowers/`.
- **Informe final con prueba manual**: al terminar, un informe con instrucciones paso a paso de qué
  hacer en la UI (o con `curl`) y qué se debería ver. La prueba la hace el usuario.
- **Revisión sin cambios**: en una revisión no se toca código salvo pedido explícito en el momento; las
  observaciones se anotan como issues. Contestar una pregunta de alcance no es la luz verde para
  implementar: esa es aparte y explícita.
- **Ramas y PR**: cada etapa en su rama (`claude/<tema>`), con commits chicos verificados
  localmente. El PR se abre al terminar la etapa, después de la revisión, y se mergea con **merge
  commit**, nunca squash.
- **CI**: después de un push no se espera ni se lee el CI; alcanzan los chequeos locales. Si el CI
  falla, el usuario avisa.
- **Issues en GitHub**, nunca en un markdown del repo. "Anotá: …" crea un issue y se sigue con lo que
  se estaba haciendo. Etiquetas `feature:<slug>` (`feature:contrato`, `feature:publicacion`,
  `feature:transversal`, y las que hagan falta) y `backlog` (se prioriza después de lo ya diseñado).
  El cuerpo alcanza para arrancar una sesión nueva sin más contexto.
- **Claude mantiene los issues**: en el cuerpo del PR va "Closes #N" (GitHub no reconoce "Cierra");
  después del merge se verifica que se haya cerrado.
- **Dependencias**: con opciones equivalentes, la que tenga menos dependencias propias
  (`npm view <paquete> dependencies`).
- **Commits**: mensajes convencionales en español (`feat:`, `fix:`, `docs:`, `build:`, `ci:`,
  `test:`, `refactor:`).

## Verificación

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Y `pnpm build` si se toca el cliente o la config de Vite. Todo en verde antes de cada commit. En
Windows, pnpm se corre desde PowerShell.

## Convenciones de TypeScript y Node

- **TypeScript estricto**: `any` prohibido; `unknown` solo en fronteras externas (payloads HTTP) y
  validado con Zod en la línea siguiente.
- **Node 24 sin compilar** (strip de tipos): `pnpm dev` y `pnpm start` corren `.ts` directo.
  - Sin "parameter properties" en constructores (`constructor(private db: DatabaseSync)` no se puede
    stripear); la propiedad se declara en el cuerpo de la clase:
    ```typescript
    class MiServicio {
      private db: DatabaseSync;
      constructor(db: DatabaseSync) {
        this.db = db;
      }
    }
    ```
  - Imports relativos con extensión (`.ts`, `.tsx`): `allowImportingTsExtensions` + `noEmit`.
  - `--watch-path=src/server` en desarrollo: un `--watch` global reinicia en bucle con cada escritura
    en SQLite (`data/`) o en `dist/`.
- **UI (Preact)**: tipar con `JSX.IntrinsicElements['button']`, `JSX.TargetedEvent`, etc.; nada de
  tipos laxos.
- Endurecer esto (TypeScript nuevo, `erasableSyntaxOnly`, `exactOptionalPropertyTypes`, todos los
  eventos del push con Zod) es #1.

## Arquitectura

- **DB por tenant** con `DatabaseSync` de `node:sqlite`:
  - `data/system.sqlite`: usuarios, tenants, membresías, roles globales (`root`, `support`, `user`) y
    API keys de terminales.
  - `data/tenants/<tenantId>.sqlite`: catálogo, stock por sucursal, clientes, cuentas corrientes,
    ventas y lotes de sincronización.
- **Auth propia**: sin servicios externos; `node:crypto` (`scryptSync`, comparación timing-safe). El
  primer usuario registrado queda `root` (cerrarlo antes de publicar es parte de #3). `root` y
  `support` pueden impersonar cualquier tenant.
- **IoC con Hardwired 1.6.2** (versión exacta): servicios por request con
  `req.tenantScope.use(serviceDef)`; nunca `new Service()` para un servicio de tenant. La base del
  tenant es `unbound` (`tenantDbDef`): resolverla desde el contenedor raíz falla a propósito, para
  que no haya fugas entre tenants. Detalle en `src/server/di/container.ts` y la Fase 5 de `PLAN.md`.
- **Connector API** bajo `/connector`:
  - Push validado con Zod al aplicarse: un evento inválido queda como `issue` del lote, con su
    `eventId`, sin tumbar el resto. Hoy se valida solo `sale` (con `passthrough`); los otros tipos,
    en #1.
  - **El backend nunca rechaza de forma síncrona el contenido de un lote**: responde `200` y reporta
    las inconsistencias como `issues` en el pull.
  - `X-POS-Contract-Version`: `409 IncompatibleContract` si el major difiere (salvo en `/info`).
- **Admin** en `src/client/`: Preact + `@preact/signals` + Tailwind CSS v4 (`@tailwindcss/vite`,
  como middleware de Express).
  - Estado solo con signals (`signal`, `computed`, stores por dominio en `src/client/state/`). **Sin
    hooks de React** (`useState`, `useEffect`, etc.).
  - Temas claro, oscuro y del sistema: `src/client/state/theme-state.ts`, variante class-based
    `@custom-variant dark (&:where(.dark, .dark *))` en `index.css`, script anti-FOUC en
    `index.html` y `ThemeToggle.tsx` en `Header.tsx`, `AuthView.tsx`, `MerchantOnboardingView.tsx`
    y la solapa Apariencia de configuración (`AppearanceSection.tsx`).
  - Componentes propios estilo shadcn, sin librerías de UI externas innecesarias.

## Datos semilla y fidelidad al contrato

- Catálogos iniciales, fixtures y presets de rubro en `src/server/seeds/`, nunca dentro de servicios
  o controladores.
- Historial simulado siempre con fechas relativas a `new Date()` (`now - N días`), nunca fijas, para
  que los dashboards muestren datos vigentes.
- No asumir DTOs ni respuestas de sync: verificar siempre `docs/connector-api.openapi.yaml`.

## Estado

Fases 1 a 7 hechas (núcleo multitenant, API de gestión, admin, grillas, IoC, sync en vivo con el POS,
temas): detalle en `PLAN.md`. Sigue:

1. #1: estrictez de TypeScript y Zod.
2. #2: contrato 4.4.0 con `/demo-sessions` y demos aisladas.
3. #3: publicarlo como backend de la demo pública del POS.
