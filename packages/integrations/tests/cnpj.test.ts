import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createCnpjLookup, minhaReceita, openCnpj } from '../src';
import { capitalCents, cnae, registryStatus, stripCpf } from '../src/cnpj/normalize';

/** Fixtures SINTÉTICOS com a estrutura das respostas reais (tests/fixtures/README.md). */
function fixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
}

function respond(status: number, body?: unknown): Response {
  return new Response(body === undefined ? '' : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** fetch falso que responde por host e registra os endereços pedidos. */
function fakeFetch(routes: Record<string, () => Response | Promise<Response>>) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const host = new URL(url).host;
    const route = routes[host];
    if (!route) throw new TypeError('fetch failed');
    return route();
  });
  return { fetch: impl as unknown as typeof fetch, calls };
}

const options = (fetch: typeof globalThis.fetch) => ({ fetch, timeoutMs: 1000 });

describe('normalização', () => {
  it('tira o CPF do nome do MEI, com ou sem pontuação', () => {
    expect(stripCpf('MARIA EXEMPLO 12345678909')).toBe('MARIA EXEMPLO');
    expect(stripCpf('JOAO EXEMPLO 123.456.789-09 ME')).toBe('JOAO EXEMPLO ME');
    expect(stripCpf('ATELIE EXEMPLO LTDA')).toBe('ATELIE EXEMPLO LTDA');
    // Colado ao nome também sai; número maior (como um CNPJ) não é confundido com CPF.
    expect(stripCpf('MARIA EXEMPLO12345678909')).toBe('MARIA EXEMPLO');
    expect(stripCpf('LOJA 11222333000181')).toBe('LOJA 11222333000181');
  });

  it('CNAE vira 7 dígitos (a Minha Receita perde o zero à esquerda)', () => {
    expect(cnae(600001)).toBe('0600001');
    expect(cnae('0600001')).toBe('0600001');
    expect(cnae(0)).toBeNull();
    expect(cnae('')).toBeNull();
  });

  it('capital em texto com vírgula ou número em reais vira centavos', () => {
    expect(capitalCents('205431960490,52')).toBe(20543196049052);
    expect(capitalCents('1.000,00')).toBe(100000);
    expect(capitalCents(50000.5)).toBe(5000050);
    expect(capitalCents('')).toBeNull();
  });

  it('situação cadastral por nome ou código', () => {
    expect(registryStatus('Ativa')).toBe('active');
    expect(registryStatus('BAIXADA')).toBe('closed');
    expect(registryStatus(4)).toBe('unfit');
    expect(registryStatus(99)).toBeNull();
  });
});

describe('OpenCNPJ', () => {
  it('lê a empresa e descarta sócios, e-mail, telefones e endereço de rua', async () => {
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () => respond(200, fixture('opencnpj-empresa')),
    });
    const result = await openCnpj.fetchRecord('11222333000181', options(fetch));
    expect(calls).toEqual(['https://api.opencnpj.org/11222333000181']);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record).toEqual({
      schemaVersion: 1,
      provider: 'opencnpj',
      cnpj: '11222333000181',
      legalName: 'ATELIE EXEMPLO DE MARCENARIA LTDA',
      tradeName: 'ATELIE EXEMPLO',
      status: 'active',
      statusSince: '2015-03-10',
      headquarters: true,
      activityStart: '2015-03-10',
      cnaeMain: {
        code: '3101-2/00',
        description: 'Fabricação de móveis com predominância de madeira',
      },
      cnaeSecondary: ['4754-7/01'],
      legalNature: 'Sociedade Empresária Limitada',
      legalNatureCode: '2062',
      size: 'epp',
      isMei: false,
      simples: true,
      capitalCents: 15000000,
      city: 'CURITIBA',
      uf: 'PR',
      providerUpdatedAt: '2026-11-01T21:47:27.195Z',
    });
    const serialized = JSON.stringify(result.record);
    for (const personal of ['SOCIA EXEMPLO', 'contato@', 'DAS EXEMPLO', '80000000', '00000000']) {
      expect(serialized).not.toContain(personal);
    }
  });

  it('MEI: sem CPF no nome, porte ME e marcado como MEI', async () => {
    const { fetch } = fakeFetch({
      'api.opencnpj.org': () => respond(200, fixture('opencnpj-mei')),
    });
    const result = await openCnpj.fetchRecord('44555666000181', options(fetch));
    expect(result.ok && result.record).toMatchObject({
      legalName: 'MARIA EXEMPLO',
      tradeName: null,
      status: 'closed',
      isMei: true,
      size: 'me',
    });
    expect(JSON.stringify(result)).not.toMatch(/12345678909|maria\.exemplo/);
  });

  it('aceita CNPJ alfanumérico e campos vazios ou malformados', async () => {
    const { fetch } = fakeFetch({
      'api.opencnpj.org': () => respond(200, fixture('opencnpj-alfanumerico')),
    });
    const result = await openCnpj.fetchRecord('12ABC34501DE35', options(fetch));
    expect(result.ok && result.record).toMatchObject({
      cnpj: '12ABC34501DE35',
      headquarters: false,
      tradeName: null,
      capitalCents: null,
      simples: null,
      providerUpdatedAt: null,
    });
  });

  it('404 é "não existe"; 429 é pausa; 5xx e rede são "fora do ar"', async () => {
    for (const [status, failure] of [
      [404, 'not_found'],
      [429, 'rate_limited'],
      [503, 'unavailable'],
    ] as const) {
      const { fetch } = fakeFetch({ 'api.opencnpj.org': () => respond(status, { error: 'x' }) });
      expect(await openCnpj.fetchRecord('11222333000181', options(fetch))).toEqual({
        ok: false,
        failure,
      });
    }
    const offline = fakeFetch({});
    expect(await openCnpj.fetchRecord('11222333000181', options(offline.fetch))).toEqual({
      ok: false,
      failure: 'unavailable',
    });
  });

  it('resposta fora do formato não vira registro', async () => {
    const { fetch } = fakeFetch({
      'api.opencnpj.org': () => respond(200, { cnpj: '11222333000181', razao_social: '' }),
    });
    expect(await openCnpj.fetchRecord('11222333000181', options(fetch))).toEqual({
      ok: false,
      failure: 'invalid_response',
    });
  });
});

