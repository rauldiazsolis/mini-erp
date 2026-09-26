# Plan Maestro de Desarrollo: mini-erp

Backend Multitenant + Mini-ERP para `offline-pos` con editores tipo hoja de cálculo (Excel/Sheets), gestión de catálogo, clientes, stock y cuentas corrientes.

---

## 1. Principios y Restricciones de Arquitectura

- **Aislamiento de código**: Todo el desarrollo de este proyecto vive exclusivamente dentro del directorio `mini-erp/`. No se modificará ningún archivo del resto del repositorio.
- **Branch**: Todo el trabajo se realiza sobre la rama `mini-erp`.
- **TypeScript Ultra-Estricto**:
  - `noImplicitAny: true` y `any` completamente prohibido.
  - `unknown` solo permitido en las fronteras de entrada e inmediatamente validado con schemas de **Zod**.
  - Funciones de dominio tipadas explícitamente.
- **Autenticación Autónoma**:
  - Sin credenciales de servicios externos (ni Firebase, ni proveedores OAuth de terceros para arrancar).
  - El primer usuario registrado se convierte automáticamente en `root`.
  - Soporte de roles: `root`, `support`, `owner` de tenant, `member` de tenant.
  - Capacidad de impersonación para `root` y `support`.
- **Base de Datos**:
  - **DB-per-tenant** con SQLite.
  - `data/system.sqlite`: Usuarios, tenants, membresías, roles globales, API keys de terminales.
  - `data/tenants/<tenantId>.sqlite`: Catálogo de productos, stock por sucursales, clientes, movimientos de cuenta corriente, ventas, lotes de sincronización e idempotencia.
  - Soporte de estado `maintenance` en `GET /info` durante migraciones.
- **Contrato POS**:
  - Cumplimiento 100% de la especificación **Connector API 4.0.0** (`connector-api.openapi.yaml`).
  - Terminales autenticadas con `Authorization: Bearer <tenant_api_key>` que resuelven el `tenantId`, `branch` y `pointOfSale`.
  - El backend nunca rechaza de forma síncrona el contenido de un lote de push (ack de recepción con lote encolado y procesamiento posterior).

---

## 2. Mapa de Fases

