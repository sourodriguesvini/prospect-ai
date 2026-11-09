import { describe, expect, it } from 'vitest';
import { hostnameOf, isLocalRequest } from './host';

describe('hostnameOf', () => {
  it.each([
    ['127.0.0.1:3000', '127.0.0.1'],
    ['localhost', 'localhost'],
    ['LOCALHOST:3100', 'localhost'],
    ['[::1]:3000', '[::1]'],
    ['evil.example:3000', 'evil.example'],
  ])('%s → %s', (input, expected) => {
    expect(hostnameOf(input)).toBe(expected);
  });
});

describe('isLocalRequest', () => {
  it('aceita só hosts locais', () => {
    expect(isLocalRequest('127.0.0.1:3000', null)).toBe(true);
    expect(isLocalRequest('localhost:3000', null)).toBe(true);
    expect(isLocalRequest('[::1]:3000', null)).toBe(true);
  });

  it('recusa host externo, ausente ou parecido com local', () => {
    expect(isLocalRequest('evil.example:3000', null)).toBe(false);
    expect(isLocalRequest(null, null)).toBe(false);
    expect(isLocalRequest('localhost.evil.example', null)).toBe(false);
    expect(isLocalRequest('127.0.0.1.nip.io:3000', null)).toBe(false);
  });

  it('recusa X-Forwarded-Host externo mesmo com Host local', () => {
    expect(isLocalRequest('127.0.0.1:3000', 'evil.example')).toBe(false);
    expect(isLocalRequest('127.0.0.1:3000', 'localhost:3000, evil.example')).toBe(false);
    expect(isLocalRequest('127.0.0.1:3000', '127.0.0.1:3000')).toBe(true);
  });
});
