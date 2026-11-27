import { describe, expect, it } from 'vitest';
import {
  createRobotsChecker,
  isAllowed,
  parseRobots,
  robotsPath,
  withinLimits,
} from '../../src/web/robots';
import { PUBLIC_IP, fakeResolver, fakeTransport, reply } from './net-fakes';

const ROBOTS = `
# comentário
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /privado/
Allow: /privado/publico.html
Disallow: /*.pdf$
Disallow: /busca?
Disallow:

User-agent: OutroBot
User-agent: prospector
Disallow: /catalogo
Allow: /catalogo/vitrine
`;

describe('parseRobots + isAllowed (RFC 9309)', () => {
  it('usa o grupo do token prospector quando existe', () => {
    const rules = parseRobots(ROBOTS);
    expect(isAllowed(rules, '/catalogo/itens')).toBe(false);
    expect(isAllowed(rules, '/catalogo/vitrine/1')).toBe(true);
    // As regras de `*` não se somam ao grupo específico.
    expect(isAllowed(rules, '/privado/x')).toBe(true);
  });

  it('cai no grupo * quando não há grupo do token', () => {
    const rules = parseRobots(ROBOTS, 'outro-produto');
    expect(isAllowed(rules, '/privado/x')).toBe(false);
    expect(isAllowed(rules, '/privado/publico.html')).toBe(true);
    expect(isAllowed(rules, '/docs/catalogo.pdf')).toBe(false);
    expect(isAllowed(rules, '/docs/catalogo.pdf?v=2')).toBe(true);
    expect(isAllowed(rules, '/busca?q=1')).toBe(false);
    expect(isAllowed(rules, '/')).toBe(true);
  });

  it('não confunde token parecido nem aceita substring', () => {
    const rules = parseRobots('User-agent: prospectorbot\nDisallow: /\n\nUser-agent: *\nAllow: /');
    expect(isAllowed(rules, '/qualquer')).toBe(true);
    const versioned = parseRobots('User-agent: Prospector/2\nDisallow: /\n');
    expect(isAllowed(versioned, '/qualquer')).toBe(false);
  });

  it('empate de tamanho: allow vence; /robots.txt sempre permitido', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a\nDisallow: /');
    expect(isAllowed(rules, '/a')).toBe(true);
    expect(isAllowed(rules, '/b')).toBe(false);
    expect(isAllowed(rules, '/robots.txt')).toBe(true);
  });

  it('caminho comparado inclui a consulta', () => {
    expect(robotsPath(new URL('https://example.com/busca?q=1#x'))).toBe('/busca?q=1');
    expect(robotsPath(new URL('https://example.com'))).toBe('/');
  });
});

describe('createRobotsChecker', () => {
  const resolver = fakeResolver({
    'a.example.com': [PUBLIC_IP],
    'b.example.com': [PUBLIC_IP],
    'c.example.com': [PUBLIC_IP],
    'd.example.com': [PUBLIC_IP],
  });

  it('2xx aplica regras, 4xx libera, 5xx e rede proíbem tudo', async () => {
    const net = fakeTransport({
      'https://a.example.com/robots.txt': reply(200, 'User-agent: *\nDisallow: /fechado'),
      'https://b.example.com/robots.txt': reply(404),
      'https://c.example.com/robots.txt': reply(503),
    });
    const checker = createRobotsChecker({
      fetchOptions: { resolver, transport: net.transport, timeoutMs: 1000 },
    });
    expect(await checker.allowed(new URL('https://a.example.com/aberto'))).toBe(true);
    expect(await checker.allowed(new URL('https://a.example.com/fechado/1'))).toBe(false);
    expect(await checker.allowed(new URL('https://b.example.com/tudo'))).toBe(true);
    expect(await checker.allowed(new URL('https://c.example.com/'))).toBe(false);
    // Sem DNS para o host: inacessível = proibido.
    expect(await checker.allowed(new URL('https://sem-dns.example.com/'))).toBe(false);
  });

  it('guarda por origem e renova depois do prazo (no máximo 24 h)', async () => {
    let now = 0;
    const net = fakeTransport({
      'https://d.example.com/robots.txt': reply(200, 'User-agent: *\nDisallow: /x'),
    });
    const checker = createRobotsChecker({
      fetchOptions: { resolver, transport: net.transport, timeoutMs: 1000 },
      now: () => now,
      ttlMs: 7 * 24 * 60 * 60 * 1000,
    });
    await checker.allowed(new URL('https://d.example.com/1'));
    await checker.allowed(new URL('https://d.example.com/2'));
    expect(net.calls).toHaveLength(1);
    now = 24 * 60 * 60 * 1000;
    await checker.allowed(new URL('https://d.example.com/3'));
    expect(net.calls).toHaveLength(2);
  });
});

describe('robots.txt hostil (tempo previsível)', () => {
  it('muitos curingas contra caminho longo terminam rápido', () => {
    const rules = parseRobots(`User-agent: *\nDisallow: /${'*a'.repeat(40)}*b\n`);
    const path = `/${'a'.repeat(2000)}`;
    const started = performance.now();
    expect(isAllowed(rules, path)).toBe(true);
    expect(performance.now() - started).toBeLessThan(200);
  });

  it('`**` vale um `*`; padrão sem `$` é prefixo; com `$`, fim exato', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /a**b\nDisallow: /fim.html$\n');
    expect(rules[0]?.pattern).toBe('/a*b');
    expect(isAllowed(rules, '/a/x/b/resto')).toBe(false);
    expect(isAllowed(rules, '/fim.html')).toBe(false);
    expect(isAllowed(rules, '/fim.html?x=1')).toBe(true);
  });

  it('arquivo acima dos limites vale como tudo proibido; caminho enorme não é lido', () => {
    expect(withinLimits(parseRobots(`User-agent: *\n${'Disallow: /x\n'.repeat(2001)}`))).toBe(
      false,
    );
    expect(withinLimits(parseRobots(`User-agent: *\nDisallow: /${'y'.repeat(600)}\n`))).toBe(false);
    expect(withinLimits(parseRobots('User-agent: *\nDisallow: /privado/\n'))).toBe(true);
    expect(isAllowed([], `/${'z'.repeat(3000)}`)).toBe(false);
  });
});
