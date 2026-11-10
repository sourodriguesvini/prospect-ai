import { describe, expect, it } from 'vitest';
import { hostnameOf, isLocalRequest, isSameOriginRequest } from './host';

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

describe('isSameOriginRequest', () => {
  const local = {
    host: '127.0.0.1:3000',
    origin: 'http://127.0.0.1:3000',
    secFetchSite: 'same-origin',
  };

  it('aceita a própria página', () => {
    expect(isSameOriginRequest(local)).toBe(true);
    expect(isSameOriginRequest({ ...local, secFetchSite: null })).toBe(true);
  });

  it('recusa pedido sem Origin (KI-064), mesmo com Host local e sem Sec-Fetch-Site', () => {
    expect(isSameOriginRequest({ host: '127.0.0.1:3000', origin: null, secFetchSite: null })).toBe(
      false,
    );
    expect(isSameOriginRequest({ ...local, origin: null })).toBe(false);
    expect(isSameOriginRequest({ ...local, host: null })).toBe(false);
  });

  it('recusa pedido vindo de outro site, mesmo com Host local', () => {
    expect(isSameOriginRequest({ ...local, secFetchSite: 'cross-site' })).toBe(false);
    expect(isSameOriginRequest({ ...local, secFetchSite: 'same-site' })).toBe(false);
    expect(
      isSameOriginRequest({ ...local, origin: 'https://evil.example', secFetchSite: null }),
    ).toBe(false);
    expect(
      isSameOriginRequest({ ...local, origin: 'http://127.0.0.1:4000', secFetchSite: null }),
    ).toBe(false);
    expect(isSameOriginRequest({ ...local, origin: 'null', secFetchSite: null })).toBe(false);
  });
});
