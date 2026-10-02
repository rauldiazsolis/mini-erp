import type { DatabaseSync } from 'node:sqlite';
import { dismissDiscrepancy, listOpenDiscrepancies, type Discrepancy } from './discrepancies.ts';

/** Discrepancias del comercio para el admin (#2). Servicio de tenant: se resuelve por scope. */
export class DiscrepancyService {
  private db: DatabaseSync;
  constructor(db: DatabaseSync) {
    this.db = db;
  }

  listOpen(): Discrepancy[] {
    return listOpenDiscrepancies(this.db);
  }

  dismiss(id: string, userId: string, note: string): void {
    dismissDiscrepancy(this.db, id, userId, note, new Date().toISOString());
  }
}
