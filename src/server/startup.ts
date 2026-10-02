import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { restoreRun, type MigrationRunResult } from './db/migrations/run-migrations.ts';
import type { MigrationRunner } from './db/migrations/worker-runner.ts';
import { createMaintenanceApp, type MaintenanceState } from './maintenance/maintenance-app.ts';

export type RequestHandler = (req: IncomingMessage, res: ServerResponse) => void;

export type StartedServer = { server: Server; port: number; ready: Promise<'ready' | 'failed'> };

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * Arranque en dos fases (#47): escucha enseguida con el app de mantenimiento, migra con `runner` y
 * recién después arma el app completo. Si algo falla, el proceso sigue vivo en mantenimiento (sin un
 * bucle de reinicios) y `/health` dice `migration-failed`.
 */
export async function startServer(params: {
  port: number;
  dataDir: string;
  demos: boolean;
  runner: MigrationRunner;
  /** Arma el app completo. Si falla, cierra lo que abrió antes de tirar el error. */
  createReadyHandler: () => Promise<RequestHandler>;
  log?: ((line: string) => void) | undefined;
  logError?: ((line: string) => void) | undefined;
}): Promise<StartedServer> {
  const log = params.log ?? ((line: string) => { console.log(line); });
  const logError = params.logError ?? ((line: string) => { console.error(line); });

  let state: MaintenanceState = { phase: 'migrating' };
  let current: RequestHandler = createMaintenanceApp({ state: () => state, demos: params.demos });
  const server = createServer((req, res) => { current(req, res); });
  await new Promise<void>((resolve) => { server.listen(params.port, resolve); });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : params.port;

  const ready = (async (): Promise<'ready' | 'failed'> => {
    let result: MigrationRunResult;
    try {
      result = await params.runner(params.dataDir, (progress) => {
        state = { phase: 'migrating', progress: { done: progress.done, total: progress.total } };
        log(`[migraciones] ${progress.file} (${String(progress.done)}/${String(progress.total)})`);
      });
    } catch (err: unknown) {
      state = { phase: 'failed' };
      logError(`[migraciones] FALLÓ ${reason(err)}. Las bases quedaron como estaban.`);
      return 'failed';
    }

    try {
      current = await params.createReadyHandler();
    } catch (err: unknown) {
      state = { phase: 'failed' };
      if (result.runDir === undefined) {
        logError(`[migraciones] FALLÓ el arranque: ${reason(err)}`);
      } else {
        restoreRun(result.runDir, params.dataDir, result.migrated.map((m) => m.file));
        logError(`[migraciones] FALLÓ el arranque después de migrar: ${reason(err)}. Restauré las bases desde ${result.runDir}.`);
      }
      return 'failed';
    }

    if (result.migrated.length > 0) {
      log(`[migraciones] listo: ${String(result.migrated.length)} bases migradas (copia en ${result.runDir ?? ''})`);
    }
    return 'ready';
  })();

  return { server, port, ready };
}