```
┌────────────────────────────────────────────────────────────────────────┐
│ FASE 1: Core del Backend, Multitenancy & Connector API v4.0.0          │
│   • Base del servidor Express + TypeScript estricto.                   │
│   • Motor DB-per-tenant SQLite + System DB.                            │
│   • Auth autónoma (registro, login, roles, impersonación, API Keys).   │
│   • Connector API v4.0.0 completo (Info, Push, Pull, Account Holds).   │
│   • Verificación TDD y conexión exitosa con el POS.                    │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ FASE 2: API de Gestión del ERP (Admin Business Core)                   │
│   • Endpoints para catálogo y precios.                                 │
│   • Stock multi-sucursal y ajustes con auditoría (Kardex).             │
│   • Clientes, cuentas corrientes y ajustes de saldo transparentes.     │
│   • Operaciones masivas: actualización de precios y cálculo intereses. │
│   • Importación / Exportación CSV y JSON con datos semilla.            │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ FASE 3: Frontend Admin & Dashboard [COMPLETADA]                        │
│   • App shell, navegación, selector de tenant, impersonación.          │
│   • Dashboard principal con métricas clave y drill-down.               │
│   • Wizard de onboarding para nuevos tenants.                          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ FASE 4: Grillas Tipo Excel/Sheets y Gestión Integral [COMPLETADA]      │
│   • Grilla interactiva de Catálogo y Precios inline.                   │
│   • Grilla matricial de Stock por Sucursal y Kardex auditado.          │
│   • Gestión de Clientes, Cuentas Corrientes y Cobranzas.               │
│   • Operaciones Masivas (precios, intereses, import/export).           │
│   • Configuración, sucursales y API Keys para terminales POS.          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ FASE 5: Refactoring de Backend con IoC (Hardwired) [PRÓXIMA]           │
│   • Instalación y fijación estricta de hardwired@1.6.2.                │
│   • Definiciones del contenedor con storage SQLite unbound por tenant. │
│   • Inyección de servicios scopeados por request en Express.           │
│   • Blindaje hermético multitenant y 144 tests en verde.               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ FASE 6: Pruebas End-to-End y Sincronización en Vivo [COMPLETADA]       │
│   • Conexión real del POS (src/) con Mini-ERP (localhost:4100).        │
│   • Ciclo de vida completo: pull, ventas offline, holds y push.        │
│   • Auditoría bidireccional de stock, cuentas corrientes y dashboard.  │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detalle de Etapas: FASE 1

### Etapa 1.1: Scaffolding y Entorno
- Configuración de `package.json` propio en `mini-erp/` con scripts (`dev`, `build`, `test`, `typecheck`).
- `tsconfig.json` ultra-estricto.
- Instalación y setup de Express, Zod, Vitest y dependencias mínimas de producción.
- Servidor base con healthcheck y manejo tipado de errores.

### Etapa 1.2: Motor de Base de Datos DB-per-tenant
- Creación y manejo de conexiones dinámicas SQLite (`system.sqlite` y `tenants/<tenantId>.sqlite`).
- Schemas relacionales con versionado/migración simple.
- Schema del tenant alineado con Connector API 4.0.0:
  - `products`, `branches`, `stock`, `customers`, `account_movements`, `account_holds`, `sales`, `stock_movements`, `cash_movements`, `customer_payments`, `push_lots`, `idempotency_keys`.
- Flag de mantenimiento por tenant.

### Etapa 1.3: Autenticación, Multitenancy y API Keys
- Endpoints de auth: `/api/auth/register`, `/api/auth/login`, `/api/auth/me`.
  - Regla: El primer usuario creado adquiere rol global `root`.
- Endpoints de tenants:
  - Creación de tenant (con seed de datos iniciales para onboarding).
  - Listado y selección de tenant activo.
  - Invitación de miembros con roles (`owner`, `member`).
  - Impersonación de tenants por `root` y usuarios con rol `support`.
- Gestión de API Keys de terminales:
  - Generación de tokens `mpos_...` asociados a `(tenantId, branch, pointOfSale)`.
  - Middleware de autenticación dual: Admin (JWT/Session) vs POS (Bearer API Key).

### Etapa 1.4: Implementación de Connector API v4.0.0
- Rutas públicas bajo `/connector`:
  - `GET /connector/info`: versión de contrato (`4.0.0`), estado (`ok`/`maintenance`).
  - `POST /connector/sync/push`: recepción con `Idempotency-Key`, registro del lote `queued`, ack inmediato `200`, y procesamiento atómico (ventas, stock, clientes, cobranzas, movimientos de caja, confirmación/liberación de holds).
  - `POST /connector/sync/pull`: consulta delta con cursor `since` o snapshot completo si el cursor está ausente. Devolución de catálogo, clientes, stock completo y estado de lotes consultados.
  - `POST /connector/account-holds`: reserva síncrona de saldo (`creditLimit + margin - balance - pendingHeld >= amount`).
- Verificación de encabezados:
  - `X-POS-Contract-Version: 4.0.0` (responde `409 IncompatibleContract` ante majors distintos).
  - `Idempotency-Key` en operaciones de escritura.

### Etapa 1.5: Testing Integral y Verificación en Vivo
- Tests unitarios y de integración con Vitest para todo el flujo de sincronización y auth.
- Configuración en vivo del POS web apuntando a `http://localhost:<PORT>/connector` con la API Key generada.
- Verificación de ciclo completo: pull de catálogo $\rightarrow$ venta offline $\rightarrow$ push de lote $\rightarrow$ pull de confirmación $\rightarrow$ verificación de stock y saldos en SQLite del tenant.

