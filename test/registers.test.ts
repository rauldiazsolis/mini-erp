import { describe, it, expect, beforeEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { openSystemDb } from '../src/server/db/system-db.ts';
import { ApiKeyService } from '../src/server/tenant/api-key-service.ts';
import { RegisterService } from '../src/server/registers/register-service.ts';

describe('cajas con equipo ligado (#21)', () => {
  let db: DatabaseSync;
  let now: Date;
  let registers: RegisterService;
  let keys: ApiKeyService;

  beforeEach(() => {
    db = openSystemDb(':memory:');
    db.prepare("INSERT INTO tenants (id, slug, name, created_at) VALUES ('t1', 't1', 'T1', '2026-10-01T00:00:00.000Z')").run();
    now = new Date('2026-10-03T12:00:00.000Z');
    keys = new ApiKeyService(db);
    registers = new RegisterService(db, () => now);
  });

  const nueva = () => registers.create({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });

  it('crear una caja genera su key, que valida con la caja', () => {
    const created = nueva();
    expect(keys.validateApiKey(created.rawKey)).toEqual({ tenantId: 't1', branch: 'CENTRAL', pointOfSale: 'Caja 1', registerId: created.id });
  });

  it('createApiKey (alta, demos) también crea la caja', () => {
    const key = keys.createApiKey({ tenantId: 't1', name: 'Caja 1', branch: 'CENTRAL', pointOfSale: 'Caja 1' });
    expect(keys.validateApiKey(key.rawKey)?.registerId).toBe(key.registerId);
    expect(registers.list('t1').map((r) => r.id)).toEqual([key.registerId]);
  });

  it('el primer equipo se liga; otro queda como ajeno', () => {
    const { id } = nueva();
    expect(registers.seen(id, 'dev-a')).toBe('bound');
    expect(registers.seen(id, 'dev-a')).toBe('bound');
    expect(registers.seen(id, 'dev-b')).toBe('foreign');
    expect(registers.seen(id, '')).toBe('bound');
    const [caja] = registers.list('t1');
    expect(caja?.deviceId).toBe('dev-a');
    expect(caja?.otherDevices.map((d) => d.deviceId)).toEqual(['dev-b']);
  });

  it('rotar la key mantiene la caja y su equipo; la vieja deja de validar', () => {
    const created = nueva();
    registers.seen(created.id, 'dev-a');
    const rotated = registers.rotateKey('t1', created.id);
    expect(keys.validateApiKey(created.rawKey)).toBeUndefined();
    expect(keys.validateApiKey(rotated.rawKey)?.registerId).toBe(created.id);
    expect(registers.list('t1')[0]?.deviceId).toBe('dev-a');
    expect(registers.list('t1')[0]?.keyPrefix).toBe(rotated.keyPrefix);
  });

  it('pasar la caja liga al otro equipo y el anterior deja de avisar como compartido', () => {
    const { id } = nueva();
    registers.seen(id, 'dev-a');
    registers.seen(id, 'dev-b');
    expect(registers.noticeState(id, 'dev-a')).toEqual({ registerId: id, binding: 'bound', sharedRecently: true });
    expect(registers.noticeState(id, 'dev-b')).toEqual({ registerId: id, binding: 'foreign', sharedRecently: false });
    now = new Date('2026-10-03T13:00:00.000Z');
    registers.transferTo('t1', id, 'dev-b');
    expect(registers.list('t1')[0]?.deviceId).toBe('dev-b');
    expect(registers.list('t1')[0]?.otherDevices).toEqual([]);
    expect(registers.noticeState(id, 'dev-b')).toEqual({ registerId: id, binding: 'bound', sharedRecently: false });
    expect(registers.noticeState(id, 'dev-a').binding).toBe('foreign');
  });

  it('pasar la caja a un equipo que nunca la usó da 400', () => {
    const { id } = nueva();
    expect(() => { registers.transferTo('t1', id, 'dev-x'); }).toThrow('Ese equipo no usó esta caja');
  });

  it('el aviso de key compartida se va a los 7 días sin ver al otro equipo', () => {
    const { id } = nueva();
    registers.seen(id, 'dev-a');
    registers.seen(id, 'dev-b');
    now = new Date('2026-10-10T12:00:01.000Z');
    expect(registers.noticeState(id, 'dev-a').sharedRecently).toBe(false);
  });

  it('desligar deja la caja libre; desactivar revoca sus keys', () => {
    const created = nueva();
    registers.seen(created.id, 'dev-a');
    registers.unbind('t1', created.id);
    expect(registers.seen(created.id, 'dev-b')).toBe('bound');
    registers.deactivate('t1', created.id);
    expect(keys.validateApiKey(created.rawKey)).toBeUndefined();
    expect(registers.list('t1')[0]?.active).toBe(false);
  });

  it('una caja de otro comercio da 404', () => {
    const { id } = nueva();
    expect(() => { registers.unbind('otro', id); }).toThrow('Caja no encontrada');
  });
});
