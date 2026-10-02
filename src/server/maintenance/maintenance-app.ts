import express, { type Express, type Response } from 'express';
import cors from 'cors';
import { allowPrivateNetwork } from '../middleware/private-network.ts';
import { backendInfo, MAINTENANCE_MESSAGE } from '../connector/backend-info.ts';
import { APP_VERSION } from '../app-version.ts';
import { MAINTENANCE_PAGE } from './maintenance-page.ts';

export const RETRY_AFTER_SECONDS = 30;

export type MaintenanceState = { phase: 'migrating' | 'failed'; progress?: { done: number; total: number } };

function unavailable(res: Response): Response {
  res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
  return res.status(503);
}

/**
 * Lo que atiende el servidor mientras migra (#47), sin abrir ninguna base. El POS ve `maintenance`
 * en `/info` y deja de sincronizar; el admin y el alta ven la página de actualización.
 */
export function createMaintenanceApp(params: { state: () => MaintenanceState; demos: boolean }): Express {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(allowPrivateNetwork);
  app.use(cors());

  app.get('/health', (_req, res) => {
    const state = params.state();
    res.status(503).json({
      status: state.phase === 'failed' ? 'migration-failed' : 'maintenance',
      service: 'mini-erp',
      version: APP_VERSION,
      ...(state.progress === undefined ? {} : { progress: state.progress }),
    });
  });

  // Sin validar la key: no hay base de sistema y la respuesta no dice nada de nadie. Nunca 409.
  app.get('/connector/info', (_req, res) => {
    res.status(200).json(backendInfo({ status: 'maintenance', demos: params.demos }));
  });
  app.use('/connector', (_req, res) => {
    unavailable(res).json({ code: 'maintenance', message: MAINTENANCE_MESSAGE });
  });
  app.use('/api', (_req, res) => {
    unavailable(res).json({ error: MAINTENANCE_MESSAGE, code: 'maintenance' });
  });
  app.use((_req, res) => {
    unavailable(res).type('html').send(MAINTENANCE_PAGE);
  });
  return app;
}
