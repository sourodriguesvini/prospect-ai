import { createHash } from 'node:crypto';
import type {
  AnalysisAgent,
  BrandMetrics,
  CaptureViewport,
  CnpjRegistryRecord,
  StrategySnapshot,
  WebPage,
  WebSearchRequest,
  WebSearchResult,
} from '@prospector/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createCompanyService,
  createEvidenceService,
  createInvestigationService,
  createToolRegistry,
  createWebResearchService,
  investigationTools,
  type AnalysisInputs,
  type AnalysisOutputs,
  type AnalysisResult,
  type BrandAnalysisAi,
  type BrandCapturer,
  type NewLlmCall,
  type CompanyService,
  type InvestigationDeps,
  type InvestigationService,
  type PageFetcher,
  type RequestContext,
  type WebResearchService,
  type WebSearch,
} from '../src';
import {
  createMemoryAuditRepository,
  createMemoryCaptureStore,
  createMemoryCompanyRepository,
  createMemoryInvestigationRepository,
} from '../src/memory';
import { signalCodes } from '../src/services/investigation/collect';

describe('signalCodes (sinais recentes, hipóteses a conferir)', () => {
  it('aniversário só da empresa; prêmio sem confundir com "premium"', () => {
    expect(signalCodes('Ateliê Exemplo celebra 20 anos de história em Curitiba')).toEqual([
      'anniversary',
    ]);
    expect(signalCodes('Aniversário da loja tem descontos')).toEqual(['anniversary']);
    // Idade de pessoa e aniversário de alguém não são sinal da empresa.
    expect(signalCodes('Fundador, 45 anos de idade, fala sobre o setor')).toEqual([]);
    expect(signalCodes('Aniversário do sócio reúne amigos')).toEqual([]);
    expect(signalCodes('Marcenaria recebe prêmio de design')).toEqual(['award']);
    expect(signalCodes('Conheça a linha premium de cozinhas')).toEqual([]);
  });
});
import { createMemoryWebResearchUsage } from '../src/memory/web-research-usage';

/**
 * Investigação de ponta a ponta com fakes SINTÉTICOS (domínios .test reservados, CNPJ de teste,
 * nenhuma empresa real): pesquisa, leitor de páginas, captura e IA local simulados. O que se
 * confere aqui é o comportamento do serviço: o ledger só recebe o que tem suporte, a execução é
 * retomável, cancelável e reaproveita o que não mudou.
 */

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
};

const RECORD: CnpjRegistryRecord = {
  schemaVersion: 1,
  provider: 'opencnpj',
  cnpj: '11222333000181',
  legalName: 'ATELIE EXEMPLO DE MARCENARIA LTDA',
  tradeName: 'ATELIE EXEMPLO',
  status: 'active',
  statusSince: '2015-03-10',
  headquarters: true,
  activityStart: '2015-03-10',
  cnaeMain: { code: '3101-2/00', description: 'Fabricação de móveis com predominância de madeira' },
  cnaeSecondary: [],
  legalNature: 'Sociedade Empresária Limitada',
  legalNatureCode: '2062',
  size: 'epp',
  isMei: false,
  simples: true,
  capitalCents: 15000000,
  city: 'CURITIBA',
  uf: 'PR',
  providerUpdatedAt: '2026-11-01T21:47:27.195Z',
};

const OFFER_ID = '0b9f6c4e-1d2a-4c3b-8e5f-6a7b8c9d0e1f';
const OFFER_VERSION_ID = '1c0a7d5f-2e3b-4d4c-9f6a-7b8c9d0e1f2a';
const ICP_ID = '2d1b8e6a-3f4c-4e5d-8a7b-8c9d0e1f2a3b';
const ICP_VERSION_ID = '3e2c9f7b-4a5d-4f6e-9b8c-9d0e1f2a3b4c';

const STRATEGY: StrategySnapshot = {
  offers: [
    {
      id: OFFER_ID,
      status: 'active',
      isDemo: true,
      createdAt: '2026-11-01T12:00:00.000Z',
      updatedAt: '2026-11-01T12:00:00.000Z',
      current: {
        id: OFFER_VERSION_ID,
        offerId: OFFER_ID,
        version: 1,
        createdAt: '2026-11-01T12:00:00.000Z',
        content: {
          name: 'Revisão de marca',
          description: 'Oferta de exemplo.',
          problems: ['Marca que não comunica o diferencial', 'Site ruim no celular'],
          needSignals: ['Expansão ou nova unidade'],
          disqualifiers: ['Rebranding recente', 'Empresa é filial ou franquia'],
          deliverables: ['Diagnóstico'],
          valueProps: ['Clareza'],
          priceMinCents: null,
          priceMaxCents: null,
        },
      },
    },
  ],
  rubrics: [],
  scoringModels: [],
  icps: [
    {
      id: ICP_ID,
      offerId: OFFER_ID,
      status: 'active',
      isDemo: true,
      createdAt: '2026-11-01T12:00:00.000Z',
      updatedAt: '2026-11-01T12:00:00.000Z',
      current: {
        id: ICP_VERSION_ID,
        icpId: ICP_ID,
        version: 1,
        createdAt: '2026-11-01T12:00:00.000Z',
        content: {
          name: 'Marcenarias do Paraná',
          description: '',
          filters: {
            cnaes: ['3101-2/00'],
            ufs: ['PR'],
            municipalities: [],
            sizes: ['me', 'epp'],
            minAgeYears: 3,
            maxAgeYears: null,
          },
          exclusions: { cnaes: [], municipalities: [], cnpjRoots: [], domains: [] },
        },
      },
    },
  ],
  voiceGuide: null,
  contactPolicy: null,
  liaVersions: [],
  proofAssets: [],
};

// -----------------------------------------------------------------------------
// Fakes
// -----------------------------------------------------------------------------

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

interface FakePage {
  title: string;
  text: string;
  links?: Array<{ url: string; text: string }>;
}

function sitePages(): Record<string, FakePage> {
  return {
    'https://atelie-exemplo.test/': {
      title: 'Ateliê Exemplo | Móveis sob medida',
      text: 'Ateliê Exemplo\n\nMóveis planejados sob medida para apartamentos em Curitiba.\nProjetos de cozinhas, dormitórios e home office.\nAtendemos Curitiba e região metropolitana.\nAgende uma visita.',
      links: [
        { url: 'https://atelie-exemplo.test/sobre', text: 'Sobre nós' },
        { url: 'https://atelie-exemplo.test/servicos', text: 'Serviços' },
        { url: 'https://atelie-exemplo.test/politica-de-privacidade', text: 'Privacidade' },
        { url: 'https://instagram.example.test/atelie', text: 'Instagram' },
      ],
    },
    'https://atelie-exemplo.test/sobre': {
      title: 'Sobre | Ateliê Exemplo',
      text: 'Desde 2015 criamos móveis com madeira certificada e acabamento artesanal.',
    },
    'https://atelie-exemplo.test/servicos': {
      title: 'Serviços | Ateliê Exemplo',
      text: 'Cozinhas planejadas. Dormitórios. Home office. Painéis.',
    },
    'https://moveis-rival.test/': {
      title: 'Móveis Rival — marcenaria em Curitiba',
      text: 'Móveis sob medida em Curitiba há 20 anos. Orçamento sem compromisso.',
    },
  };
}

