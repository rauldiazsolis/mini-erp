import { Worker } from 'node:worker_threads';
import type { MigrationProgress, MigrationRunResult } from './run-migrations.ts';

/** Lo que el worker le manda al hilo principal. */
export type WorkerMessage =
  | { type: 'progress'; progress: MigrationProgress }
  | { type: 'done'; result: MigrationRunResult }
  | { type: 'failed'; message: string };

/** Quien corre las migraciones al arrancar: el worker en producción, una función en los tests. */
export type MigrationRunner = (
  dataDir: string,
  onProgress: (progress: MigrationProgress) => void,
) => Promise<MigrationRunResult>;

/**
 * Corre `runMigrations` en un worker (#47): `node:sqlite` es síncrono y una migración larga en el hilo
 * principal dejaría al servidor sin contestar el mantenimiento.
 */
export const runMigrationsInWorker: MigrationRunner = (dataDir, onProgress) =>
  new Promise<MigrationRunResult>((resolve, reject) => {
    const worker = new Worker(new URL('./migrate-worker.ts', import.meta.url), { workerData: { dataDir } });
    let settled = false;
    const settle = (finish: () => void): void => {
      if (!settled) {
        settled = true;
        finish();
      }
    };
    worker.on('message', (message: WorkerMessage) => {
      if (message.type === 'progress') {
        onProgress(message.progress);
      } else if (message.type === 'done') {
        settle(() => { resolve(message.result); });
      } else {
        settle(() => { reject(new Error(message.message)); });
      }
    });
    worker.on('error', (err: Error) => {
      settle(() => { reject(err); });
    });
    worker.on('exit', (code: number) => {
      settle(() => { reject(new Error(`El worker de migraciones terminó sin avisar (código ${String(code)})`)); });
    });
  });
