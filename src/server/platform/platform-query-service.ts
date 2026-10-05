import type { DatabaseSync } from 'node:sqlite';
import type { StaffMemberItem } from '../../shared/platform-types.ts';

/** Las consultas del panel de plataforma (#23): solo lectura, sobre la base de sistema. */
export class PlatformQueryService {
  private db: DatabaseSync;

  constructor(deps: { db: DatabaseSync }) {
    this.db = deps.db;
  }

  /** Root y el equipo de soporte, en orden de alta. */
  listStaff(): StaffMemberItem[] {
    const rows = this.db
      .prepare("SELECT id, name, email, global_role, status FROM users WHERE global_role IN ('root', 'support') ORDER BY created_at, rowid")
      .all() as { id: string; name: string; email: string; global_role: string; status: string }[];
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      globalRole: r.global_role === 'root' ? 'root' : 'support',
      status: r.status === 'disabled' ? 'disabled' : 'active',
    }));
  }
}
