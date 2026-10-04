import { describe, it, expect } from 'vitest';
import { canonicalPath, routeFromPath, navigate, routeSignal } from '../src/client/state/route-state.ts';
import {
  DEFAULT_POS_ORIGIN,
  buildDemoUrl,
  posBaseUrl,
  publishedPosOrigin,
} from '../src/client/state/demo-link.ts';

describe('Ruteo del SPA (#9)', () => {
  it.each([
    ['/', 'landing'],
    ['/admin', 'admin'],
    ['/admin/', 'admin'],
    ['/admin/lo-que-sea', 'admin'],
    ['/alta', 'alta'],
    ['/onboarding', 'alta'],
    ['/invitacion', 'invitacion'],
    ['/restablecer', 'restablecer'],
    ['/no-existe', 'landing'],
  ] as const)('%s → %s', (path, route) => {
    expect(routeFromPath(path)).toBe(route);
  });

  it('/onboarding se reescribe a /alta', () => {
    expect(canonicalPath('/onboarding')).toBe('/alta');
    expect(canonicalPath('/alta')).toBeUndefined();
  });

  it('navigate cambia la ruta', () => {
    navigate('/admin');
    expect(routeSignal.value).toBe('admin');
    navigate('/');
    expect(routeSignal.value).toBe('landing');
  });
});

describe('Link de demo del landing (#9)', () => {
  it('abre el canal del POS publicado en demo contra este Connector API (#58)', () => {
    const url = new URL(
      buildDemoUrl(posBaseUrl('http://localhost:4100', false, 'https://pos.contax.ar'), 'http://localhost:4100'),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://pos.contax.ar/v4/');
    expect(url.searchParams.get('demo')).toBe('true');
    expect(url.searchParams.get('backend')).toBe('http://localhost:4100/connector');
  });

  it('el origen del POS sale de VITE_POS_URL al compilar, con offline-pos.pages.dev por defecto (#11)', () => {
    expect(DEFAULT_POS_ORIGIN).toBe('https://offline-pos.pages.dev');
    expect(publishedPosOrigin(undefined)).toBe(DEFAULT_POS_ORIGIN);
    expect(publishedPosOrigin('')).toBe(DEFAULT_POS_ORIGIN);
    expect(publishedPosOrigin(' https://pos.contax.ar/ ')).toBe('https://pos.contax.ar');
    expect(publishedPosOrigin('pos.contax.ar')).toBe(DEFAULT_POS_ORIGIN);
    expect(publishedPosOrigin('ftp://pos.contax.ar')).toBe(DEFAULT_POS_ORIGIN);
  });
});
