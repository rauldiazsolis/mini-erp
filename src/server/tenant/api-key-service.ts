import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { generatePosApiKey, hashApiKey } from '../auth/crypto.ts';

export type ValidatedPosKey = {
  tenantId: string;
  branch: string;
  pointOfSale: string;
  /** La caja de la key (#21). */
  registerId: string;
};

export class ApiKeyService {
  private systemDb: DatabaseSync;

  constructor(systemDb: DatabaseSync) {
    this.systemDb = systemDb;
  }

  /** Crea una caja y su key (#21): la usan el alta, las demos y `RegisterService.create`. */
  createApiKey(params: { tenantId: string; name: string; branch: string; pointOfSale: string }): {
    id: string;
    registerId: string;
    rawKey: string;
    keyPrefix: string;
  } {
    const registerId = `reg_${randomUUID()}`;
    this.systemDb
      .prepare(
        'INSERT INTO registers (id, tenant_id, name, branch, point_of_sale, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
      )
      .run(registerId, params.tenantId, params.name.trim(), params.branch.trim(), params.pointOfSale.trim(), new Date().toISOString());
    const key = this.insertKey({ ...params, registerId });
    return { ...key, registerId };
  }

  /** Una key nueva para una caja existente: rotarla no cambia la caja. */
  insertKey(params: { tenantId: string; registerId: string; name: string; branch: string; pointOfSale: string }): {
    id: string;
    rawKey: string;
    keyPrefix: string;
  } {
    const id = `key_${randomUUID()}`;
    const { rawKey, keyPrefix, keyHash } = generatePosApiKey();
    this.systemDb
      .prepare(
        `INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at, register_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      )
      .run(
        id,
        params.tenantId,
        params.name.trim(),
        keyHash,
        keyPrefix,
        params.branch.trim(),
        params.pointOfSale.trim(),
        new Date().toISOString(),
        params.registerId,
      );
    return { id, rawKey, keyPrefix };
  }

  /** La key activa de una caja activa: el comercio, la caja y su sucursal y punto de venta. */
  validateApiKey(rawKey: string): ValidatedPosKey | undefined {
    const keyHash = hashApiKey(rawKey);
    const row = this.systemDb
      .prepare(
        `SELECT k.tenant_id, r.branch, r.point_of_sale, r.id AS register_id
         FROM tenant_api_keys k JOIN registers r ON r.id = k.register_id
         WHERE k.key_hash = ? AND k.active = 1 AND r.active = 1`,
      )
      .get(keyHash) as { tenant_id: string; branch: string; point_of_sale: string; register_id: string } | undefined;

    if (row === undefined) {
      return undefined;
    }

    return {
      tenantId: row.tenant_id,
      branch: row.branch,
      pointOfSale: row.point_of_sale,
      registerId: row.register_id,
    };
  }
}