function fakeReader(pages: Record<string, FakePage>) {
  const calls: string[] = [];
  const fetcher: PageFetcher = {
    async fetchPage(url) {
      calls.push(url);
      const found = pages[url];
      if (!found) return { ok: false, failure: 'not_found', httpStatus: 404 };
      const page: WebPage = {
        schemaVersion: 1,
        requestedUrl: url,
        url,
        httpStatus: 200,
        contentType: 'text/html',
        title: found.title,
        description: null,
        lang: 'pt-BR',
        text: found.text,
        truncated: false,
        contentHash: sha(found.text),
        fetchedAt: '2026-11-10T12:00:00.000Z',
        renderer: 'http',
        links: found.links ?? [],
        noArchive: false,
      };
      return { ok: true, page };
    },
  };
  return { fetcher, calls };
}

function result(
  rank: number,
  url: string,
  title: string,
  snippet: string,
  publishedAt: string | null = null,
): WebSearchResult {
  return { rank, url, title, snippet, publishedAt, score: 0.9 - rank / 10 };
}

function fakeSearch() {
  const calls: WebSearchRequest[] = [];
  const search: WebSearch = {
    provider: 'tavily',
    creditsPerSearch: 1,
    async search(request) {
      calls.push(request);
      const { query } = request;
      let results: WebSearchResult[];
      if (query.startsWith('"')) {
        results = [
          result(
            1,
            'https://jornal-exemplo.test/noticias/atelie-exemplo-inaugura',
            'Ateliê Exemplo inaugura nova unidade no Batel',
            'A marcenaria Ateliê Exemplo abre as portas da nova unidade.',
            '2026-10-20',
          ),
          result(
            2,
            'https://guia-exemplo.test/atelie-exemplo',
            'Ateliê Exemplo — guia de empresas',
            'Telefone e endereço.',
          ),
        ];
      } else if (query.includes(' em ')) {
        results = [
          result(
            1,
            'https://moveis-rival.test/',
            'Móveis Rival — marcenaria em Curitiba',
            'Móveis sob medida em Curitiba.',
          ),
          result(2, 'https://colchoes-exemplo.test/', 'Colchões Exemplo', 'Loja de colchões.'),
          result(3, 'https://atelie-exemplo.test/', 'Ateliê Exemplo', 'Móveis sob medida.'),
          result(
            4,
            'https://www.instagram.com/moveisrival',
            'Móveis Rival (@moveisrival)',
            'Fotos',
          ),
        ];
      } else {
        results = [
          result(
            1,
            'https://atelie-exemplo.test/',
            'Ateliê Exemplo | Móveis sob medida',
            'Marcenaria em Curitiba.',
          ),
          result(2, 'https://www.facebook.com/atelieexemplo', 'Ateliê Exemplo', 'Página'),
        ];
      }
      return { ok: true, results, creditsCharged: 1 };
    },
  };
  return { search, calls };
}

function metrics(viewport: CaptureViewport): BrandMetrics {
  return {
    viewport,
    pageWidth: viewport === 'desktop' ? 1280 : 420,
    pageHeight: 2400,
    title: 'Ateliê Exemplo | Móveis sob medida',
    hasViewportMeta: true,
    horizontalOverflow: viewport === 'mobile',
    fonts: ['Montserrat', 'Arial'],
    textColors: ['#222222'],
    backgroundColors: ['#FFFFFF'],
    accentColors: ['#C0392B'],
    h1Count: 1,
    h1Text: 'Móveis sob medida',
    imageCount: 12,
    imagesWithoutAlt: 5,
    ctaTexts: ['Agende uma visita'],
    navLinkCount: 6,
    smallTapTargets: viewport === 'mobile' ? 7 : 0,
    lowContrastTexts: 2,
    contrastSamples: 40,
    smallTextPercent: 5,
    hasFavicon: true,
    hasOgImage: false,
    logo: { found: true, width: 160, height: 48, format: 'raster' },
    forms: 1,
    domContentLoadedMs: 900,
    transferredBytes: 1_500_000,
  };
}

function fakeCapturer() {
  const calls: Array<{ url: string; viewport: CaptureViewport }> = [];
  const capturer: BrandCapturer = {
    async capture(url, viewport) {
      calls.push({ url, viewport });
      const bytes = new Uint8Array([0xff, 0xd8, viewport === 'desktop' ? 1 : 2, 0xff, 0xd9]);
      return {
        ok: true,
        capture: {
          viewport,
          url,
          capturedAt: '2026-11-10T12:00:00.000Z',
          image: {
            bytes,
            mime: 'image/jpeg',
            width: viewport === 'desktop' ? 1280 : 390,
            height: 2400,
            sha256: sha(`imagem-${viewport}`),
          },
          metrics: metrics(viewport),
        },
      };
    },
  };
  return { capturer, calls };
}

type Handlers = { [A in AnalysisAgent]: (input: AnalysisInputs[A]) => AnalysisOutputs[A] };

const ref = (
  list: ReadonlyArray<{ ref: string; text: string }>,
  match: (text: string) => boolean,
) => list.find((item) => match(item.text))?.ref;

