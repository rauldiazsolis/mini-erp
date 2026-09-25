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
