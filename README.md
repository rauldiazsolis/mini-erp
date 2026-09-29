# mini-erp

Backend multitenant (Express + SQLite) con un admin web (Preact) que implementa el **Connector API**
de [offline-pos](https://github.com/rauldiazsolis/offline-pos): catálogo, stock por sucursal,
clientes, cuentas corrientes y sincronización con las terminales del POS.

## Levantarlo

Requiere Node 24 y pnpm 10.

```bash
pnpm install
pnpm dev
```

El servidor queda en `http://localhost:4100` (o en el puerto de `PORT`): el admin en `/`, su API en
`/api` y el Connector API en `/connector`. Los datos van a `data/` (SQLite, un archivo por comercio).

Al arrancar crea datos de desarrollo, si no existen: un admin (`root`), el comercio "Tienda Demo
Central" con datos de ejemplo y una API key de terminal. Las credenciales se imprimen en la consola.
Con esa key, un POS se conecta a `http://localhost:4100/connector`.

## Contrato

- Implementa el Connector API **4.2.0**; el POS acepta backends desde **4.0.0**.
- La copia del contrato publicado está en
  [`docs/connector-api.openapi.yaml`](./docs/connector-api.openapi.yaml), con su procedencia en
  [`contract.json`](./contract.json). Se actualiza con `pnpm contract:update <versión del POS>`.
- Lo que falta de 4.4.0 está en [#2](https://github.com/rauldiazsolis/mini-erp/issues/2).

## Desarrollo

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Las reglas del repo están en [`AGENTS.md`](./AGENTS.md); la historia de las fases, en
[`PLAN.md`](./PLAN.md).