describe('Minha Receita', () => {
  it('lê códigos numéricos e descarta sócios e contatos', async () => {
    const { fetch } = fakeFetch({
      'minhareceita.org': () => respond(200, fixture('minhareceita-empresa')),
    });
    const result = await minhaReceita.fetchRecord('77888999000181', options(fetch));
    expect(result.ok && result.record).toMatchObject({
      provider: 'minhareceita',
      legalName: 'CLINICA EXEMPLO ODONTOLOGIA LTDA',
      status: 'active',
      headquarters: true,
      cnaeMain: { code: '8630-5/04', description: 'Atividade odontológica' },
      cnaeSecondary: ['8630-5/06'],
      size: 'me',
      simples: true,
      capitalCents: 5000050,
      city: 'BELO HORIZONTE',
      uf: 'MG',
    });
    expect(JSON.stringify(result)).not.toMatch(/SOCIO EXEMPLO|financeiro@|SAVASSI/);
  });

  it('400 (CNPJ fora da base) é "não existe"', async () => {
    const { fetch } = fakeFetch({ 'minhareceita.org': () => respond(400, { message: 'x' }) });
    expect(await minhaReceita.fetchRecord('77888999000181', options(fetch))).toEqual({
      ok: false,
      failure: 'not_found',
    });
  });
});

describe('consulta com reserva e cache', () => {
  it('usa a Minha Receita quando a OpenCNPJ está fora do ar', async () => {
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () => respond(503),
      'minhareceita.org': () => respond(200, fixture('minhareceita-empresa')),
    });
    const result = await createCnpjLookup({ fetch, cacheTtlMs: 0 }).lookup('77.888.999/0001-81');
    expect(result.ok && result.record.provider).toBe('minhareceita');
    expect(calls).toHaveLength(2);
  });

  it('"não existe" não passa para a reserva (mesma base)', async () => {
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () => respond(404),
      'minhareceita.org': () => respond(200, fixture('minhareceita-empresa')),
    });
    const result = await createCnpjLookup({ fetch }).lookup('11222333000181');
    expect(result).toEqual({ ok: false, failure: 'not_found', provider: 'opencnpj' });
    expect(calls).toHaveLength(1);
  });

  it('os dois fora do ar: devolve o motivo do último', async () => {
    const { fetch } = fakeFetch({
      'api.opencnpj.org': () => respond(503),
      'minhareceita.org': () => respond(429),
    });
    expect(await createCnpjLookup({ fetch }).lookup('11222333000181')).toEqual({
      ok: false,
      failure: 'rate_limited',
      provider: 'minhareceita',
    });
  });

  it('CNPJ inválido não chama ninguém', async () => {
    const { fetch, calls } = fakeFetch({});
    for (const cnpj of ['11222333000182', '00000000000000', 'abc', '../../etc']) {
      expect(await createCnpjLookup({ fetch }).lookup(cnpj)).toEqual({
        ok: false,
        failure: 'not_found',
        provider: null,
      });
    }
    expect(calls).toHaveLength(0);
  });

  it('guarda sucesso e "não existe" em cache; falha temporária não', async () => {
    let now = 0;
    let status = 503;
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () =>
        status === 200 ? respond(200, fixture('opencnpj-empresa')) : respond(status),
      'minhareceita.org': () => respond(503),
    });
    const lookup = createCnpjLookup({ fetch, now: () => now, cacheTtlMs: 1000 });
    expect((await lookup.lookup('11222333000181')).ok).toBe(false);
    status = 200;
    expect((await lookup.lookup('11222333000181')).ok).toBe(true);
    const before = calls.length;
    expect((await lookup.lookup('11.222.333/0001-81')).ok).toBe(true);
    expect(calls).toHaveLength(before);
    now = 2000;
    await lookup.lookup('11222333000181');
    expect(calls.length).toBeGreaterThan(before);
  });

  it('cancelamento de quem pediu sobe como erro', async () => {
    const controller = new AbortController();
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      controller.abort();
      throw init?.signal?.reason ?? new Error('aborted');
    }) as unknown as typeof globalThis.fetch;
    await expect(
      createCnpjLookup({ fetch }).lookup('11222333000181', { signal: controller.signal }),
    ).rejects.toBeDefined();
  });
});

