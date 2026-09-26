# Instrucciones y Reglas de Desarrollo: mini-erp

Este documento define las reglas operativas, de proceso y de arquitectura que **todo agente de IA debe cumplir obligatoriamente** al trabajar en este subdirectorio.

---

## 1. Confinamiento de Espacio de Trabajo (Aislamiento Total)

- **Límite territorial estricto**: Toda la actividad de creación y modificación de código debe realizarse **exclusivamente dentro de la carpeta `mini-erp/`**.
- **Prohibido modificar el resto del repositorio**: Está terminantemente prohibido alterar archivos en `src/`, `demo-backend/`, `docs/`, `e2e/`, `public/` o en la raíz del proyecto.
  - *Excepción de lectura para Fase 5*: Se autoriza la **lectura exclusiva** de archivos en `src/` (POS offline) para consultar tipos, modelos de datos y validar la fidelidad del contrato de sincronización. Todo script, test de integración o harness de prueba debe residir dentro de `mini-erp/`.
- **Rama de Git**: Todo el trabajo se realiza sobre la rama `mini-erp`.

---

## 2. Gestión de Git y Política de Commits

- **El agente NUNCA ejecuta `git commit` ni `git push`**: Esta acción es exclusiva del desarrollador humano.
- **Sugerencia de commits atómicos**: Al finalizar una etapa o hito verificado y con tests en verde, el agente debe detenerse y sugerir el commit indicando:
  1. El comando exacto con el mensaje convencional (`feat(...)`, `fix(...)`, `docs(...)`, etc.).
  2. La lista precisa de archivos modificados/creados.

---

## 3. Metodología de Desarrollo: Ciclo de Fases, Brainstorming y Etapas

1. **Requerimientos de Alto Nivel**:
   - El desarrollador planteará necesidades a nivel conceptual/funcional (ej. *"Quiero implementar modo claro, modo oscuro y heredado"*).
   - El agente asume todas las reglas técnicas, de estilo y de arquitectura establecidas en este documento sin necesidad de repetirlas en el prompt.

2. **Apertura de Fase / Tarea (Brainstorming & Diseño Obligatorio)**:
   - Antes de escribir o modificar código, el agente abre un diálogo de **Brainstorming y Diseño**:
     - Opciones funcionales, decisiones de UX y posibles casos de borde.
     - Impacto arquitectónico (stores/signals, componentes, rutas, tablas, IoC).
     - Definición de etapas verificables y criterios de aceptación.
     - Espera de confirmación / acuerdo con el usuario.

3. **Ejecución de Etapa (TDD Estricto)**:
   - Escribir o actualizar tests unitarios/integración con Vitest.
   - Implementar el código mínimo necesario.
   - Verificar obligatoriamente que pasen ambos comandos:
     ```bash
     pnpm typecheck
     pnpm test
     ```
   - Si se modificó la UI, validar también con `pnpm run build`.
   - Proveer instrucciones o datos de prueba para verificar en vivo si aplica.
   - Detenerse y sugerir el commit antes de avanzar a la siguiente etapa.

4. **Mantenimiento del Documento Maestro**:
   - Este archivo (`AGENTS.md`) es la **Única Fuente de Verdad**.
   - Toda decisión arquitectónica nueva o cambio de librería/convención debe registrarse de inmediato aquí para mantener actualizados a todos los agentes.

---

## 4. Convenciones Técnicas de TypeScript y Node.js

- **TypeScript Ultra-Estricto**:
  - `noImplicitAny: true` y uso de `any` **estrictamente prohibido**.
  - `unknown` permitido únicamente en fronteras externas (ej. payloads HTTP entrantes) y **debe ser validado en la línea siguiente con Zod**.
