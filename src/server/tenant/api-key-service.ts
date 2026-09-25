import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { generatePosApiKey, hashApiKey } from '../auth/crypto.ts';

export type PosApiKeyRecord = {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  branch: string;
  pointOfSale: string;
  active: boolean;
  createdAt: string;
};

export type ValidatedPosKey = {
  tenantId: string;
  branch: string;
  pointOfSale: string;
};

export class ApiKeyService {
  private systemDb: DatabaseSync;

  constructor(systemDb: DatabaseSync) {
    this.systemDb = systemDb;
  }

  createApiKey(params: {
    tenantId: string;
    name: string;
    branch: string;
    pointOfSale: string;
  }): { id: string; rawKey: string; keyPrefix: string } {
    const id = `key_${randomUUID()}`;
    const { rawKey, keyPrefix, keyHash } = generatePosApiKey();
    const now = new Date().toISOString();

    this.systemDb
      .prepare(
        `INSERT INTO tenant_api_keys (id, tenant_id, name, key_hash, key_prefix, branch, point_of_sale, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .run(id, params.tenantId, params.name.trim(), keyHash, keyPrefix, params.branch.trim(), params.pointOfSale.trim(), now);

    return { id, rawKey, keyPrefix };
  }

  validateApiKey(rawKey: string): ValidatedPosKey | undefined {
    const keyHash = hashApiKey(rawKey);
    const row = this.systemDb
      .prepare(
        'SELECT tenant_id, branch, point_of_sale, active FROM tenant_api_keys WHERE key_hash = ?',
      )
      .get(keyHash) as
      | { tenant_id: string; branch: string; point_of_sale: string; active: number }
      | undefined;

    if (row === undefined || row.active !== 1) {
      return undefined;
    }

    return {
      tenantId: row.tenant_id,
      branch: row.branch,
      pointOfSale: row.point_of_sale,
    };
  }

  listApiKeys(tenantId: string): PosApiKeyRecord[] {
    const rows = this.systemDb
      .prepare(
        `SELECT id, tenant_id, name, key_prefix, branch, point_of_sale, active, created_at 
         FROM tenant_api_keys 
         WHERE tenant_id = ? 
         ORDER BY created_at DESC`,
      )
      .all(tenantId) as {
      id: string;
      tenant_id: string;
      name: string;
      key_prefix: string;
      branch: string;
      point_of_sale: string;
      active: number;
      created_at: string;
    }[];

    return rows.map((r) => ({
      id: r.id,
      tenantId: r.tenant_id,
      name: r.name,
      keyPrefix: r.key_prefix,
      branch: r.branch,
      pointOfSale: r.point_of_sale,
      active: r.active === 1,
      createdAt: r.created_at,
    }));
  }

  revokeApiKey(id: string, tenantId: string): boolean {
    const res = this.systemDb
      .prepare('UPDATE tenant_api_keys SET active = 0 WHERE id = ? AND tenant_id = ?')
      .run(id, tenantId);
    return res.changes > 0;
  }
}