function defaultHandlers(): Handlers {
  return {
    'company-business': (input) => {
      const home = input.pages[0]?.ref ?? 'P1';
      const about = input.pages.find((page) => page.category === 'about')?.ref ?? 'P2';
      return {
        offerings: [
          {
            label: 'Móveis sob medida',
            page: home,
            quote: 'Móveis planejados sob medida para apartamentos',
          },
          {
            label: 'Cozinhas planejadas',
            page: home,
            quote: 'projetos de cozinhas, dormitórios e home office',
          },
          // Trecho inventado: não está na página.
          {
            label: 'Reformas completas',
            page: home,
            quote: 'Fazemos reformas completas de imóveis',
          },
        ],
        audiences: [
          { label: 'Moradores de apartamento', page: home, quote: 'para apartamentos em Curitiba' },
        ],
        differentiators: [
          { label: 'Madeira certificada', page: about, quote: 'madeira certificada' },
        ],
        regions: [
          {
            label: 'Curitiba e região metropolitana',
            page: home,
            quote: 'Atendemos Curitiba e região metropolitana',
          },
        ],
        signals: [],
        valueProposition: {
          statement: 'Promete móveis sob medida para quem mora em apartamento.',
          reasoning: 'A página inicial repete "sob medida" e fala de apartamentos.',
          factor: 0.7,
          basedOn: ['O1', 'A1'],
        },
        toneOfVoice: {
          statement: 'O tom é direto e acolhedor.',
          reasoning: 'Frases curtas e convite para visita.',
          factor: 0.6,
          basedOn: [],
        },
        businessModel: null,
      };
    },
    'brand-visual': (input) => ({
      criteria: [
        {
          criterion: 'clareza_proposta',
          score: 2,
          observation: 'O título principal não diz o que a empresa faz de diferente.',
          nature: 'strategic',
          images: ['desktop'],
          metrics: input.metrics.slice(0, 1).map((item) => item.ref),
          factor: 0.7,
        },
        {
          criterion: 'experiencia_celular',
          score: 2,
          observation: 'No celular a página rola para o lado e os botões são pequenos.',
          nature: 'functional',
          images: ['mobile'],
          metrics: [],
          factor: 0.7,
        },
        {
          criterion: 'criterio_inventado',
          score: 5,
          observation: 'Fora da rubrica.',
          nature: 'aesthetic',
          images: [],
          metrics: [],
          factor: 0.5,
        },
      ],
      positioning: {
        statement: 'A marca comunica marcenaria tradicional, sem destaque para o diferencial.',
        reasoning: 'Paleta escura e fotos de oficina.',
        factor: 0.6,
        basedOn: input.context.slice(0, 1).map((item) => item.ref),
      },
    }),
    'competitor-triage': (input) => ({
      candidates: [
        ...input.candidates.map((candidate) => ({
          ref: candidate.ref,
          kind:
            candidate.domain === 'moveis-rival.test' ? ('direct' as const) : ('unrelated' as const),
          reason:
            candidate.domain === 'moveis-rival.test'
              ? 'Marcenaria sob medida na mesma cidade.'
              : 'Outro ramo.',
        })),
        { ref: 'C9', kind: 'direct' as const, reason: 'Candidato inventado.' },
      ],
    }),
    competitive: (input) => ({
      findings: [
        {
          kind: 'excessive_similarity',
          statement: 'A empresa e o concorrente usam a mesma promessa de móveis sob medida.',
          reasoning: 'Os dois sites abrem com "sob medida".',
          factor: 0.6,
          basedOn: [input.facts[0]?.ref, input.competitors[0]?.ref].filter((item): item is string =>
            Boolean(item),
          ),
        },
      ],
    }),
    diagnosis: (input) => {
      const fact = input.facts.find((item) => item.type === 'fact')?.ref;
      const audit = ref(input.facts, (text) => text.startsWith('Experiência no celular'));
      const signal = ref(input.facts, (text) => text.includes('expansão'));
      const basedOn = [fact, audit].filter((item): item is string => Boolean(item));
      return {
        summary: {
          statement:
            'Marcenaria estabelecida cuja marca não mostra o diferencial da madeira certificada.',
          reasoning:
            'O site cita a madeira certificada só na página Sobre e a auditoria apontou problemas no celular.',
          factor: 0.7,
          basedOn,
        },
        hypotheses: [
          {
            statement: 'A nova unidade pode ser um bom momento para revisar a marca.',
            reasoning: 'Notícia de inauguração ainda a confirmar.',
            basedOn: signal ? [signal] : [],
          },
        ],
        offers: input.offers.map((offer) => ({
          offer: offer.ref,
          relevance: 'strong' as const,
          statement:
            'Os problemas da marca no celular e a proposta pouco clara combinam com a oferta.',
          reasoning:
            'A auditoria apontou problemas funcionais e estratégicos ligados aos problemas da oferta.',
          factor: 0.7,
          basedOn,
          openingAngle: 'Mostrar como a madeira certificada pode virar o centro da marca.',
          objections: ['Pode achar que só o site resolve.'],
          toVerify: ['Quem decide sobre a marca.'],
          problemsMatched: [1, 2, 9],
          signalsMatched: [],
          disqualifiersHit: [],
        })),
      };
    },
  };
}

function fakeAi(handlers: Partial<Handlers> = {}) {
  const calls: AnalysisAgent[] = [];
  const all = { ...defaultHandlers(), ...handlers };
  let gate: { agent: AnalysisAgent; promise: Promise<void> } | null = null;
  let unavailable = false;
  const ai: BrandAnalysisAi = {
    async analyze(agent, input, options) {
      calls.push(agent);
      if (gate?.agent === agent) {
        const signal = options?.signal;
        await Promise.race([
          gate.promise,
          new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve())),
        ]);
        signal?.throwIfAborted();
      }
      if (unavailable) {
        return {
          ok: false,
          code: 'runtime_unavailable',
          model: null,
          promptVersion: `${agent}/v1`,
          durationMs: 1,
        } as AnalysisResult<typeof agent>;
      }
      const handler = all[agent] as unknown as (
        value: typeof input,
      ) => AnalysisOutputs[typeof agent];
      return {
        ok: true,
        output: handler(input),
        model: 'qwen3.5:4b',
        promptVersion: `${agent}/v1`,
        durationMs: 1200,
      } as AnalysisResult<typeof agent>;
    },
  };
  return {
    ai,
    calls,
    /** Segura a próxima chamada deste agente até `release` (ou até o cancelamento). */
    hold(agent: AnalysisAgent) {
      let release!: () => void;
      gate = { agent, promise: new Promise<void>((resolve) => (release = resolve)) };
      return () => {
        gate = null;
        release();
      };
    },
    setUnavailable: (value: boolean) => (unavailable = value),
  };
}

// -----------------------------------------------------------------------------
// Montagem
// -----------------------------------------------------------------------------

