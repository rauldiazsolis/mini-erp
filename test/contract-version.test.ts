import { describe, it, expect } from 'vitest';
import {
  CONTRACT_MAJOR,
  CONTRACT_VERSION,
  POS_CHANNEL,
  channelOf,
  majorOf,
} from '../src/shared/contract-version.ts';

describe('contrato implementado y canal del POS (#58)', () => {
  it('el major y el canal salen de la versión', () => {
    expect(majorOf('4.5.0')).toBe('4');
    expect(channelOf('5.0.1')).toBe('v5');
  });

  it('el canal del POS es el del major implementado', () => {
    expect(CONTRACT_MAJOR).toBe(majorOf(CONTRACT_VERSION));
    expect(POS_CHANNEL).toBe(`v${CONTRACT_MAJOR}`);
  });
});
