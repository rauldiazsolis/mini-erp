import type { Kysely } from 'kysely';
import type { TenantDatabase } from '../db/pg/tenant-schema.ts';
import { dismissDiscrepancy, listOpenDiscrepancies, type Discrepancy } from './discrepancies.ts';

/** Discrepancias del comercio para el admin (#2). Servicio de tenant: se resuelve por scope. */
export class DiscrepancyService {
  private db: Kysely<TenantDatabase>;
  constructor(db: Kysely<TenantDatabase>) {
    this.db = db;
  }

  async listOpen(): Promise<Discrepancy[]> {
    return await listOpenDiscrepancies(this.db);
  }

  async dismiss(id: string, userId: string, note: string): Promise<void> {
    await dismissDiscrepancy(this.db, id, userId, note, new Date().toISOString());
  }
}
