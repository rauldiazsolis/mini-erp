import { describe, it, expect } from 'vitest';
import { createDbAtVersion } from './helpers/db-at-version.ts';
import { TENANT_SCHEMA } from '../src/server/db/migrations/tenant.ts';
import { migrateDb } from '../src/server/db/migrations/migrate.ts';

describe('migración de comercio v6 caja-de-venta (#21)', () => {
  it('suma register_id y charge_device nulos y las ventas sobreviven', () => {
    const db = createDbAtVersion(TENANT_SCHEMA, 5);
    db.prepare(
      `INSERT INTO sales (id, payload, device_id, branch, point_of_sale, total, voids_sale_id, created_at, day)
       VALUES ('s1', '{"id":"s1","total":100}', 'dev-1', 'CENTRAL', 'Caja 1', 100, NULL, '2026-10-01T12:00:00.000Z', '2026-10-01')`,
    ).run();
    migrateDb(db, TENANT_SCHEMA);
    expect(db.prepare('SELECT id, total, day, register_id, charge_device FROM sales').all()).toEqual([
      { id: 's1', total: 100, day: '2026-10-01', register_id: null, charge_device: null },
    ]);
    expect(db.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
  });
});
