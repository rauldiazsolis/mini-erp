import type { Kysely } from 'kysely';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { DomainError } from '../errors.ts';
import { ApiKeyService } from '../tenant/api-key-service.ts';
import type { RegisterItem, RegisterNoticeState } from '../../shared/register-types.ts';

const SHARED_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

type RegisterRow = {
  id: string;
  name: string;
  branch: string;
  point_of_sale: string;
  active: boolean;
  device_id: string | null;
  bound_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

const REGISTER_COLUMNS = [
  'id',
  'name',
  'branch',
  'point_of_sale',
  'active',
  'device_id',
  'bound_at',
  'last_seen_at',
  'created_at',
] as const;

/**
 * Cajas del POS (#21): sucursal + punto de venta con un solo equipo ligado. La key es de la caja:
 * rotarla no cambia la caja ni su equipo. Otro equipo con la misma key queda como ajeno.
 */
export class RegisterService {
  private db: Kysely<SystemDatabase>;
  private now: () => Date;
  private keys: ApiKeyService;

  constructor(db: Kysely<SystemDatabase>, now: () => Date) {
    this.db = db;
    this.now = now;
    this.keys = new ApiKeyService(db);
  }

  async create(p: { tenantId: string; name: string; branch: string; pointOfSale: string }): Promise<{ id: string; rawKey: string; keyPrefix: string }> {
    const created = await this.keys.createApiKey(p);
    return { id: created.registerId, rawKey: created.rawKey, keyPrefix: created.keyPrefix };
  }

  /** Registra que un equipo usó la key: liga la caja si no tiene equipo. Un `deviceId` vacío no liga. */
  async seen(registerId: string, deviceId: string): Promise<'bound' | 'foreign'> {
    if (deviceId === '') return 'bound';
    const at = this.now().toISOString();
    // Ligar es condicional: dos equipos que llegan a la vez no se ligan los dos.
    const bound = await this.db
      .updateTable('registers')
      .set((eb) => ({ device_id: deviceId, bound_at: eb.fn.coalesce('bound_at', eb.val(at)), last_seen_at: at }))
      .where('id', '=', registerId)
      .where((eb) => eb.or([eb('device_id', 'is', null), eb('device_id', '=', deviceId)]))
      .executeTakeFirst();
    if (Number(bound.numUpdatedRows) > 0) return 'bound';
    const exists = await this.db.selectFrom('registers').select('id').where('id', '=', registerId).executeTakeFirst();
    if (exists === undefined) return 'bound';
    await this.upsertDevice(this.db, registerId, deviceId, at, at);
    return 'foreign';
  }

  /** Desactiva la key vieja y crea la nueva, todo junto. */
  async rotateKey(tenantId: string, registerId: string): Promise<{ rawKey: string; keyPrefix: string }> {
    return await this.db.transaction().execute(async (trx) => {
      const reg = await this.get(tenantId, registerId, trx);
      await trx.updateTable('tenant_api_keys').set({ active: false }).where('register_id', '=', registerId).execute();
      const key = await this.keys.insertKey({ tenantId, registerId, name: reg.name, branch: reg.branch, pointOfSale: reg.point_of_sale }, trx);
      return { rawKey: key.rawKey, keyPrefix: key.keyPrefix };
    });
  }

  /** Pasa la caja a un equipo que ya la usó; el anterior queda como uno más de los otros. */
  async transferTo(tenantId: string, registerId: string, deviceId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      const reg = await this.get(tenantId, registerId, trx);
      const other = await trx
        .deleteFrom('register_devices')
        .where('register_id', '=', registerId)
        .where('device_id', '=', deviceId)
        .executeTakeFirst();
      if (Number(other.numDeletedRows) === 0) throw new DomainError(400, 'Ese equipo no usó esta caja');
      const at = this.now().toISOString();
      if (reg.device_id !== null) {
        const last = reg.last_seen_at ?? reg.bound_at ?? at;
        await this.upsertDevice(trx, registerId, reg.device_id, reg.bound_at ?? last, last);
      }
      await trx.updateTable('registers').set({ device_id: deviceId, bound_at: at, last_seen_at: null }).where('id', '=', registerId).execute();
    });
  }

  async unbind(tenantId: string, registerId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.get(tenantId, registerId, trx);
      await trx.updateTable('registers').set({ device_id: null, bound_at: null, last_seen_at: null }).where('id', '=', registerId).execute();
      await trx.deleteFrom('register_devices').where('register_id', '=', registerId).execute();
    });
  }

  async deactivate(tenantId: string, registerId: string): Promise<void> {
    await this.db.transaction().execute(async (trx) => {
      await this.get(tenantId, registerId, trx);
      await trx.updateTable('registers').set({ active: false }).where('id', '=', registerId).execute();
      await trx.updateTable('tenant_api_keys').set({ active: false }).where('register_id', '=', registerId).execute();
    });
  }

  async list(tenantId: string): Promise<RegisterItem[]> {
    const rows: RegisterRow[] = await this.db
      .selectFrom('registers')
      .select(REGISTER_COLUMNS)
      .where('tenant_id', '=', tenantId)
      .orderBy('active', 'desc')
      .orderBy('created_at', 'asc')
      .orderBy('id', 'asc')
      .execute();
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const keys = await this.db
      .selectFrom('tenant_api_keys')
      .select(['register_id', 'key_prefix'])
      .where('register_id', 'in', ids)
      .where('active', '=', true)
      .orderBy('created_at', 'desc')
      .execute();
    const prefixes = new Map<string, string>();
    for (const k of keys) {
      if (k.register_id !== null && !prefixes.has(k.register_id)) prefixes.set(k.register_id, k.key_prefix);
    }
    const devices = await this.db
      .selectFrom('register_devices')
      .select(['register_id', 'device_id', 'first_seen_at', 'last_seen_at'])
      .where('register_id', 'in', ids)
      .orderBy('last_seen_at', 'desc')
      .execute();
    return rows.map((r): RegisterItem => {
      // Los otros equipos cuentan desde que se ligó el actual: los de antes ya no comparten la key.
      const boundAt = r.bound_at === null ? undefined : Date.parse(r.bound_at);
      const others = devices.filter((d) => d.register_id === r.id && (boundAt === undefined || Date.parse(d.last_seen_at) >= boundAt));
      return {
        id: r.id,
        name: r.name,
        branch: r.branch,
        pointOfSale: r.point_of_sale,
        active: r.active,
        deviceId: r.device_id,
        boundAt: r.bound_at,
        lastSeenAt: r.last_seen_at,
        keyPrefix: prefixes.get(r.id) ?? null,
        createdAt: r.created_at,
        otherDevices: others.map((d) => ({ deviceId: d.device_id, firstSeenAt: d.first_seen_at, lastSeenAt: d.last_seen_at })),
      };
    });
  }

  /** Para los avisos del pull: si el equipo es el ligado y si otro usó la key hace poco. */
  async noticeState(registerId: string, deviceId: string): Promise<RegisterNoticeState> {
    const reg = await this.db.selectFrom('registers').select(['device_id', 'bound_at']).where('id', '=', registerId).executeTakeFirst();
    if (reg === undefined || reg.device_id === null || deviceId === '') {
      return { registerId, binding: 'bound', sharedRecently: false };
    }
    if (reg.device_id !== deviceId) {
      return { registerId, binding: 'foreign', sharedRecently: false };
    }
    const since = new Date(this.now().getTime() - SHARED_WINDOW_MS).toISOString();
    const boundAt = reg.bound_at;
    const shared = await this.db
      .selectFrom('register_devices')
      .select('device_id')
      .where('register_id', '=', registerId)
      .where('last_seen_at', '>', since)
      .$if(boundAt !== null, (qb) => qb.where('last_seen_at', '>=', boundAt ?? since))
      .limit(1)
      .executeTakeFirst();
    return { registerId, binding: 'bound', sharedRecently: shared !== undefined };
  }

  private async upsertDevice(db: Kysely<SystemDatabase>, registerId: string, deviceId: string, firstSeenAt: string, lastSeenAt: string): Promise<void> {
    await db
      .insertInto('register_devices')
      .values({ register_id: registerId, device_id: deviceId, first_seen_at: firstSeenAt, last_seen_at: lastSeenAt })
      .onConflict((oc) => oc.columns(['register_id', 'device_id']).doUpdateSet((eb) => ({ last_seen_at: eb.ref('excluded.last_seen_at') })))
      .execute();
  }

  private async get(tenantId: string, registerId: string, db: Kysely<SystemDatabase> = this.db): Promise<RegisterRow> {
    const row = await db
      .selectFrom('registers')
      .select(REGISTER_COLUMNS)
      .where('id', '=', registerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (row === undefined) throw new DomainError(404, 'Caja no encontrada');
    return row;
  }
}
