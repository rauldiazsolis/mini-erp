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
│ FASE 3: Frontend Admin & Dashboard (Preact + Signals + TanStack Query) │
│   • App shell, navegación, selector de tenant, impersonación.          │
│   • Dashboard principal con métricas clave y drill-down.               │
│   • Wizard de onboarding para nuevos tenants.                          │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│ FASE 4: Grillas Tipo Excel/Sheets Interactivas                         │
│   • Grilla interactiva de Catálogo (precios, stock por sucursal).      │
│   • Grilla interactiva de Clientes y Cuentas Corrientes.               │
│   • Modal/interfaz de actualización masiva en memoria + preview.       │
│   • Validación y pruebas end-to-end completas conectando el POS.       │
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

## 7. Detalle de Etapas: FASE 5 (Pruebas End-to-End y Sincronización en Vivo) [PRÓXIMA]

### Objetivos:
- Conexión real del frontend POS (`src/`) apuntando al Mini-ERP (`http://localhost:4100/connector`).
- Validación de ciclo de vida completo:
  1. Pull inicial de catálogo y clientes hacia el POS.
  2. Ventas offline, ventas a cuenta corriente con `account-holds`.
  3. Push de lotes desde el POS al Mini-ERP.
  4. Impacto automático en stock de la sucursal, Kardex, cuenta corriente y dashboard del ERP.

