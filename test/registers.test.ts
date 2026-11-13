import { describe, it, expect, beforeEach } from 'vitest';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { RegisterService } from '../src/server/registers/register-service.ts';
import { setupTestDb } from './helpers/test-db.ts';

const db = setupTestDb();

describe('cajas con equipo ligado (#21)', () => {
  let now: Date;
  let registers: RegisterService;
  let keys: ApiKeyService;

  beforeEach(async () => {
    await db().system.insertInto('tenants').values({ id: 't1', slug: 't1', name: 'T1', created_at: '2026-10-01T00:00:00.000Z' }).execute();
    now = new Date('2026-10-03T12:00:00.000Z');
    keys = new ApiKeyService(db().system);
    registers = new RegisterService(db().system, () => now);
  });

  const nueva = async () => await registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });

  it('crear una caja genera su key, que valida con la caja', async () => {
    const created = await nueva();
    expect(await keys.validateApiKey(created.rawKey)).toEqual({
      tenantId: 't1',
      branch: 'CENTRAL',
      pointOfSale: 'Caja 1',
      registerId: created.id,
      keyId: expect.any(String) as unknown,
    });
  });

  it('createApiKey (alta, demos) también crea la caja', async () => {
    const key = await keys.createApiKey({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect((await keys.validateApiKey(key.rawKey))?.registerId).toBe(key.registerId);
    expect((await registers.list('t1')).map((r) => r.id)).toEqual([key.registerId]);
  });

  it('el primer equipo se liga; otro queda como ajeno', async () => {
    const { id } = await nueva();
    expect(await registers.seen(id, 'dev-a')).toBe('bound');
    expect(await registers.seen(id, 'dev-a')).toBe('bound');
    expect(await registers.seen(id, 'dev-b')).toBe('foreign');
    expect(await registers.seen(id, '')).toBe('bound');
    const [caja] = await registers.list('t1');
    expect(caja?.deviceId).toBe('dev-a');
    expect(caja?.otherDevices.map((d) => d.deviceId)).toEqual(['dev-b']);
  });

  it('rotar la key mantiene la caja y su equipo; la vieja deja de validar', async () => {
    const created = await nueva();
    await registers.seen(created.id, 'dev-a');
    const rotated = await registers.rotateKey('t1', created.id);
    expect(await keys.validateApiKey(created.rawKey)).toBeUndefined();
    expect((await keys.validateApiKey(rotated.rawKey))?.registerId).toBe(created.id);
    expect((await registers.list('t1'))[0]?.deviceId).toBe('dev-a');
    expect((await registers.list('t1'))[0]?.keyPrefix).toBe(rotated.keyPrefix);
  });

  it('pasar la caja liga al otro equipo y el anterior deja de avisar como compartido', async () => {
    const { id } = await nueva();
    await registers.seen(id, 'dev-a');
    await registers.seen(id, 'dev-b');
    expect(await registers.noticeState(id, 'dev-a')).toEqual({ registerId: id, binding: 'bound', sharedRecently: true });
    expect(await registers.noticeState(id, 'dev-b')).toEqual({ registerId: id, binding: 'foreign', sharedRecently: false });
    now = new Date('2026-10-03T13:00:00.000Z');
    await registers.transferTo('t1', id, 'dev-b');
    expect((await registers.list('t1'))[0]?.deviceId).toBe('dev-b');
    expect((await registers.list('t1'))[0]?.otherDevices).toEqual([]);
    expect(await registers.noticeState(id, 'dev-b')).toEqual({ registerId: id, binding: 'bound', sharedRecently: false });
    expect((await registers.noticeState(id, 'dev-a')).binding).toBe('foreign');
  });

  it('pasar la caja a un equipo que nunca la usó da 400', async () => {
    const { id } = await nueva();
    await expect(registers.transferTo('t1', id, 'dev-x')).rejects.toThrow('Ese equipo no usó esta caja');
  });

  it('el aviso de key compartida se va a los 7 días sin ver al otro equipo', async () => {
    const { id } = await nueva();
    await registers.seen(id, 'dev-a');
    await registers.seen(id, 'dev-b');
    now = new Date('2026-10-10T12:00:01.000Z');
    expect((await registers.noticeState(id, 'dev-a')).sharedRecently).toBe(false);
  });

  it('desligar deja la caja libre; desactivar revoca sus keys', async () => {
    const created = await nueva();
    await registers.seen(created.id, 'dev-a');
    await registers.unbind('t1', created.id);
    expect(await registers.seen(created.id, 'dev-b')).toBe('bound');
    await registers.deactivate('t1', created.id);
    expect(await keys.validateApiKey(created.rawKey)).toBeUndefined();
    expect((await registers.list('t1'))[0]?.active).toBe(false);
  });

  it('una caja de otro comercio da 404', async () => {
    const { id } = await nueva();
    await expect(registers.unbind('otro', id)).rejects.toThrow('Caja no encontrada');
  });
});
