import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { initTenantDb } from '../src/server/db/tenant-db.ts';
import { noticesFor } from '../src/server/notices/notice-service.ts';
import { formatDayShort, formatPesos } from '../src/server/billing/money-text.ts';
import type { BillingSummary } from '../src/shared/credits-types.ts';

const base: BillingSummary = {
  billable: true,
  state: 'ok',
  holder: null,
  paidBalance: 0,
  giftBalance: 50000,
  nextGiftExpiry: null,
  debt: 0,
  deadline: null,
  daysCovered: 50,
  dailyBurn: 1000,
};

describe('avisos de créditos y de caja en el pull (#21)', () => {
  let db: DatabaseSync;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    initTenantDb(db);
  });

  it('textos fijos del servidor: pesos y DD/MM', () => {
    expect(formatPesos(12345)).toBe('$ 12.345');
    expect(formatPesos(1000.4)).toBe('$ 1.000');
    expect(formatDayShort('2026-10-03')).toBe('03/10');
  });

  it('ok: sin avisos de créditos', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: base })).toEqual([]);
  });

  it('low: warning con los días', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, state: 'low', daysCovered: 4 } })).toEqual([
      { id: 'credits:low', severity: 'warning', message: 'Te quedan créditos para unos 4 días. Cargá saldo desde mini → Créditos.' },
    ]);
  });

  it('debt: critical con el importe y la fecha', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, state: 'debt', debt: 12345, deadline: '2026-10-13' } })).toEqual([
      {
        id: 'credits:debt',
        severity: 'critical',
        message: 'mini contax: sin créditos, debés $ 12.345. Pagá antes del 13/10 para que mini siga funcionando. El POS sigue vendiendo.',
      },
    ]);
  });

  it('restricted: critical', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, state: 'restricted', debt: 1000, deadline: '2026-10-01' } })).toEqual([
      {
        id: 'credits:restricted',
        severity: 'critical',
        message: 'mini contax está restringido por deuda de $ 1.000. El POS sigue vendiendo y sincronizando. Pagá desde mini → Créditos.',
      },
    ]);
  });

  it('no facturable (demo): sin avisos de créditos', () => {
    expect(noticesFor(db, { deviceId: 'dev-1', billing: { ...base, billable: false, state: 'low' } })).toEqual([]);
  });

  it('los avisos de créditos llegan también sin deviceId', () => {
    expect(noticesFor(db, { deviceId: undefined, billing: { ...base, state: 'low', daysCovered: 2 } })).toHaveLength(1);
  });

  it('equipo ajeno y key compartida', () => {
    expect(noticesFor(db, { deviceId: 'dev-2', register: { registerId: 'r1', binding: 'foreign', sharedRecently: false } })).toEqual([
      {
        id: 'register:foreign-device',
        severity: 'warning',
        ref: { type: 'register', id: 'r1' },
        message: 'Esta caja está ligada a otro equipo: tus ventas se cobran aparte. Pedile al dueño que te pase la caja o te cree una.',
      },
    ]);
    expect(noticesFor(db, { deviceId: 'dev-1', register: { registerId: 'r1', binding: 'bound', sharedRecently: true } })).toEqual([
      { id: 'register:shared-key', severity: 'warning', ref: { type: 'register', id: 'r1' }, message: 'Otro equipo está usando la key de esta caja.' },
    ]);
    expect(noticesFor(db, { deviceId: 'dev-1', register: { registerId: 'r1', binding: 'bound', sharedRecently: false } })).toEqual([]);
  });
});
