import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalPath, routeFromPath, navigate, routeSignal } from '../src/client/state/route-state.ts';
import {
  DEFAULT_POS_ORIGIN,
  POS_VERSION,
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
  it('la versión del POS sale de contract.json', () => {
    const contract = JSON.parse(readFileSync('contract.json', 'utf-8')) as { posVersion: string };
    expect(POS_VERSION).toBe(contract.posVersion);
  });

  it('abre el POS publicado en demo contra este Connector API', () => {
    const url = new URL(
      buildDemoUrl(posBaseUrl('0.1.0', 'http://localhost:4100', false, 'https://pos.contax.ar'), 'http://localhost:4100'),
    );
    expect(`${url.origin}${url.pathname}`).toBe('https://pos.contax.ar/0.1.0/');
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
