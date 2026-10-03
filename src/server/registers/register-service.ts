import type { DatabaseSync } from 'node:sqlite';
import { DomainError } from '../errors.ts';
import { ApiKeyService } from '../tenant/api-key-service.ts';
import type { RegisterItem, RegisterNoticeState } from '../../shared/register-types.ts';

const SHARED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type RegisterRow = {
  id: string;
  name: string;
  branch: string;
  point_of_sale: string;
  active: number;
  device_id: string | null;
  bound_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

/**
 * Cajas del POS (#21): sucursal + punto de venta con un solo equipo ligado. La key es de la caja:
 * rotarla no cambia la caja ni su equipo. Otro equipo con la misma key queda como ajeno.
 */
export class RegisterService {
  private db: DatabaseSync;
  private now: () => Date;
  private keys: ApiKeyService;

  constructor(db: DatabaseSync, now: () => Date) {
    this.db = db;
    this.now = now;
    this.keys = new ApiKeyService(db);
  }

  create(p: { tenantId: string; name: string; branch: string; pointOfSale: string }): { id: string; rawKey: string; keyPrefix: string } {
    const created = this.keys.createApiKey(p);
    return { id: created.registerId, rawKey: created.rawKey, keyPrefix: created.keyPrefix };
  }

  /** Registra que un equipo usó la key: liga la caja si no tiene equipo. Un `deviceId` vacío no liga. */
  seen(registerId: string, deviceId: string): 'bound' | 'foreign' {
    if (deviceId === '') return 'bound';
    const at = this.now().toISOString();
    const row = this.db.prepare('SELECT device_id FROM registers WHERE id = ?').get(registerId) as
      | { device_id: string | null }
      | undefined;
    if (row === undefined) return 'bound';
    if (row.device_id === null || row.device_id === deviceId) {
      this.db
        .prepare('UPDATE registers SET device_id = ?, bound_at = COALESCE(bound_at, ?), last_seen_at = ? WHERE id = ?')
        .run(deviceId, at, at, registerId);
      return 'bound';
    }
    this.db
      .prepare(
        `INSERT INTO register_devices (register_id, device_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(register_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
      )
      .run(registerId, deviceId, at, at);
    return 'foreign';
  }

  rotateKey(tenantId: string, registerId: string): { rawKey: string; keyPrefix: string } {
    const reg = this.get(tenantId, registerId);
    this.db.prepare('UPDATE tenant_api_keys SET active = 0 WHERE register_id = ?').run(registerId);
    const key = this.keys.insertKey({ tenantId, registerId, name: reg.name, branch: reg.branch, pointOfSale: reg.point_of_sale });
    return { rawKey: key.rawKey, keyPrefix: key.keyPrefix };
  }

  /** Pasa la caja a un equipo que ya la usó; el anterior queda como uno más de los otros. */
  transferTo(tenantId: string, registerId: string, deviceId: string): void {
    const reg = this.get(tenantId, registerId);
    const other = this.db.prepare('SELECT 1 FROM register_devices WHERE register_id = ? AND device_id = ?').get(registerId, deviceId);
    if (other === undefined) throw new DomainError(400, 'Ese equipo no usó esta caja');
    const at = this.now().toISOString();
    this.db.exec('BEGIN');
    try {
      this.db.prepare('DELETE FROM register_devices WHERE register_id = ? AND device_id = ?').run(registerId, deviceId);
      if (reg.device_id !== null) {
        const last = reg.last_seen_at ?? reg.bound_at ?? at;
        this.db
          .prepare(
            `INSERT INTO register_devices (register_id, device_id, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?)
             ON CONFLICT(register_id, device_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          )
          .run(registerId, reg.device_id, reg.bound_at ?? last, last);
      }
      this.db.prepare('UPDATE registers SET device_id = ?, bound_at = ?, last_seen_at = NULL WHERE id = ?').run(deviceId, at, registerId);
      this.db.exec('COMMIT');
    } catch (err: unknown) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  unbind(tenantId: string, registerId: string): void {
    this.get(tenantId, registerId);
    this.db.prepare('UPDATE registers SET device_id = NULL, bound_at = NULL, last_seen_at = NULL WHERE id = ?').run(registerId);
    this.db.prepare('DELETE FROM register_devices WHERE register_id = ?').run(registerId);
  }

  deactivate(tenantId: string, registerId: string): void {
    this.get(tenantId, registerId);
    this.db.prepare('UPDATE registers SET active = 0 WHERE id = ?').run(registerId);
    this.db.prepare('UPDATE tenant_api_keys SET active = 0 WHERE register_id = ?').run(registerId);
  }

  list(tenantId: string): RegisterItem[] {
    const rows = this.db
      .prepare('SELECT * FROM registers WHERE tenant_id = ? ORDER BY active DESC, created_at, id')
      .all(tenantId) as RegisterRow[];
    const prefix = this.db.prepare(
      'SELECT key_prefix FROM tenant_api_keys WHERE register_id = ? AND active = 1 ORDER BY created_at DESC LIMIT 1',
    );
    const devices = this.db.prepare(
      `SELECT device_id, first_seen_at, last_seen_at FROM register_devices
       WHERE register_id = ? AND (? IS NULL OR last_seen_at >= ?) ORDER BY last_seen_at DESC`,
    );
    return rows.map((r): RegisterItem => {
      const key = prefix.get(r.id) as { key_prefix: string } | undefined;
      const others = devices.all(r.id, r.bound_at, r.bound_at) as { device_id: string; first_seen_at: string; last_seen_at: string }[];
      return {
        id: r.id,
        name: r.name,
        branch: r.branch,
        pointOfSale: r.point_of_sale,
        active: r.active === 1,
        deviceId: r.device_id,
        boundAt: r.bound_at,
        lastSeenAt: r.last_seen_at,
        keyPrefix: key?.key_prefix ?? null,
        createdAt: r.created_at,
        otherDevices: others.map((d) => ({ deviceId: d.device_id, firstSeenAt: d.first_seen_at, lastSeenAt: d.last_seen_at })),
      };
    });
  }

  /** Para los avisos del pull: si el equipo es el ligado y si otro usó la key hace poco. */
  noticeState(registerId: string, deviceId: string): RegisterNoticeState {
    const reg = this.db.prepare('SELECT device_id, bound_at FROM registers WHERE id = ?').get(registerId) as
      | { device_id: string | null; bound_at: string | null }
      | undefined;
    if (reg === undefined || reg.device_id === null || deviceId === '') {
      return { registerId, binding: 'bound', sharedRecently: false };
    }
    if (reg.device_id !== deviceId) {
      return { registerId, binding: 'foreign', sharedRecently: false };
    }
    const since = new Date(this.now().getTime() - SHARED_WINDOW_MS).toISOString();
    const shared = this.db
      .prepare('SELECT 1 FROM register_devices WHERE register_id = ? AND last_seen_at > ? AND last_seen_at >= ? LIMIT 1')
      .get(registerId, since, reg.bound_at ?? '');
    return { registerId, binding: 'bound', sharedRecently: shared !== undefined };
  }

  private get(tenantId: string, registerId: string): RegisterRow {
    const row = this.db.prepare('SELECT * FROM registers WHERE id = ? AND tenant_id = ?').get(registerId, tenantId) as
      | RegisterRow
      | undefined;
    if (row === undefined) throw new DomainError(404, 'Caja no encontrada');
    return row;
  }
}
