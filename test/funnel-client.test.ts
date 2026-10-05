import { describe, it, expect } from 'vitest';
import { buildUrl, parseLocation, platformUrl, visitorUrl } from '../src/client/routing/admin-routes.ts';
import { contactWhatsappUrl, percentOf } from '../src/client/state/funnel-state.ts';

describe('cliente del panel del embudo (#25)', () => {
  it('Embudo y Visitantes llevan sus filtros en la URL', () => {
    const url = platformUrl('funnel', { desde: '2026-10-01', hasta: '2026-10-05', rubro: 'kiosco', otro: 'x' });
    expect(url).toBe('/plataforma/embudo?desde=2026-10-01&hasta=2026-10-05&rubro=kiosco');
    expect(parseLocation('/plataforma/visitantes', '?filtro=pending&q=ana&etapa=load')).toEqual({
      kind: 'plataforma',
      section: 'visitors',
      tenantSlug: null,
      params: { etapa: 'load', filtro: 'pending', q: 'ana' },
    });
  });

  it('la historia de un visitante es /plataforma/visitantes/<id> y marca Visitantes', () => {
    expect(visitorUrl('c-123')).toBe('/plataforma/visitantes/c-123');
    const route = parseLocation('/plataforma/visitantes/c-123', '');
    expect(route).toEqual({ kind: 'plataforma', section: 'visitors', tenantSlug: null, params: { id: 'c-123' } });
    expect(buildUrl(route)).toBe('/plataforma/visitantes/c-123');
  });

  it('el link de WhatsApp saluda por el nombre', () => {
    expect(contactWhatsappUrl('Ana', '1155550000')).toBe(
      `https://wa.me/1155550000?text=${encodeURIComponent('Hola Ana, te escribo de mini contax por tu pedido de ayuda para empezar.')}`,
    );
    expect(contactWhatsappUrl(null, '1155550000')).toContain(encodeURIComponent('Hola, te escribo'));
  });

  it('el porcentaje sobre la etapa anterior es entero y sin anterior es un guion', () => {
    expect(percentOf(1, 3)).toBe('33 %');
    expect(percentOf(0, 0)).toBe('—');
  });
});
