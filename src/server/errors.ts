import type { Response } from 'express';

export type DomainStatus = 400 | 401 | 403 | 404 | 409 | 410;

/** Error de negocio con su estado HTTP (#19): los servicios lo tiran y las rutas lo traducen. */
export class DomainError extends Error {
  status: DomainStatus;
  constructor(status: DomainStatus, message: string) {
    super(message);
    this.name = 'DomainError';
    this.status = status;
  }
}

export function sendError(res: Response, err: unknown, fallbackStatus: number): void {
  if (err instanceof DomainError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  res.status(fallbackStatus).json({ error: err instanceof Error ? err.message : 'Error inesperado' });
}