describe('InvestigationService (ADR-0015)', () => {
  let now: Date;
  const clock = { now: () => now };
  let audit: ReturnType<typeof createMemoryAuditRepository>;
  let repo: ReturnType<typeof createMemoryCompanyRepository>;
  let investigations: ReturnType<typeof createMemoryInvestigationRepository>;
  let captureStore: ReturnType<typeof createMemoryCaptureStore>;
  let companies: CompanyService;
  let pages: Record<string, FakePage>;
  let reader: ReturnType<typeof fakeReader>;
  let search: ReturnType<typeof fakeSearch>;
  let capture: ReturnType<typeof fakeCapturer>;
  let ai: ReturnType<typeof fakeAi>;
  let web: WebResearchService;
  let logs: string[];

  function deps(overrides: Partial<InvestigationDeps> = {}): InvestigationDeps {
    const evidenceService = createEvidenceService({ evidence: repo, clock });
    return {
      investigations,
      companies: repo,
      evidence: repo,
      evidenceService,
      strategy: { loadSnapshot: async () => structuredClone(STRATEGY) },
      webResearch: web,
      capturer: capture.capturer,
      captureStore,
      ai: ai.ai,
      clock,
      newId: () => crypto.randomUUID(),
      log: (message) => logs.push(message),
      ...overrides,
    };
  }

  function service(
    overrides: Partial<InvestigationDeps> = {},
    runnerId = 'teste-a',
  ): InvestigationService {
    return createInvestigationService(deps(overrides), { runnerId, heartbeatMs: 3_600_000 });
  }

  async function importCompany(confirmDomain: string | null = 'atelie-exemplo.test') {
    const imported = await companies.importFromCnpj(ctx, {
      cnpj: RECORD.cnpj,
      displayName: 'Ateliê Exemplo',
    });
    if (imported.status === 'failed') throw new Error('importação falhou');
    if (!confirmDomain) return imported.company;
    return service().confirmSite(ctx, { companyId: imported.company.id, domain: confirmDomain });
  }

  async function run(svc: InvestigationService, companyId: string, force = false) {
    const started = await svc.start(ctx, { companyId, force });
    await svc.idle();
    const finished = await svc.get(ctx, started.id);
    if (!finished) throw new Error('investigação sumiu');
    return finished;
  }

  const state = (investigation: { steps: Array<{ key: string; state: string }> }) =>
    Object.fromEntries(investigation.steps.map((step) => [step.key, step.state]));

  beforeEach(() => {
    now = new Date('2026-11-10T12:00:00Z');
    logs = [];
    audit = createMemoryAuditRepository({ clock });
    repo = createMemoryCompanyRepository({ audit, clock });
    investigations = createMemoryInvestigationRepository({ audit, companies: repo, clock });
    captureStore = createMemoryCaptureStore();
    pages = sitePages();
    reader = fakeReader(pages);
    search = fakeSearch();
    capture = fakeCapturer();
    ai = fakeAi();
    const evidenceService = createEvidenceService({ evidence: repo, clock });
    web = createWebResearchService({
      search: search.search,
      pages: reader.fetcher,
      usage: createMemoryWebResearchUsage(),
      companies: repo,
      evidence: repo,
      evidenceService,
      monthlyCreditBudget: 50,
      clock,
      log: (message) => logs.push(message),
    });
    companies = createCompanyService({
      companies: repo,
      evidence: repo,
      evidenceService,
      cnpjLookup: {
        async lookup() {
          return { ok: true, record: structuredClone(RECORD), fetchedAt: now.toISOString() };
        },
      },
      clock,
    });
  });

  // ---------------------------------------------------------------------------

  it('investiga de ponta a ponta: fatos com trecho conferido, inferências com fato por trás e Fit, Opportunity e Confidence separados', async () => {
    const company = await importCompany();
    const svc = service();
    const investigation = await run(svc, company.id);

    expect(investigation.status).toBe('succeeded');
    expect(Object.values(state(investigation)).every((value) => value === 'done')).toBe(true);
    expect(investigation.usage).toMatchObject({
      searches: 2,
      searchCredits: 2,
      captures: 2,
      modelCalls: 5,
    });
    expect(investigation.usage.pagesRead).toBeGreaterThanOrEqual(4);
    expect(investigation.models.map((use) => use.agent).sort()).toEqual(
      ['company-business', 'brand-visual', 'competitor-triage', 'competitive', 'diagnosis'].sort(),
    );
    expect(captureStore.size()).toBe(2);
    expect(reader.calls).not.toContain('https://atelie-exemplo.test/politica-de-privacidade');

    const claims = await repo.claimsFor('company', company.id);
    const byKey = new Map(claims.map((claim) => [claim.key, claim]));

    // Fato com trecho literal da página; o trecho inventado ficou de fora.
    const offering = byKey.get('positioning.offering.moveis_sob_medida');
    expect(offering?.epistemicType).toBe('fact');
    const [evidence] = await repo.evidenceFor([offering?.id ?? '']);
    const [source] = await repo.sourcesByIds([evidence?.sourceId ?? '']);
    expect(source?.excerptText).toContain('Móveis planejados sob medida para apartamentos');
    expect(byKey.has('positioning.offering.reformas_completas')).toBe(false);

    // Inferências da auditoria visual dependem da captura (fato).
    const audit = byKey.get('visual.audit.experiencia_celular');
    expect(audit?.epistemicType).toBe('inference');
    const deps = await repo.dependenciesFor([audit?.id ?? '']);
    const capture = byKey.get('visual.capture.site_mobile');
    expect(deps.map((item) => item.dependsOnClaimId)).toContain(capture?.id);
    expect(byKey.has('visual.audit.criterio_inventado')).toBe(false);

    // Concorrente direto vira inferência; o de outro ramo e o inventado ficam de fora.
    expect(byKey.get('competitive.competitor.moveis_rival_test')?.epistemicType).toBe('inference');
    expect(byKey.get('competitive.peer_page.moveis_rival_test')?.epistemicType).toBe('fact');
    expect(byKey.has('competitive.competitor.colchoes_exemplo_test')).toBe(false);
    expect([...byKey.keys()].some((key) => key.includes('instagram'))).toBe(false);

    // Sinal da internet é hipótese, nunca fato.
    const signal = claims.find((claim) => claim.key.startsWith('signal.web.'));
    expect(signal?.epistemicType).toBe('hypothesis');

    const diagnosis = investigation.diagnosis;
    expect(diagnosis?.summaryClaimId).toBe(byKey.get('positioning.diagnosis_summary')?.id);
    expect(diagnosis?.opportunityClaimIds).toHaveLength(1);
    const offer = diagnosis?.offers[0];
    expect(offer?.offerId).toBe(OFFER_ID);
    expect(offer?.fit.score).toBe(100);
    expect(offer?.opportunity.score).toBeGreaterThan(0);
    expect(offer?.confidence.score).toBeGreaterThan(0);
    expect(offer?.fit.score).not.toBe(offer?.confidence.score);
    // Os textos da IA ficam no claim da leitura (ledger), não no diagnóstico.
    expect(offer?.readingClaimId).toBe(diagnosis?.opportunityClaimIds[0]);
    const reading = claims.find((claim) => claim.id === offer?.readingClaimId);
    expect(reading?.value?.openingAngle).toContain('madeira certificada');
    expect(JSON.stringify(diagnosis)).not.toContain('madeira certificada');
    // Sem canal de contato conhecido, nunca "abordar agora".
    expect(diagnosis?.recommendation).not.toBe('pursue');
    expect(diagnosis?.gaps.map((gap) => gap.code)).toContain('no_contact_channel');
    const opportunity = claims.find((claim) => claim.id === diagnosis?.opportunityClaimIds[0]);
    expect(opportunity?.value).toMatchObject({
      offerId: OFFER_ID,
      relevance: 'strong',
      problemsMatched: [1, 2],
    });

    // O que foi descartado aparece no diagnóstico.
    expect(diagnosis?.verification.discarded).toBeGreaterThanOrEqual(3);
    expect(diagnosis?.verification.reasons.join(' ')).toMatch(/não aparece na página/);

    // Auditoria: início e conclusão; empresa marcada como investigada.
    const actions = (await audit_entries()).map((entry) => entry.action);
    expect(actions).toContain('company.investigation.started');
    expect(actions).toContain('company.investigation.finished');
    expect((await repo.get(company.id))?.lastInvestigatedAt).not.toBeNull();

    const [summary] = await svc.summaries(ctx, [company.id]);
    expect(summary).toMatchObject({
      investigationId: investigation.id,
      status: 'succeeded',
      recommendedOfferName: 'Revisão de marca',
    });
  });

  async function audit_entries() {
    return audit.entries();
  }

  it('cada análise da IA vai para llm_calls com o traço do pedido; falha da telemetria não derruba', async () => {
    const company = await importCompany();
    const calls: NewLlmCall[] = [];
    const investigation = await run(
      service({ telemetry: { recordLlmCall: async (call) => void calls.push(call) } }),
      company.id,
    );
    expect(investigation.status).toBe('succeeded');
    expect(calls).toHaveLength(investigation.usage.modelCalls);
    expect(calls.every((call) => call.traceId === ctx.traceId && call.status === 'ok')).toBe(true);
    expect(calls.find((call) => call.promptVersion?.startsWith('brand-visual'))?.task).toBe(
      'vision',
    );

    const broken = await run(
      service({
        telemetry: {
          recordLlmCall: async () => {
            throw new Error('banco fora do ar');
          },
        },
      }),
      company.id,
      true,
    );
    expect(broken.status).toBe('succeeded');
    expect(logs.some((line) => line.includes('uso da IA não registrado'))).toBe(true);
  });

  it('sem site confirmado: grava candidatos como hipóteses e pede a confirmação, sem inventar o resto', async () => {
    const company = await importCompany(null);
    const investigation = await run(service(), company.id);

    expect(investigation.status).toBe('partial');
    expect(state(investigation)).toMatchObject({
      site: 'done',
      pages: 'skipped',
      capture: 'skipped',
      business_analysis: 'skipped',
      visual_analysis: 'skipped',
      qualification: 'done',
    });
    expect(investigation.steps.find((step) => step.key === 'site')?.issue).toBe('no_site');
    const claims = await repo.claimsFor('company', company.id);
    const candidates = claims.filter((claim) =>
      claim.key.startsWith('digital_presence.official_site_candidate.'),
    );
    expect(candidates.map((claim) => claim.epistemicType)).toEqual(['hypothesis']);
    expect(candidates[0]?.value).toMatchObject({ domain: 'atelie-exemplo.test', nameMatch: true });
    expect(claims.some((claim) => claim.key.startsWith('visual.'))).toBe(false);
    expect(investigation.diagnosis?.nextStep).toBe('confirm_site');
    expect(investigation.diagnosis?.gaps.map((gap) => gap.code)).toContain('no_site');
  });

  it('IA local fora do ar: coleta e qualificação continuam, sem nenhuma inferência da IA', async () => {
    const company = await importCompany();
    ai.setUnavailable(true);
    const investigation = await run(service(), company.id);

    expect(investigation.status).toBe('partial');
    expect(investigation.steps.find((step) => step.key === 'business_analysis')).toMatchObject({
      state: 'failed',
      issue: 'ai_unavailable',
    });
    expect(state(investigation).qualification).toBe('done');
    const claims = await repo.claimsFor('company', company.id);
    expect(
      claims.filter(
        (claim) =>
          claim.producedByRunId === investigation.id && claim.epistemicType === 'inference',
      ),
    ).toEqual([]);
    expect(investigation.diagnosis?.summaryClaimId).toBeNull();
    expect(['investigate_more', 'insufficient_evidence', 'monitor']).toContain(
      investigation.diagnosis?.recommendation,
    );
  });

  it('site pede para não guardar cópia: a captura vai à IA e é descartada, sem o texto da página', async () => {
    const company = await importCompany();
    const capturer: BrandCapturer = {
      async capture(url, viewport, options) {
        const result = await capture.capturer.capture(url, viewport, options);
        return result.ok ? { ok: true, capture: { ...result.capture, noArchive: true } } : result;
      },
    };
    const investigation = await run(service({ capturer }), company.id);

    expect(captureStore.size()).toBe(0);
    expect(investigation.usage.captures).toBe(2);
    const step = investigation.steps.find((item) => item.key === 'capture');
    expect(step?.state).toBe('done');
    expect(step?.issue ?? null).toBeNull();
    // As imagens foram à auditoria visual desta execução.
    expect(investigation.models.map((use) => use.agent)).toContain('brand-visual');

    const claims = await repo.claimsFor('company', company.id);
    const visual = claims.filter((claim) => claim.key.startsWith('visual.'));
    const byKey = new Map(visual.map((claim) => [claim.key, claim]));
    expect(byKey.get('visual.capture.site_desktop')?.value).toMatchObject({
      storagePath: null,
      noArchive: true,
    });
    expect(byKey.get('visual.metric.h1')?.statement).toBe(
      'Um título principal (H1) no computador (texto não guardado a pedido do site).',
    );
    expect(byKey.get('visual.metric.cta')?.value).toMatchObject({ count: 1, texts: [] });
    const evidence = await repo.evidenceFor(visual.map((claim) => claim.id));
    const sources = await repo.sourcesByIds(evidence.map((item) => item.sourceId));
    const kept = JSON.stringify([visual, sources]);
    expect(kept).not.toContain('Agende uma visita');
    expect(kept).not.toContain('"Móveis sob medida"');
    expect(sources.every((source) => source.storagePath === null)).toBe(true);
  });

  it('site que passou a pedir para não guardar cópia: as imagens guardadas antes são apagadas', async () => {
    const company = await importCompany();
    const svc = service();
    await run(svc, company.id);
    expect(captureStore.size()).toBe(2);

    const capturer: BrandCapturer = {
      async capture(url, viewport, options) {
        const result = await capture.capturer.capture(url, viewport, options);
        return result.ok ? { ok: true, capture: { ...result.capture, noArchive: true } } : result;
      },
    };
    now = new Date(now.getTime() + 24 * 3600_000);
    const second = await run(service({ capturer }), company.id);
    expect(state(second).capture).toBe('done');
    expect(captureStore.size()).toBe(0);
  });

  it('sem IA configurada: concorrentes ficam como hipóteses a conferir', async () => {
    const company = await importCompany();
    const investigation = await run(service({ ai: null }), company.id);
    expect(investigation.steps.find((step) => step.key === 'visual_analysis')).toMatchObject({
      state: 'skipped',
      issue: 'ai_unavailable',
    });
    const claims = await repo.claimsFor('company', company.id);
    expect(
      claims.find((claim) => claim.key.startsWith('competitive.competitor.'))?.epistemicType,
    ).toBe('hypothesis');
  });

  it('descarta o que a IA não pode afirmar (faturamento, "precisa de rebranding") e registra o motivo', async () => {
    ai = fakeAi({
      diagnosis: (input) => {
        const fact = input.facts.find((item) => item.type === 'fact')?.ref ?? 'K1';
        return {
          summary: {
            statement: 'A empresa fatura cerca de R$ 2 milhões por ano e precisa de rebranding.',
            reasoning: 'Estimativa.',
            factor: 0.9,
            basedOn: [fact],
          },
          hypotheses: [],
          offers: input.offers.map((offer) => ({
            offer: offer.ref,
            relevance: 'moderate' as const,
            statement: 'A empresa precisa de uma nova identidade visual.',
            reasoning: 'A marca parece antiga.',
            factor: 0.6,
            basedOn: ['K999'],
            openingAngle: null,
            objections: [],
            toVerify: [],
            problemsMatched: [],
            signalsMatched: [],
            disqualifiersHit: [],
          })),
        };
      },
    });
    const company = await importCompany();
    const investigation = await run(service(), company.id);

    expect(investigation.diagnosis?.summaryClaimId).toBeNull();
    expect(investigation.diagnosis?.opportunityClaimIds).toEqual([]);
    const reasons = investigation.diagnosis?.verification.reasons.join(' ') ?? '';
    expect(reasons).toMatch(/faturamento/);
    expect(reasons).toMatch(/precisa do serviço/);
    expect(reasons).toMatch(/não existe/);
    const claims = await repo.claimsFor('company', company.id);
    expect(claims.some((claim) => /fatura|precisa de/i.test(claim.statement))).toBe(false);
    // Sem claim que sustente, a necessidade fica no máximo fraca.
    expect(investigation.diagnosis?.offers[0]?.recommendation).not.toBe('prepare_access');
  });

  it('cancela no meio: para na etapa atual e não chama mais a IA', async () => {
    const company = await importCompany();
    const svc = service();
    const release = ai.hold('company-business');
    const started = await svc.start(ctx, { companyId: company.id });
    await waitFor(() => ai.calls.includes('company-business'));
    expect(await svc.cancel(ctx, started.id)).toBe(true);
    release();
    await svc.idle();

    const cancelled = await svc.get(ctx, started.id);
    expect(cancelled?.status).toBe('cancelled');
    expect(cancelled?.issue).toBe('cancelled');
    expect(state(cancelled ?? { steps: [] })).toMatchObject({
      capture: 'done',
      business_analysis: 'skipped',
      diagnosis: 'pending',
    });
    expect(ai.calls).toEqual(['company-business']);
    expect(await svc.cancel(ctx, started.id)).toBe(false);
    // Para o Copiloto: cancelada terminou, mas não está "concluída" (não há resultado).
    const view = await callTool(svc, 'get_company_investigation', { empresa: company.id });
    expect(view.body.dados.investigacao).toMatchObject({
      estado: 'Cancelada',
      concluida: false,
      terminou: true,
    });
    // Outra pode começar depois do cancelamento.
    await expect(svc.start(ctx, { companyId: company.id })).resolves.toMatchObject({
      status: 'queued',
    });
    await svc.idle();
  });

  it('uma investigação ativa por empresa', async () => {
    const company = await importCompany();
    const svc = service();
    const release = ai.hold('company-business');
    await svc.start(ctx, { companyId: company.id });
    const error = await svc
      .start(ctx, { companyId: company.id })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).reason).toBe('investigation_running');
    release();
    await svc.idle();
  });

  it('processo encerrado no meio: fica interrompida e retoma sem repetir as etapas concluídas', async () => {
    const company = await importCompany();
    const first = service({}, 'processo-1');
    ai.hold('brand-visual');
    const started = await first.start(ctx, { companyId: company.id });
    await waitFor(() => ai.calls.includes('brand-visual'));
    // O processo 1 "morre" aqui: a chamada da IA nunca volta.

    now = new Date(now.getTime() + 5 * 60_000);
    const second = service({ ai: fakeAi().ai }, 'processo-2');
    expect(await second.recoverInterrupted()).toBe(1);
    expect((await second.get(ctx, started.id))?.status).toBe('interrupted');

    const capturesBefore = capture.calls.length;
    const searchesBefore = search.calls.length;
    await second.resume(ctx, started.id);
    await second.idle();
    const resumed = await second.get(ctx, started.id);

    expect(resumed?.status).toBe('succeeded');
    expect(capture.calls.length).toBe(capturesBefore);
    // Sinais e concorrentes ainda não tinham rodado: só eles buscam.
    expect(search.calls.length).toBe(searchesBefore + 2);
    expect(resumed?.diagnosis?.summaryClaimId).not.toBeNull();
    const actions = (await audit_entries()).map((entry) => entry.action);
    expect(actions).toContain('company.investigation.resumed');
  });

  it('não retoma investigação concluída', async () => {
    const company = await importCompany();
    const svc = service();
    const done = await run(svc, company.id);
    const error = await svc.resume(ctx, done.id).catch((caught: unknown) => caught);
    expect((error as AppError).reason).toBe('investigation_not_resumable');
  });

  it('cenário H: reinvestigar sem mudanças reaproveita buscas e análises (sem crédito nem GPU) e não aponta mudança', async () => {
    const company = await importCompany();
    const svc = service();
    const first = await run(svc, company.id);
    const searches = search.calls.length;
    const modelCalls = ai.calls.length;

    now = new Date(now.getTime() + 24 * 3600_000);
    const second = await run(svc, company.id);
    expect(second.previousId).toBe(first.id);
    expect(state(second)).toMatchObject({
      signals: 'reused',
      competitors: 'reused',
      business_analysis: 'reused',
      visual_analysis: 'reused',
      competitive_analysis: 'reused',
      diagnosis: 'reused',
      qualification: 'done',
      capture: 'done',
    });
    expect(search.calls.length).toBe(searches);
    expect(ai.calls.length).toBe(modelCalls);
    expect(second.usage).toMatchObject({ searches: 0, searchCredits: 0, modelCalls: 0 });
    expect(second.diagnosis?.summaryClaimId).toBe(first.diagnosis?.summaryClaimId);
    expect(second.diagnosis?.offers[0]?.recommendation).toBe(
      first.diagnosis?.offers[0]?.recommendation,
    );
    expect(second.changes).toEqual([]);

    // Uma imagem por janela: as da primeira investigação saíram quando as novas entraram.
    expect(captureStore.size()).toBe(2);
    expect(await svc.captureImage(ctx, company.id, `${second.id}-desktop.jpg`)).not.toBeNull();
    expect(await svc.captureImage(ctx, company.id, `${first.id}-desktop.jpg`)).toBeNull();

    // Coleta completa a pedido: busca e analisa de novo.
    now = new Date(now.getTime() + 2 * 24 * 3600_000);
    const forced = await run(svc, company.id, true);
    expect(forced.usage.searches).toBe(2);
    expect(state(forced).diagnosis).toBe('done');
  });

  it('imagem da captura só sai para a própria empresa e para um arquivo que o ledger aponta', async () => {
    const company = await importCompany();
    const svc = service();
    const investigation = await run(svc, company.id);
    const file = `${investigation.id}-mobile.jpg`;

    const found = await svc.captureImage(ctx, company.id, file);
    expect(found?.mime).toBe('image/jpeg');
    expect(found?.bytes.length).toBeGreaterThan(0);

    expect(await svc.captureImage(ctx, crypto.randomUUID(), file)).toBeNull();
    expect(await svc.captureImage(ctx, 'nao-e-uuid', file)).toBeNull();
    expect(await svc.captureImage(ctx, company.id, `../${file}`)).toBeNull();
    expect(await svc.captureImage(ctx, company.id, `${investigation.id}-tablet.jpg`)).toBeNull();
    expect(await svc.captureImage(ctx, company.id, file.toUpperCase())).toBeNull();

    // Arquivo que está na pasta sem nenhum claim da empresa apontando para ele.
    const stray = await captureStore.put({
      companyId: company.id,
      investigationId: crypto.randomUUID(),
      viewport: 'desktop',
      image: {
        bytes: new Uint8Array([0xff, 0xd8, 0xff]),
        sha256: 'a'.repeat(64),
        mime: 'image/jpeg',
        width: 1,
        height: 1,
      },
      capturedAt: now.toISOString(),
    });
    const strayFile = stray.storagePath.split('/')[1] ?? '';
    expect(await captureStore.get(stray.storagePath)).not.toBeNull();
    expect(await svc.captureImage(ctx, company.id, strayFile)).toBeNull();

    // Sem pasta configurada: nada a servir.
    expect(await service({ captureStore: null }).captureImage(ctx, company.id, file)).toBeNull();
  });

  it('mais de um ano depois: nada vencido entra no diagnóstico como atual (ADR-0002)', async () => {
    const company = await importCompany();
    const svc = service();
    await run(svc, company.id);

    now = new Date(now.getTime() + 400 * 24 * 3600_000);
    const later = await run(svc, company.id);
    const claims = await repo.claimsFor('company', company.id);
    const byId = new Map(claims.map((claim) => [claim.id, claim]));
    const used = [
      ...(later.diagnosis?.factClaimIds ?? []),
      ...(later.diagnosis?.inferenceClaimIds ?? []),
      ...(later.diagnosis?.offers.flatMap((offer) => offer.opportunity.claimIds) ?? []),
    ];
    expect(used.length).toBeGreaterThan(0);
    // Os fakes de captura e de páginas devolvem data fixa (2026): o que esta execução gravou
    // nasce com a validade da data da fonte. A regra testada é a do que veio de antes.
    const expired = used
      .map((id) => byId.get(id))
      .filter((claim) => claim?.producedByRunId !== later.id)
      .filter((claim) => !claim || Date.parse(claim.validUntil) <= now.getTime())
      .map((claim) => `${claim?.key} ${claim?.validUntil} ${claim?.status}`);
    expect(expired).toEqual([]);
  });

  it('detecta mudança no site entre investigações (nova oferta)', async () => {
    const company = await importCompany();
    const svc = service();
    await run(svc, company.id);

    const home = pages['https://atelie-exemplo.test/'];
    if (home) home.text = `${home.text}\nNovidade: painéis ripados sob medida.`;
    ai = fakeAi({
      'company-business': (input) => {
        const base = defaultHandlers()['company-business'](input);
        return {
          ...base,
          offerings: [
            ...base.offerings,
            {
              label: 'Painéis ripados',
              page: input.pages[0]?.ref ?? 'P1',
              quote: 'painéis ripados sob medida',
            },
          ],
        };
      },
    });
    now = new Date(now.getTime() + 2 * 24 * 3600_000);
    const second = await run(service(), company.id);
    expect(state(second).business_analysis).toBe('done');
    expect(second.changes.map((change) => change.kind)).toContain('offering_added');
    expect(second.changes.find((change) => change.kind === 'offering_added')?.text).toContain(
      'Painéis ripados',
    );
  });

  it('confirma o site: normaliza o endereço e recusa domínio de outro cadastro', async () => {
    const company = await importCompany(null);
    const svc = service();
    const updated = await svc.confirmSite(ctx, {
      companyId: company.id,
      domain: 'https://www.Atelie-Exemplo.test/contato',
    });
    expect(updated.primaryDomain).toBe('atelie-exemplo.test');
    const other = await companies.create(ctx, {
      schemaVersion: 1,
      displayName: 'Outra Empresa',
      cnpj: null,
      primaryDomain: null,
      city: 'Curitiba',
      uf: 'PR',
    });
    const error = await svc
      .confirmSite(ctx, { companyId: other.company.id, domain: 'atelie-exemplo.test' })
      .catch((caught: unknown) => caught);
    expect((error as AppError).reason).toBe('company_duplicate');
    const invalid = await svc
      .confirmSite(ctx, { companyId: other.company.id, domain: 'não é domínio' })
      .catch((caught: unknown) => caught);
    expect((invalid as AppError).code).toBe('validation');
  });

  it('falha fora das etapas (banco fora do ar no meio): conclusão auditada como falha pelo sistema', async () => {
    const company = await importCompany();
    let broken = true;
    const flaky = {
      ...investigations,
      async get(id: string) {
        if (broken) {
          broken = false;
          throw new Error('banco fora do ar');
        }
        return investigations.get(id);
      },
    };
    const svc = service({ investigations: flaky });
    const started = await svc.start(ctx, { companyId: company.id });
    await svc.idle();

    expect(await investigations.get(started.id)).toMatchObject({
      status: 'failed',
      issue: 'unexpected',
    });
    const finished = audit
      .entries()
      .find(
        (entry) =>
          entry.action === 'company.investigation.finished' && entry.entityId === started.id,
      );
    expect(finished?.actorType).toBe('system');
    expect(finished?.actorLabel).toBe('investigation-runner');
    expect(logs.join('\n')).toContain('falha inesperada');
    // O texto do erro (que pode trazer dado) não vai para o log.
    expect(logs.join('\n')).not.toContain('banco fora do ar');
  });

  it('empresa arquivada enquanto espera na fila: nada é coletado, e não se retoma investigação dela', async () => {
    const first = await importCompany();
    const second = (
      await companies.create(ctx, {
        schemaVersion: 1,
        displayName: 'Segunda Empresa',
        cnpj: null,
        primaryDomain: null,
        city: 'Curitiba',
        uf: 'PR',
      })
    ).company;
    const svc = service();
    const release = ai.hold('company-business');
    await svc.start(ctx, { companyId: first.id });
    const waiting = await svc.start(ctx, { companyId: second.id });
    await waitFor(() => ai.calls.includes('company-business'));
    await companies.changeLifecycle(ctx, { companyId: second.id, lifecycle: 'archived' });
    release();
    await svc.idle();

    const stopped = await svc.get(ctx, waiting.id);
    expect(stopped?.status).toBe('cancelled');
    expect(stopped?.issue).toBe('company_archived');
    expect(stopped?.steps.every((step) => step.state === 'pending')).toBe(true);
    expect(search.calls.some((call) => call.query.includes('Segunda Empresa'))).toBe(false);
    const produced = (await repo.claimsFor('company', second.id)).filter(
      (claim) => claim.producedByRunId === waiting.id,
    );
    expect(produced).toEqual([]);
    const error = await svc.resume(ctx, waiting.id).catch((caught: unknown) => caught);
    expect((error as AppError).reason).toBe('investigation_not_resumable');

    // Interrompida antes do arquivamento: também não retoma.
    const interrupted = await svc.start(ctx, { companyId: first.id });
    await svc.idle();
    await investigations.update(interrupted.id, { status: 'interrupted' });
    await companies.changeLifecycle(ctx, { companyId: first.id, lifecycle: 'archived' });
    const archived = await svc.resume(ctx, interrupted.id).catch((caught: unknown) => caught);
    expect((archived as AppError).reason).toBe('company_archived');
  });

  it('batimento cobre a execução atual e as que esperam na fila deste processo', async () => {
    const first = await importCompany();
    const second = (
      await companies.create(ctx, {
        schemaVersion: 1,
        displayName: 'Segunda Empresa',
        cnpj: null,
        primaryDomain: null,
        city: 'Curitiba',
        uf: 'PR',
      })
    ).company;
    const touched: string[][] = [];
    const watched = {
      ...investigations,
      async touch(ids: readonly string[], runner: string, at: string) {
        touched.push([...ids]);
        return investigations.touch(ids, runner, at);
      },
    };
    const release = ai.hold('company-business');
    const svc = createInvestigationService(deps({ investigations: watched }), {
      runnerId: 'teste-batimento',
      heartbeatMs: 5,
    });
    const running = await svc.start(ctx, { companyId: first.id });
    const waiting = await svc.start(ctx, { companyId: second.id });
    await waitFor(() =>
      touched.some((ids) => ids.includes(running.id) && ids.includes(waiting.id)),
    );
    // Cancelamento pedido "por outra instância" (direto no registro) chega pela batida.
    await investigations.requestCancel(running.id, now.toISOString(), {
      actorType: 'user',
      actorLabel: null,
      traceId: ctx.traceId,
      action: 'company.investigation.cancel_requested',
      entityType: 'company_investigation',
      entityId: running.id,
      diff: {},
      withVersion: false,
    });
    for (let tries = 0; tries < 400; tries++) {
      if ((await investigations.get(running.id))?.status === 'cancelled') break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    release();
    await svc.idle();
    expect((await svc.get(ctx, running.id))?.status).toBe('cancelled');
    expect((await svc.get(ctx, waiting.id))?.status).not.toBe('queued');
  });

  // ---------------------------------------------------------------------------
  // Ferramentas do Copiloto (§15): leem o estado real e só põem na fila
  // ---------------------------------------------------------------------------

  async function callTool(
    svc: InvestigationService,
    name: string,
    args: Record<string, unknown> = {},
  ) {
    const registry = createToolRegistry({
      tools: investigationTools({ investigations: svc, companies }),
      telemetry: null,
    });
    const execution = await registry.execute(ctx, { id: `t-${name}`, name, arguments: args });
    return {
      result: execution.result,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- leitura do JSON do modelo
      body: JSON.parse(execution.forModel) as { status: string; resumo: string; dados: any },
    };
  }

  it('Copiloto: progresso real, diagnóstico com as três medidas separadas e análise por parte', async () => {
    const company = await importCompany();
    const svc = service();

    const none = await callTool(svc, 'get_company_investigation', { empresa: company.id });
    expect(none.body.dados.investigacao).toBeNull();

    const release = ai.hold('company-business');
    await svc.start(ctx, { companyId: company.id });
    await waitFor(() => ai.calls.includes('company-business'));
    const running = await callTool(svc, 'get_company_investigation', {
      empresa: 'Ateliê Exemplo',
    });
    expect(running.body.dados.investigacao).toMatchObject({ concluida: false, terminou: false });
    release();
    await svc.idle();

    const done = await callTool(svc, 'get_company_investigation', { empresa: company.id });
    expect(done.body.status).toBe('ok');
    expect(done.body.dados.investigacao.concluida).toBe(true);
    const [offer] = done.body.dados.diagnostico.ofertas;
    expect(offer).toMatchObject({ oferta: 'Revisão de marca', fit_icp: 100 });
    expect(offer.leitura_da_ia.leitura.tipo).toBe('inferência');
    expect(offer.leitura_da_ia.angulo).toContain('madeira certificada');
    expect(offer.oportunidade).toBeGreaterThan(0);
    expect(offer.confianca).toBeGreaterThan(0);
    expect(done.body.dados.diagnostico.leitura_central.tipo).toBe('inferência');
    // Leituras da IA escritas a partir de páginas da web: marcadas como conteúdo externo.
    expect(offer.leitura_da_ia.leitura.fonte_externa).toBe(true);
    expect(done.body.dados.diagnostico.leitura_central.fonte_externa).toBe(true);

    const brand = await callTool(svc, 'get_company_investigation', {
      empresa: company.id,
      parte: 'marca',
    });
    const statements = brand.body.dados.registros.map(
      (item: { afirmacao: string }) => item.afirmacao,
    );
    expect(statements.length).toBeGreaterThan(0);
    expect(
      brand.body.dados.registros.every((item: { tipo: string }) =>
        ['fato', 'inferência', 'hipótese'].includes(item.tipo),
      ),
    ).toBe(true);
    // Capturas (título e textos vindos da página) e leituras da IA: tudo marcado como externo.
    expect(
      brand.body.dados.registros.every((item: { fonte_externa?: boolean }) => item.fonte_externa),
    ).toBe(true);
    expect(brand.body.dados.aviso).toMatch(/não instrução/);
    const rivals = await callTool(svc, 'get_company_investigation', {
      empresa: company.id,
      parte: 'concorrencia',
    });
    expect(JSON.stringify(rivals.body.dados.registros)).toContain('moveis-rival.test');
    expect(JSON.stringify(rivals.body.dados.registros)).not.toContain('colchoes-exemplo.test');
    // Com a parte, o estado da investigação vem junto ("nada registrado" ≠ "ainda rodando").
    expect(rivals.body.dados.investigacao).toEqual({
      estado: 'Concluída',
      concluida: true,
      terminou: true,
    });

    const ranking = await callTool(svc, 'list_company_opportunities');
    expect(ranking.body.dados.empresas).toEqual([
      expect.objectContaining({ id: company.id, oferta: 'Revisão de marca' }),
    ]);
  });

  it('Copiloto: põe na fila com auditoria, nunca diz que terminou e respeita as regras da tela', async () => {
    const company = await importCompany();
    const svc = service();
    const release = ai.hold('company-business');

    const queued = await callTool(svc, 'start_company_investigation', { empresa: company.id });
    expect(queued.body.status).toBe('ok');
    expect(queued.body.dados.investigacao).toMatchObject({ concluida: false, terminou: false });
    expect(queued.body.dados.resultado_disponivel).toBe(false);
    expect(JSON.stringify(queued.body.dados)).not.toMatch(/\b(Diga|consulte|mantenha)\b/);
    const started = audit
      .entries()
      .find((entry) => entry.action === 'company.investigation.started');
    expect(started?.diff).toMatchObject({ trigger: 'copilot' });

    // Já há uma rodando: o erro da tela volta como resultado, sem exceção.
    const again = await callTool(svc, 'start_company_investigation', { empresa: company.id });
    expect(again.body.status).not.toBe('ok');
    expect(again.body.resumo).toMatch(/investigação/i);

    const unknown = await callTool(svc, 'start_company_investigation', {
      empresa: 'Empresa que não existe',
    });
    // Empresa fora do cadastro: o resultado diz o caminho e nada entra na fila.
    expect(unknown.body.resumo).toMatch(/não está cadastrada.*Nada foi posto na fila/s);
    expect(unknown.body.dados.investigacao).toBeNull();
    expect(
      audit.entries().filter((entry) => entry.action === 'company.investigation.started'),
    ).toHaveLength(1);
    release();
    await svc.idle();
  });

  it('cenário J: empresa vinda da Descoberta vai para a investigação pelo id, sem recadastro', async () => {
    const company = await importCompany();
    const before = await companies.list(ctx);
    const svc = service();

    const started = await svc.start(ctx, { companyId: company.id, trigger: 'discovery' });
    await svc.idle();

    expect(started.companyId).toBe(company.id);
    expect(await svc.get(ctx, started.id)).toMatchObject({
      companyId: company.id,
      trigger: 'discovery',
    });
    const after = await companies.list(ctx);
    expect(after.map((item) => item.id)).toEqual(before.map((item) => item.id));
    const audited = audit
      .entries()
      .find((entry) => entry.action === 'company.investigation.started');
    expect(audited?.diff).toMatchObject({ trigger: 'discovery' });
  });

  it('Copiloto: a ferramenta que põe na fila aparece como tal para os fatos do sistema', () => {
    const registry = createToolRegistry({
      tools: investigationTools({ investigations: service(), companies }),
      telemetry: null,
    });
    const specs = registry.specs();
    expect(specs.find((spec) => spec.name === 'start_company_investigation')?.queue).toBe(true);
    expect(specs.filter((spec) => spec.queue === true)).toHaveLength(1);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error('condição não aconteceu a tempo');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