---

## 4. Detalle de Etapas: FASE 2 (Admin Business Core)

### Etapa 2.1: Catálogo, Precios y Sucursales
- CRUD completo de sucursales (`/branches`) con validación de código único.
- Inicialización automática de stock en 0 para todas las sucursales existentes al crear productos con control de stock.
- CRUD de catálogo de productos (`/products`) con validación Zod estricta (`sku`, `barcodes`, `name`, `price`, `taxRate`, `category`, `tracksStock`, `blockedReason`).
- Búsqueda en texto libre y filtrado por categoría y estado de bloqueo.
- Bloqueo y soft-delete de productos con motivo auditado.
- Listado de categorías únicas (`/categories`).
- Garantía de sincronización con el POS vía actualización estricta de `updated_at`.

### Etapa 2.2: Stock Multi-Sucursal y Kardex Auditado
- Vista matricial consolidada de stock (`GET /stock`) con desglose por cada sucursal (`branches: { [branchId]: quantity }`) y total consolidado.
- Ajustes de stock auditados (`POST /stock/adjust`) tanto absolutos (`type: 'set'`) como relativos (`type: 'delta'`), exigiendo motivo (`reason`) y notas opcionales (`notes`).
- Registro histórico de auditoría Kardex (`GET /stock/kardex`) con filtros por producto, sucursal, motivo y rango temporal.
- Integración bidireccional: ajustes de stock en ERP impactan en el pull del POS, y ventas offline con movimientos de stock en el POS se asientan automáticamente en el Kardex del ERP.

### Etapa 2.3: Clientes, Cuentas Corrientes y Ajustes Transparentes
- CRUD completo de clientes (`/customers`) con cálculo dinámico de `availableCredit` y flag `isDebtor`.
- Soporte de saldo inicial (`initialBalance`) al registrar el cliente con asiento automático en el libro de cuenta corriente.
- Cobranzas manuales (`POST /customers/:id/payments`) asentadas en `account_movements` (con importe contable negativo) y `customer_payments`.
- Ajustes transparentes de saldo (`POST /customers/:id/adjustments`) con modalidades `credit`, `debit` y `set`, requiriendo motivo auditado.
- Extracto cronológico de cuenta corriente (`GET /customers/:id/movements`) con saldo resultante (`balance_after`) en cada fila.
- Integración en tiempo real con las reservas de saldo `/connector/account-holds` del POS.

### Etapa 2.4: Operaciones Masivas (Precios e Intereses)
- Actualizaciones masivas de precios (`POST /bulk/prices`) con acciones `percentage`, `fixed` e `items`, filtros por categoría y redondeos comerciales (`10`, `50`, `100`, `none`).
- Cálculo y devengamiento masivo de intereses (`POST /bulk/interests`) sobre saldos deudores con soporte de umbral mínimo (`minimumBalance`).
- Soporte de simulación segura `dryRun: true` para previsualizar el impacto económico y las filas afectadas antes de confirmar la persistencia.

### Etapa 2.5: Importación / Exportación CSV y JSON + Semillas
- Exportación en formatos CSV (RFC 4180) y JSON (`GET /export/:entity`) para `products`, `customers` y `stock`.
- Importación masiva (`POST /import/:entity`) desde archivos/texto CSV o arrays JSON, con soporte de actualización por SKU/documento (`updateExisting`), reporte detallado de errores por fila y modo simulación `dryRun`.
- Semillas de negocio preconfiguradas (`POST /seed-preset`) para los rubros `'kiosco'`, `'ferreteria'` y `'almacen'`.

---

## 5. Detalle de Etapas: FASE 3 (Frontend Admin & Dashboard) [COMPLETADA]

