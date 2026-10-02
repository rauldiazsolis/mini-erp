import type { DatabaseSync } from 'node:sqlite';
import { listOpenDiscrepancies } from '../discrepancy/discrepancies.ts';

/** Aviso del backend para la terminal (contrato 4.4.0, `BackendNotice`). */
export type BackendNotice = {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  ref?: { type: string; id: string };
};

/**
 * La lista vigente y completa de avisos de un equipo (#2), calculada en el momento: un aviso
 * desaparece cuando su causa se resuelve. Hoy, las discrepancias abiertas que generó; M5 suma créditos.
 */
export function noticesFor(db: DatabaseSync, deviceId: string | undefined): BackendNotice[] {
  if (deviceId === undefined || deviceId === '') {
    return [];
  }
  return listOpenDiscrepancies(db, { deviceId }).map((d): BackendNotice => ({
    id: `discrepancy:${d.id}`,
    severity: 'warning',
    message: d.message,
    ref: { type: d.refType, id: d.refId },
  }));
}
