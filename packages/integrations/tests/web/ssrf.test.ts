import { describe, expect, it } from 'vitest';
import { checkUrl, isPublicAddress, resolvePublicTarget } from '../../src/web/ssrf';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '100.100.100.200',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '198.18.0.1',
    '192.0.2.10',
    '::1',
    '::',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    'fe80::1%eth0',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::ffff:169.254.169.254',
    '64:ff9b::a9fe:a9fe',
    '2002:7f00:1::1',
    '2001:db8::1',
    '2001::1',
    'não é ip',
  ])('bloqueia %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(false);
  });

  it.each([
    '8.8.8.8',
    '93.184.215.14',
    '172.32.0.1',
    '100.128.0.1',
    '2606:4700:4700::1111',
    '[2606:4700:4700::1111]',
    '::ffff:8.8.8.8',
    '2002:0808:0808::1',
  ])('aceita %s', (ip) => {
    expect(isPublicAddress(ip)).toBe(true);
  });
});

describe('checkUrl', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://arquivos.example.com/',
    'javascript:alert(1)',
    'data:text/html,oi',
    'http://usuario:senha@example.com/',
    'http://example.com:8080/',
    'https://example.com:22/',
    'http://localhost/',
    'http://localhost.:3000/',
    'http://api.localhost/',
    'http://intranet/',
    'http://impressora.local/',
    'http://metadata.google.internal/',
    'http://roteador.home.arpa/',
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/',
    'http://0x7f.1/',
    'http://169.254.169.254/latest/meta-data/',
    'não é url',
  ])('recusa %s', (raw) => {
    expect(checkUrl(raw).ok).toBe(false);
  });

  it.each([
    'https://www.example.com/a?b=1',
    'http://example.com:80/',
    'https://example.com:443/',
    'http://example.com:443/',
    'https://8.8.8.8/',
    'https://[2606:4700:4700::1111]/',
  ])('aceita %s', (raw) => {
    expect(checkUrl(raw).ok).toBe(true);
  });
});

describe('resolvePublicTarget', () => {
  const url = new URL('https://empresa.example.com/');

  it('recusa quando QUALQUER resposta do DNS é interna', async () => {
    const result = await resolvePublicTarget(url, async () => ['93.184.215.14', '10.0.0.1']);
    expect(result).toEqual({ ok: false, reason: 'blocked_address' });
  });

  it('prefere IPv4 entre endereços públicos', async () => {
    const result = await resolvePublicTarget(url, async () => ['2606:4700::1', '93.184.215.14']);
    expect(result).toEqual({ ok: true, address: '93.184.215.14', family: 4 });
  });

  it('usa IPv6 quando é o único', async () => {
    const result = await resolvePublicTarget(url, async () => ['2606:4700::1']);
    expect(result).toEqual({ ok: true, address: '2606:4700::1', family: 6 });
  });

  it('falha de DNS ou resposta vazia = indisponível', async () => {
    await expect(
      resolvePublicTarget(url, async () => {
        throw new Error('ENOTFOUND');
      }),
    ).resolves.toEqual({ ok: false, reason: 'unavailable' });
    await expect(resolvePublicTarget(url, async () => [])).resolves.toEqual({
      ok: false,
      reason: 'unavailable',
    });
  });

  it('IP literal não passa pelo DNS', async () => {
    const result = await resolvePublicTarget(new URL('https://8.8.8.8/'), async () => {
      throw new Error('não deveria resolver');
    });
    expect(result).toEqual({ ok: true, address: '8.8.8.8', family: 4 });
  });
});