describe('defesas da consulta (revisão de segurança e LGPD do M2)', () => {
  it('registro de outro CNPJ conta como resposta inválida e vai para a reserva', async () => {
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () => respond(200, fixture('opencnpj-empresa')),
      'minhareceita.org': () => respond(200, { ...(fixture('minhareceita-empresa') as object) }),
    });
    const result = await createCnpjLookup({ fetch, cacheTtlMs: 0 }).lookup('77888999000181');
    expect(result.ok && result.record.provider).toBe('minhareceita');
    expect(result.ok && result.record.cnpj).toBe('77888999000181');
    expect(calls).toHaveLength(2);
  });

  it('pedido de anonimização (LGPD) não usa a reserva e não guarda nada', async () => {
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () =>
        respond(200, { cnpj: '11222333000181', razao_social: '', lgpd_anonimizado: true }),
      'minhareceita.org': () => respond(200, fixture('minhareceita-empresa')),
    });
    expect(await createCnpjLookup({ fetch }).lookup('11222333000181')).toEqual({
      ok: false,
      failure: 'anonymized',
      provider: 'opencnpj',
    });
    expect(calls).toHaveLength(1);
  });

  it('nome fantasia do MEI também perde o CPF', async () => {
    const mei = {
      ...(fixture('opencnpj-mei') as object),
      nome_fantasia: 'MARIA EXEMPLO 12345678909',
    };
    const { fetch } = fakeFetch({ 'api.opencnpj.org': () => respond(200, mei) });
    const result = await openCnpj.fetchRecord('44555666000181', options(fetch));
    expect(result.ok && result.record.tradeName).toBe('MARIA EXEMPLO');
    expect(JSON.stringify(result)).not.toMatch(/12345678909/);
  });

  it('o resultado traz a hora da coleta; o cache mantém a hora original e `fresh` o ignora', async () => {
    let now = Date.parse('2026-11-10T12:00:00Z');
    const { fetch, calls } = fakeFetch({
      'api.opencnpj.org': () => respond(200, fixture('opencnpj-empresa')),
    });
    const lookup = createCnpjLookup({ fetch, now: () => now });
    const first = await lookup.lookup('11222333000181');
    expect(first.ok && first.fetchedAt).toBe('2026-11-10T12:00:00.000Z');
    now += 60_000;
    const cached = await lookup.lookup('11222333000181');
    expect(cached.ok && cached.fetchedAt).toBe('2026-11-10T12:00:00.000Z');
    expect(calls).toHaveLength(1);
    const fresh = await lookup.lookup('11222333000181', { fresh: true });
    expect(fresh.ok && fresh.fetchedAt).toBe('2026-11-10T12:01:00.000Z');
    expect(calls).toHaveLength(2);
  });

  it('resposta grande demais ou fora de JSON é recusada sem ler tudo', async () => {
    const huge = () =>
      new Response('x'.repeat(300 * 1024), { headers: { 'content-type': 'application/json' } });
    const html = () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } });
    for (const route of [huge, html]) {
      const { fetch } = fakeFetch({ 'api.opencnpj.org': route });
      expect(await openCnpj.fetchRecord('11222333000181', options(fetch))).toEqual({
        ok: false,
        failure: 'invalid_response',
      });
    }
  });
});
