import express, { type Express, type Request, type Response } from 'express';
import { isPosMirrored, mirrorPos, type FetchLike } from './mirror.ts';

/**
 * En desarrollo, el mini-erp sirve la copia local del POS publicado en `/pos/<versión>/` (#9): el
 * POS y el mini-erp quedan en el mismo origen, sin CORS ni permiso de red local, y el recorrido de
 * la demo anda en cualquier navegador. En producción no se monta: el landing abre el POS publicado.
 */
export function mountPosMirror(app: Express, dir: string): void {
  app.use('/pos', express.static(dir));
  // Nada de fallback al SPA bajo /pos: un archivo que falta es un 404 con la pista
  app.use('/pos', (_req: Request, res: Response) => {
    res.status(404).type('text/plain').send('No está la copia local del POS: corré `pnpm pos:mirror`.');
  });
}

/** Si falta la copia de la versión fijada, la baja. Sin red avisa y sigue: nunca tumba el arranque. */
export async function ensurePosMirror(params: {
  dir: string;
  version: string;
  fetch?: FetchLike | undefined;
  log?: ((message: string) => void) | undefined;
}): Promise<void> {
  const log = params.log ?? ((message: string) => { console.log(message); });
  if (isPosMirrored(params.dir, params.version)) return;
  try {
    const files = await mirrorPos({ version: params.version, destDir: params.dir, fetch: params.fetch });
    log(`📦 POS ${params.version}: copia local bajada (${String(files.length)} archivos)`);
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    log(`⚠️  No se pudo bajar el POS ${params.version} (${reason}). Corré \`pnpm pos:mirror\` cuando haya red.`);
  }
}