### Etapa 3.1: Scaffolding Frontend & Reactividad Base
- Preact + Preact Signals puro (`@preact/signals`) integrado en Vite con Tailwind CSS v4.
- Shell de la app: Navbar con selector de tenant, badge de impersonación (root/support), sidebar colapsable y breadcrumbs.
- Gestión de sesión y autenticación en frontend con persistencia reactiva.

### Etapa 3.2: Analytics & Dashboard Summary API
- Endpoint `/dashboard/summary` con filtros de período (`today`, `week`, `month`) y por sucursal.
- KPI Cards, ranking de productos más vendidos, métodos de cobro y distribución por categorías.

### Etapa 3.3: Dashboard UI & Visualizaciones
- Componentes KPI interactivos, gráficos de barras de ventas y medios de pago, tablas de top productos y alertas de stock bajo.

### Etapa 3.4: Onboarding Wizard & Tenant Switcher
- Modal/Wizard interactivo paso a paso para nuevos comercios (nombre, rubro, sucursal inicial, carga opcional de semilla).
- Selector dinámico de sucursales y cambio de tenant en caliente.

---

## 6. Detalle de Etapas: FASE 4 (Grillas Interactivas de Gestión) [COMPLETADA]

### Etapa 4.1: Catálogo & Precios (Grilla Sheets)
- Búsqueda en vivo, filtro por categoría, badges de estado (activo/bloqueado), edición inline ágil de precios/costos.
- Modal de alta/edición de producto y modal de bloqueo con motivo auditado.

### Etapa 4.2: Stock Multi-Sucursal y Kardex
- Grilla matricial de productos $\times$ sucursales con ajustes directos en celda (`set` absoluto y `delta` relativo).
- Drawer lateral de auditoría Kardex con historial de movimientos y filtros.

### Etapa 4.3: Clientes, Cuentas Corrientes y Cobranzas
- Stats bar de deudores y morosidad, CRUD de clientes con límite de crédito y margen.
- Registro de cobranzas/pagos manuales, ajustes contables de saldo con motivo y drawer de extracto de cuenta corriente.

### Etapa 4.4: Operaciones Masivas (Precios, Intereses, Import/Export)
- Aumento porcentual o fijo con redondeo comercial (`10`, `50`, `100`) y modo `dryRun` con preview.
- Devengamiento masivo de intereses a deudores morosos.
- Importación/exportación de CSV y JSON con reporte de errores por fila.

### Etapa 4.5: Configuración, Sucursales y Terminales POS / API Keys
- Generación de API Keys vinculadas a `(tenantId, branch, pointOfSale)` con visualización única de token copiable.
- CRUD de sucursales operativas.
- Guía interactiva de conexión para terminales POS con prueba de ping en vivo a `/connector/info`.

---

## 7. Detalle de Etapas: FASE 5 (Refactoring Backend IoC con Hardwired) [COMPLETADA]

### Objetivos:
- Blindar el aislamiento multitenant y erradicar cualquier posibilidad de fuga de datos (*tenant isolation leakage*) entre tenants mediante Inversión de Control funcional y tipado estricto con Hardwired 1.6.2.
- Sustituir la instanciación manual ad-hoc en rutas por un ciclo de vida gestionado por request scope sin añadir decoradores ni `reflect-metadata`.

### Etapa 5.1: Dependencia y Fijación de Versión [COMPLETADA]
- Instalación de `hardwired` fijando versión exacta `1.6.2` en `mini-erp/package.json` (sin `^` ni `~`).
- Validación de compatibilidad nativa con Node 22 (`--experimental-strip-types`), ESM y Vitest.

