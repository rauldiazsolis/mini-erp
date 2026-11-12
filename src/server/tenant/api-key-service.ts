import type { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import type { SystemDatabase } from '../db/pg/system-schema.ts';
import { generatePosApiKey, hashApiKey } from '../auth/crypto.ts';

export type ValidatedPosKey = {
  tenantId: string;
  branch: string;
  pointOfSale: string;
  /** La caja de la key (#21). */
  registerId: string;
  /** La key (M10): la sesión del portal queda atada a ella. */
  keyId: string;
};

export type ActiveRegister = { name: string; branch: string; pointOfSale: string };

export class ApiKeyService {
  private db: Kysely<SystemDatabase>;

  constructor(db: Kysely<SystemDatabase>) {
    this.db = db;
  }

  /** Crea una caja y su key (#21), en una transacción: la usan el alta, las demos y `RegisterService.create`. */
  async createApiKey(
    params: { tenantId: string; name: string; branch: string; pointOfSale: string },
    db?: Kysely<SystemDatabase>,
  ): Promise<{
    id: string;
    registerId: string;
    rawKey: string;
    keyPrefix: string;
  }> {
    const run = async (trx: Kysely<SystemDatabase>): Promise<{ id: string; registerId: string; rawKey: string; keyPrefix: string }> => {
      const registerId = `reg_${randomUUID()}`;
      await trx
        .insertInto('registers')
        .values({
          id: registerId,
          tenant_id: params.tenantId,
          name: params.name.trim(),
          branch: params.branch.trim(),
          point_of_sale: params.pointOfSale.trim(),
          active: true,
          created_at: new Date().toISOString(),
        })
        .execute();
      const key = await this.insertKey({ ...params, registerId }, trx);
      return { ...key, registerId };
    };
    return db === undefined ? await this.db.transaction().execute(run) : await run(db);
  }

  /** Una key nueva para una caja existente: rotarla no cambia la caja. */
  async insertKey(
    params: { tenantId: string; registerId: string; name: string; branch: string; pointOfSale: string },
    db: Kysely<SystemDatabase> = this.db,
  ): Promise<{
    id: string;
    rawKey: string;
    keyPrefix: string;
  }> {
    const id = `key_${randomUUID()}`;
    const { rawKey, keyPrefix, keyHash } = generatePosApiKey();
    await db
      .insertInto('tenant_api_keys')
      .values({
        id,
        tenant_id: params.tenantId,
        name: params.name.trim(),
        key_hash: keyHash,
        key_prefix: keyPrefix,
        branch: params.branch.trim(),
        point_of_sale: params.pointOfSale.trim(),
        active: true,
        created_at: new Date().toISOString(),
        register_id: params.registerId,
      })
      .execute();
    return { id, rawKey, keyPrefix };
  }

  /**
   * La caja activa (y, con `keyId`, solo si esa key suya sigue activa): la usan el portal y las demos
   * para saber si una sesión sigue viva.
   */
  async activeRegister(registerId: string, keyId?: string): Promise<ActiveRegister | undefined> {
    const row = await this.db
      .selectFrom('registers as r')
      .select(['r.name', 'r.branch', 'r.point_of_sale'])
      .where('r.id', '=', registerId)
      .where('r.active', '=', true)
      .$if(keyId !== undefined, (qb) =>
        qb.where((eb) =>
          eb.exists(
            eb
              .selectFrom('tenant_api_keys as k')
              .select('k.id')
              .whereRef('k.register_id', '=', 'r.id')
              .where('k.id', '=', keyId ?? '')
              .where('k.active', '=', true),
          ),
        ),
      )
      .executeTakeFirst();
    return row === undefined ? undefined : { name: row.name, branch: row.branch, pointOfSale: row.point_of_sale };
  }

  /** Si el comercio ya tiene una caja activa con ese punto de venta (las demos eligen uno libre). */
  async pointOfSaleInUse(tenantId: string, pointOfSale: string): Promise<boolean> {
    const row = await this.db
      .selectFrom('registers')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('point_of_sale', '=', pointOfSale)
      .where('active', '=', true)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** Desactiva la caja y sus keys (revocar una demo, #24): desde ahí, 401 a todo. */
  async deactivateRegisters(registerIds: readonly string[], db?: Kysely<SystemDatabase>): Promise<void> {
    if (registerIds.length === 0) return;
    const run = async (trx: Kysely<SystemDatabase>): Promise<void> => {
      await trx.updateTable('registers').set({ active: false }).where('id', 'in', registerIds).execute();
      await trx.updateTable('tenant_api_keys').set({ active: false }).where('register_id', 'in', registerIds).execute();
    };
    if (db === undefined) await this.db.transaction().execute(run);
    else await run(db);
  }

  /** La key activa de una caja activa: el comercio, la caja y su sucursal y punto de venta. */
  async validateApiKey(rawKey: string): Promise<ValidatedPosKey | undefined> {
    const row = await this.db
      .selectFrom('tenant_api_keys as k')
      .innerJoin('registers as r', 'r.id', 'k.register_id')
      .select(['k.id as key_id', 'k.tenant_id', 'r.branch', 'r.point_of_sale', 'r.id as register_id'])
      .where('k.key_hash', '=', hashApiKey(rawKey))
      .where('k.active', '=', true)
      .where('r.active', '=', true)
      .executeTakeFirst();

    if (row === undefined) {
      return undefined;
    }

    return {
      tenantId: row.tenant_id,
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      registerId: row.register_id,
      keyId: row.key_id,
    };
  }
}
