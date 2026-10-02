import { parentPort, workerData } from 'node:worker_threads';
import { z } from 'zod';
import { runMigrations } from './run-migrations.ts';
import type { WorkerMessage } from './worker-runner.ts';

/** Worker de migraciones (#47): corre `runMigrations` y le avisa al hilo principal. */
const { dataDir } = z.object({ dataDir: z.string() }).parse(workerData);

function send(message: WorkerMessage): void {
  parentPort?.postMessage(message);
}

try {
  const result = runMigrations({
    dataDir,
    now: new Date(),
    onProgress: (progress) => { send({ type: 'progress', progress }); },
  });
  send({ type: 'done', result });
} catch (err: unknown) {
  send({ type: 'failed', message: err instanceof Error ? err.message : String(err) });
}
