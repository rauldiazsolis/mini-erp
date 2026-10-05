import { describe, it, expect } from 'vitest';
import { accessText, helpWhatsappUrl } from '../src/client/state/help-state.ts';
import { auditActorText } from '../src/client/state/users-state.ts';
import { parseLocation, platformUrl } from '../src/client/routing/admin-routes.ts';
import { formatDate, formatTime } from '../src/client/format.ts';

const textOf = (url: string): string => new URL(url).searchParams.get('text') ?? '';

describe('pedidos de ayuda en el cliente (#23, M7b)', () => {
  it('el WhatsApp lleva quién, de qué comercio, el mensaje y el link', () => {
    const url = helpWhatsappUrl({
      phone: '+54 9 11 5555-1234',
      userName: 'Juan',
      tenantName: 'Kiosco X',
      message: 'No veo un cliente',
      link: 'https://mini.contax.ar/ayuda/help_1',
    });
    expect(url.startsWith('https://wa.me/5491155551234?text=')).toBe(true);
    expect(textOf(url)).toBe('Hola, soy Juan de Kiosco X. No veo un cliente https://mini.contax.ar/ayuda/help_1');
    const sinMensaje = helpWhatsappUrl({ phone: '5491155551234', userName: 'Juan', tenantName: 'Kiosco X', message: '  ', link: 'L' });
    expect(textOf(sinMensaje)).toBe('Hola, soy Juan de Kiosco X. L');
  });

  it('los accesos dicen quién entró, a qué hora y si fue por el pedido', () => {
    const now = new Date('2026-10-05T18:00:00.000Z');
    const hoy = '2026-10-05T13:32:00.000Z';
    expect(accessText({ at: hoy, staffName: 'Ana', byRequest: true }, now)).toBe(`Soporte (Ana) entró a las ${formatTime(hoy)} por tu pedido`);
    expect(accessText({ at: hoy, staffName: 'Ana', byRequest: false }, now)).toBe(`Soporte (Ana) entró a las ${formatTime(hoy)}`);
    const antes = '2026-10-03T13:32:00.000Z';
    expect(accessText({ at: antes, staffName: 'Ana', byRequest: false }, now)).toBe(`Soporte (Ana) entró el ${formatDate(antes)} a las ${formatTime(antes)}`);
  });

  it('la auditoría muestra "Ana (soporte) como Juan"', () => {
    expect(auditActorText({ actorName: 'Juan', impersonatorName: 'Ana' })).toBe('Ana (soporte) como Juan');
    expect(auditActorText({ actorName: 'Juan', impersonatorName: null })).toBe('Juan');
  });

  it('la solapa Pedidos de la plataforma', () => {
    expect(parseLocation('/plataforma/pedidos', '')).toEqual({ kind: 'plataforma', tab: 'requests', tenantSlug: null, params: {} });
    expect(platformUrl('requests')).toBe('/plataforma/pedidos');
  });
});
