# Instrucciones y Reglas de Desarrollo: mini-erp

Este documento define las reglas operativas, de proceso y de arquitectura que **todo agente de IA debe cumplir obligatoriamente** al trabajar en este subdirectorio.

---

## 1. Confinamiento de Espacio de Trabajo (Aislamiento Total)

- **Límite territorial estricto**: Toda la actividad de lectura, creación y modificación de código debe realizarse **exclusivamente dentro de la carpeta `mini-erp/`**.
- **Prohibido tocar el resto del repositorio**: Está terminantemente prohibido modificar archivos en `src/`, `demo-backend/`, `docs/`, `e2e/`, `public/` o en la raíz del proyecto.
- **Rama de Git**: Todo el trabajo se realiza sobre la rama `mini-erp`.

---

## 2. Gestión de Git y Política de Commits

- **El agente NUNCA ejecuta `git commit` ni `git push`**: Esta acción es exclusiva del desarrollador humano.
- **Sugerencia de commits atómicos**: Al finalizar una etapa o hito verificado y con tests en verde, el agente debe detenerse y sugerir el commit indicando:
  1. El comando exacto con el mensaje convencional **siempre en inglés** (ej. `feat(mini-erp): ...`, `fix(mini-erp): ...`, `docs(mini-erp): ...`).
  2. La lista precisa de archivos modificados/creados.

---

## 3. Metodología de Desarrollo: Ciclo de Fases y Etapas

El desarrollo se organiza en Fases divididas en Etapas atómicas (definidas en `PLAN.md`):

1. **Apertura de Fase**: Brainstorming y diseño de la fase $\rightarrow$ definición de etapas verificables $\rightarrow$ aprobación del usuario.
2. **Ejecución de Etapa (TDD Estricto)**:
   - Escribir o actualizar tests unitarios/integración con Vitest.
   - Implementar el código mínimo necesario.
   - Verificar obligatoriamente que pasen ambos comandos:
     ```bash
     pnpm typecheck
     pnpm test
     ```
   - Si aplica, proveer instrucciones o datos de prueba para verificar el comportamiento en vivo.
   - Solicitar confirmación/commit antes de pasar a la siguiente etapa.

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
  - **Imports con extensión `.ts`**: Dado que el proyecto usa `allowImportingTsExtensions: true` y `noEmit: true`, los imports relativos de TypeScript deben llevar extensión `.ts` (ej. `import { foo } from './foo.ts'`).
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
  - Todo vivirá unificado en `mini-erp/src/client/`.
  - Stack: Preact + `@preact/signals` + Tailwind CSS + TanStack Query.
  - **Prohibido el uso de React hooks** (`useState`, `useEffect`, etc.).
  - Componentes propios reutilizables estilo shadcn sin librerías de UI externas innecesarias.