### Etapa 5.2: Definiciones del Contenedor de Dependencias [COMPLETADA]
- Creación del módulo central de inyección (`src/server/di/container.ts`):
  - Definición no enlazada para la base de datos del tenant: `export const tenantDbDef = unbound<DatabaseSync>('tenantDb')`.
  - Definición de dependencias singleton de aplicación (`systemDbDef` / `masterDbDef`, `tenantManagerDef`, `authServiceDef`, `apiKeyServiceDef`).
  - Definición de servicios de negocio como `fn.scoped()` dependientes de `tenantDbDef`:
    - `catalogServiceDef` -> `CatalogService`
    - `stockServiceDef` -> `StockService`
    - `customerServiceDef` -> `CustomerService`
    - `bulkServiceDef` -> `BulkService`
    - `importExportServiceDef` -> `ImportExportService`
    - `dashboardSummaryServiceDef` / `dashboardServiceDef` -> `DashboardService`
    - `connectorServiceDef` -> `ConnectorService`
  - Preservación de las clases de servicio puras (constructores estándar, cero decoradores).

### Etapa 5.3: Integración de Scopes en Middleware y Rutas [COMPLETADA]
- Actualización de `src/server/middleware/tenant-context-middleware.ts`:
  - Al resolver el tenant en `/api/tenants/:tenantId/*`, apertura de scope por request:
    `req.tenantScope = createTenantScope(rootContainer, tenantDb)`.
- Soporte de `rootContainer` y `req.tenantScope` en `createPosAuthMiddleware` para terminales POS.
- Actualización de routers de Express (`catalog-routes.ts`, `stock-routes.ts`, `customer-routes.ts`, `bulk-routes.ts`, `io-routes.ts`, `dashboard-routes.ts`, `connector-routes.ts`):
  - Reemplazo de instanciaciones manuales `new Service(...)` por resolución declarativa `req.tenantScope.use(serviceDef)`.

### Etapa 5.4: Verificación Integral de Tests y Tipado [COMPLETADA]
- Suite dedicada en `test/ioc-container.test.ts` con 7 tests unitarios y de integración HTTP (supertest).
- Ejecución completa de la suite: **151 tests pasando en verde** en 22 suites.
- Validación de tipado: `tsc --noEmit` con 0 errores.
- Build de producción: `pnpm run build` exitoso.
- Garantía verificada: intentar resolver servicios dependientes de `tenantDbDef` en el contenedor raíz arroja error en runtime previniendo cualquier fuga entre tenants.

---

## 8. Detalle de Etapas: FASE 6 (Pruebas End-to-End y Sincronización en Vivo) [COMPLETADA]

### Objetivos:
- Conexión real del frontend POS (`src/`) apuntando al Mini-ERP (`http://localhost:4100/connector`).
- Validación de ciclo de vida completo:
  1. Pull inicial de catálogo, stock y clientes hacia el POS.
  2. Ventas offline, ventas a cuenta corriente con `account-holds`.
  3. Push de lotes de sincronización desde el POS al Mini-ERP.
  4. Impacto automático en stock de la sucursal, Kardex, cuenta corriente y dashboard del ERP.

### Etapa 6.1: Enriquecimiento del Conector & Acondicionamiento Multi-Sucursal [COMPLETADA]
- Soporte de filtro por `branchId` en `pullCatalog` de `ConnectorService` con resolución automática a ID de sucursal.
- Fallback automático de `originBranch` al `defaultBranchId` de la terminal POS en `applyEvent` si el evento no trae sucursal explícita.
- Mapeo consistente de contexto de terminal (`req.posContext.branch`) en `createConnectorRoutes`.

### Etapa 6.2: Suite Automatizada de Integración End-to-End (`test/e2e-pos-sync-lifecycle.test.ts`) [COMPLETADA]
- Verificación de ciclo completo de sincronización bidireccional bajo contrato v4.0.0:
  1. Handshake `GET /connector/info` y rechazo `409 IncompatibleContract` ante major no soportado.
  2. Pull inicial de snapshot completo (`POST /connector/sync/pull`).
  3. Reservas síncronas de crédito (`POST /connector/account-holds`): casos aprobado, denegado por insuficiencia de crédito, y denegado por falta de cuenta corriente.
  4. Push de lote multievento (`POST /connector/sync/push`): ventas en efectivo, ventas a cuenta corriente con hold confirmado, ventas fiado offline sin hold, cobranza de clientes, movimientos de caja y ventas de anulación/devolución con reposición de stock.
  5. Pull de confirmación con estado de lote `ok` e idempotencia verificada ante reenvíos idénticos.
  6. Auditoría integral de negocio en APIs del ERP: stock matricial descontado/repuesto por sucursal, trazabilidad append-only en Kardex, extracto de cuenta corriente de clientes con `balanceAfter` consistente, y dashboard summary con KPIs en tiempo real.

