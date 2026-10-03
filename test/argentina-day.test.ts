import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import {
  argentinaDay, argentinaHour, argentinaToday, shiftDay, daysBetween, pickDay,
} from '../src/shared/argentina-day.ts';

describe('día argentino (#20)', () => {
  const db = new DatabaseSync(':memory:');

  it.each([
    ['2026-10-02T02:59:59.999Z', '2026-10-01'],
    ['2026-10-02T03:00:00.000Z', '2026-10-02'],
    ['2026-10-02T12:00:00.000Z', '2026-10-02'],
    ['2026-10-01T23:30:00-03:00', '2026-10-01'],
    ['2026-01-01T01:00:00.000Z', '2025-12-31'],
  ])('%s → %s, igual que date(x, "-3 hours") de SQLite', (iso, day) => {
    expect(argentinaDay(iso)).toBe(day);
    expect(db.prepare("SELECT date(?, '-3 hours') AS d").get(iso)).toEqual({ d: day });
  });

  it('un instante inválido no tiene día', () => {
    expect(argentinaDay('cualquier cosa')).toBeNull();
    expect(argentinaHour('cualquier cosa')).toBeNull();
  });

  it('hora argentina, hoy, desplazar y contar días', () => {
    expect(argentinaHour('2026-10-02T02:30:00.000Z')).toBe(23);
    expect(argentinaToday(new Date('2026-10-02T01:00:00.000Z'))).toBe('2026-10-01');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });

  it('pickDay: la fecha numerada manda; si no, el primer instante válido', () => {
    expect(pickDay('2026-09-24', ['2026-09-25T12:00:00.000Z'])).toBe('2026-09-24');
    expect(pickDay(undefined, [undefined, 'x', '2026-09-25T02:00:00.000Z'])).toBe('2026-09-24');
    expect(pickDay('24/09', ['2026-09-25T12:00:00.000Z'])).toBe('2026-09-25');
    expect(pickDay(undefined, [])).toBeNull();
  });
});