- **Compatibilidad Nativa con Node 22 (Strip-only mode)**:
  - **Prohibidos los "parameter properties" en constructores**: `constructor(private db: DatabaseSync)` produce error de sintaxis en strip-types. Siempre declarar la propiedad explícitamente en el cuerpo de la clase:
    ```typescript
    class MiServicio {
      private db: DatabaseSync;
      constructor(db: DatabaseSync) {
        this.db = db;
      }
    }
    ```
  - **Imports relativos con extensión**: Dado que el proyecto usa `allowImportingTsExtensions: true` y `noEmit: true`, los imports relativos deben llevar su extensión explícita (`.ts` para TypeScript puro y `.tsx` para componentes Preact).
  - **Aislamiento de recarga con `--watch`**: Siempre configurar `node --watch --watch-path=src/server` para el servidor de desarrollo. Dejar el `--watch` global provocará bucles infinitos de reinicio ante escrituras en SQLite (`data/`) o builds de Vite (`dist/`).
- **Tipado estricto en UI (Preact)**:
  - Usar `JSX.IntrinsicElements['button']`, `JSX.IntrinsicElements['input']` o `JSX.TargetedEvent` para tipar atributos y eventos sin recurrir a tipos laxos.
- **Gestor de paquetes**: Usar siempre `pnpm` (usando `--ignore-workspace` al instalar paquetes dentro de `mini-erp` si es necesario).

---

## 5. Principios de Arquitectura del Producto

- **Base de Datos Multitenant (DB-per-tenant)**:
  - `data/system.sqlite`: Usuarios, tenants, membresías, roles globales (`root`, `support`, `user`) y API Keys de terminales.
  - `data/tenants/<tenantId>.sqlite`: Base aislada por comercio (catálogo, stock por sucursal, clientes, cuentas corrientes, ventas, lotes de sincronización).
  - Usar siempre `DatabaseSync` nativo de `node:sqlite`.
- **Autenticación Autónoma**:
  - Cero dependencias externas (sin Firebase, sin OAuth de terceros para el núcleo).
  - Criptografía con `node:crypto` (`scryptSync` y timing-safe comparison).
  - El primer usuario registrado es automáticamente promovido a `root`.
  - Roles `root` y `support` cuentan con capacidad de impersonación sobre cualquier tenant.
- **Contrato Connector API 4.0.0**:
  - Cumplimiento riguroso de `connector-api.openapi.yaml`.
  - **Principio central: el backend nunca rechaza de forma síncrona el contenido de un lote de push**. Responde `200` y reporta inconsistencias diferidas como `issues` en el pull.
  - Validación de versión de contrato: `X-POS-Contract-Version: 4.x.x` (responder `409 IncompatibleContract` si el major difiere, excepto en `/info`).
- **Frontend Admin**:
  - Todo unificado en `mini-erp/src/client/`.
  - Stack: Preact + `@preact/signals` + Tailwind CSS v4 (vía `@tailwindcss/vite` integrado como middleware Express).
  - **Arquitectura de Estado**: Signals puros (`signal`, `computed`, stores por dominio en `src/client/state/*`). **Prohibido el uso de React hooks** (`useState`, `useEffect`, etc.).
  - Componentes propios reutilizables estilo shadcn sin librerías de UI externas innecesarias.

---

## 6. Datos Semilla, Fixtures y Fidelidad de Contratos

- **Modularización de Datos Semilla**:
  - Todo catálogo inicial, fixture de prueba o preset temático de negocio debe residir en `src/server/seeds/`, nunca hardcodeado dentro de la lógica de servicios o controladores.
- **Fechas Dinámicas y Relativas en Transacciones de Prueba**:
  - Al generar historial simulado (ventas, movimientos de caja, asientos de cuenta corriente, registros de Kardex), **está prohibido usar fechas estáticas**.
  - Siempre deben generarse mediante offsets relativos a `new Date()` (ej. `now - N días/horas`) para que los dashboards, gráficos y analíticas muestren métricas vigentes y frescas sin importar cuándo se inicie el entorno.
- **Fidelidad Estricta al Contrato OpenAPI**:
  - No asumir estructuras de DTOs ni formatos de respuesta para los endpoints de sincronización. Siempre verificar `connector-api.openapi.yaml` (ej. `approved: boolean` y `reasonCode: string` en holds, respuesta `200` con `{}` en push de lotes, objeto `cursors` en pull).