### Etapa 6.3: Verificación de Calidad y Entorno [COMPLETADA]
- **152 tests pasando en verde** en 23 suites de prueba.
- Verificación estricta de TypeScript: `tsc --noEmit` en 0 errores.
- Build de producción Vite completado con éxito.

---

## 9. Detalle de Etapas: FASE 7 (Sistema de Temas UI: Modo Claro, Oscuro y Heredado) [COMPLETADA]

### Objetivos:
- Soporte para tres modos de visualización:
  1. `light` (Modo Claro para ambientes iluminados con fondo nítido y alto contraste).
  2. `dark` (Modo Oscuro para menor fatiga visual con fondos slate oscuros y acentos índigo).
  3. `system` (Modo Heredado que se sincroniza reactivamente con las preferencias del sistema operativo mediante `matchMedia`).
- Persistencia en `localStorage` bajo `mini_erp_theme_mode`.
- Eliminación de FOUC (Flash of Unstyled Content) en carga inicial.
- Componentes accesibles con conmutación en un clic y previsualización.

### Etapa 7.1: Estado Reactivo con Signals y TDD (`theme-state.ts`) [COMPLETADA]
- Implementación de `src/client/state/theme-state.ts`:
  - Tipos `ThemeMode` ('light' | 'dark' | 'system') y `ResolvedTheme` ('light' | 'dark').
  - Signals puros de Preact: `themeModeSignal`, `systemPrefersDarkSignal`, `resolvedThemeSignal`.
  - Funciones de persistencia y aplicación al DOM: `setThemeMode`, `initThemeState`, `applyThemeToDocument`.
  - Listener reactivo ante eventos `change` de `prefers-color-scheme`.
- Suite de pruebas unitarias en `test/theme-client.test.ts` (5 tests verdes).

### Etapa 7.2: Configuración de Tailwind CSS v4 & Anti-FOUC [COMPLETADA]
- Configuración en `src/client/index.css` de `@custom-variant dark (&:where(.dark, .dark *))` para estrategia class-based.
- Inyección de script inline anti-FOUC en `<head>` de `src/client/index.html` para sincronizar `document.documentElement` (`class="dark"` vs `class="light"` y `style.colorScheme`).

### Etapa 7.3: Componentes UI y Puntos de Acceso [COMPLETADA]
- Creación de `ThemeToggle.tsx` en `src/client/components/ui/`:
  - Modo compacto: segmented control de 3 botones con iconos SVG (Sol, Monitor, Luna).
  - Modo expandido: tarjetas de selección con descripción y badge de estado activo.
- Integración en:
  - `Header.tsx`: acceso global inmediato junto a la información de usuario y logout.
  - `AuthView.tsx`: acceso en la pantalla de login/registro.
  - `SettingsView.tsx`: nueva solapa `appearance` ("Apariencia & Tema") con `AppearanceSection.tsx` y visualizador de estados en tiempo real.

### Etapa 7.4: Adaptación de Superficies Base y Verificación [COMPLETADA]
- Adaptación de clases para contraste dual en `AppShell`, `Sidebar`, `Header`, `Card`, `Input`, `Button`, tablas y modales.
- **157 tests pasando en verde** en 24 suites de prueba.
- Verificación estricta de TypeScript: `tsc --noEmit` en 0 errores.
- Build de producción Vite completado con éxito (`dist/client/assets/`).


