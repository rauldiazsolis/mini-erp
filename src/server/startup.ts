import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createMaintenanceApp, type MaintenanceState } from './maintenance/maintenance-app.ts';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export type StartedServer = { server: Server; port: number; ready: Promise<'ready' | 'failed'> };

/** Avance de la migración: esquemas migrados de los que hay (`system` y uno por comercio). */
export type MigrationProgress = { done: number; total: number };

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Arranque en dos fases (#47): escucha enseguida con el app de mantenimiento, migra PostgreSQL
 * (`migrateDatabase`, que avisa el avance) y recién después arma el app completo. Si algo falla, el
 * proceso sigue vivo en mantenimiento (sin un bucle de reinicios) y `/health` dice `migration-failed`.
 */
export async function startServer(params: {
  port: number;
  demos: boolean;
  /** Migra PostgreSQL (`migrateAll`: `system` y cada comercio), todavía en mantenimiento. */
  migrateDatabase: (onProgress: (progress: MigrationProgress) => void) => Promise<void>;
  /** Arma el app completo. Si falla, cierra lo que abrió antes de tirar el error. */
  createReadyHandler: () => Promise<RequestHandler>;
  logError?: ((line: string) => void) | undefined;
}): Promise<StartedServer> {
  const logError = params.logError ?? ((line: string) => { console.error(line); });

  let state: MaintenanceState = { phase: 'migrating' };
  let current: RequestHandler = createMaintenanceApp({ state: () => state, demos: params.demos });
  const server = createServer((req, res) => { current(req, res); });
  await new Promise<void>((resolve) => { server.listen(params.port, resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : params.port;

  const ready = (async (): Promise<'ready' | 'failed'> => {
    try {
      await params.migrateDatabase((progress) => {
        state = { phase: 'migrating', progress: { done: progress.done, total: progress.total } };
      });
    } catch (err: unknown) {
      state = { phase: 'failed' };
      logError(`[migraciones] FALLÓ PostgreSQL: ${reason(err)}. Lo ya migrado quedó migrado.`);
      return 'failed';
    }

    try {
      current = await params.createReadyHandler();
    } catch (err: unknown) {
      state = { phase: 'failed' };
      logError(`[migraciones] FALLÓ el arranque: ${reason(err)}`);
      return 'failed';
    }
    return 'ready';
  })();

  return { server, port, ready };
}
