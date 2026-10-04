import { describe, it, expect } from 'vitest';
import { canonicalUrl, routeFromPath, navigate, routeSignal } from '../src/client/state/route-state.ts';
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
    ['/plataforma', 'plataforma'],
  ] as const)('%s → %s', (path, route) => {
    expect(routeFromPath(path)).toBe(route);
  });

  it('/onboarding se reescribe a /alta', () => {
    expect(canonicalUrl({ pathname: '/onboarding', search: '' })).toBe('/alta');
    expect(canonicalUrl({ pathname: '/alta', search: '' })).toBeUndefined();
  });

  it('navigate cambia la ruta', () => {
    navigate('/admin');
    expect(routeSignal.value.kind).toBe('admin');
    navigate('/');
    expect(routeSignal.value.kind).toBe('landing');
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

  it('el origen del POS sale de VITE_POS_URL al compilar, con pos.contax.ar por defecto (#11, #38)', () => {
    expect(DEFAULT_POS_ORIGIN).toBe('https://pos.contax.ar');
    expect(publishedPosOrigin(undefined)).toBe(DEFAULT_POS_ORIGIN);
    expect(publishedPosOrigin('')).toBe(DEFAULT_POS_ORIGIN);
    expect(publishedPosOrigin(' https://otro-pos.example.com/ ')).toBe('https://otro-pos.example.com');
    expect(publishedPosOrigin('otro-pos.example.com')).toBe(DEFAULT_POS_ORIGIN);
    expect(publishedPosOrigin('ftp://otro-pos.example.com')).toBe(DEFAULT_POS_ORIGIN);
  });
});
