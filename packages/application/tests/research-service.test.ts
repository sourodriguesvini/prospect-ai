import type { LiaVersion, WebSearchOutcome, WebSearchResult } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  AppError,
  createJobWorker,
  createPersonKeyHasher,
  createResearchService,
  normalizeIdentity,
  RESEARCH_TOOL_NAME,
  runResearchTurn,
  type RequestContext,
  type WebResearchStatus,
} from '../src';
import {
  createMemoryAuditRepository,
  createMemoryDiscoveryStore,
  createMemoryResearchRepository,
} from '../src/memory';

const BLUMMY_REQUEST =
  'Quero encontrar 100 terapeutas ocupacionais no Brasil para apresentar a Blummy.';
const THREAD_ID = '11111111-1111-4111-8111-111111111111';
const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '22222222-2222-4222-8222-222222222222',
};

const WORDS = ['Alfa', 'Bravo', 'Celta', 'Dorado', 'Eco', 'Farol', 'Gaia', 'Horto', 'Iris', 'Jade'];

/** Nome sintético único por consulta (dados de teste, nunca de pessoas reais). */
function syntheticName(index: number): string {
  return `Pessoa ${WORDS[Math.floor(index / 10) % 10]} ${WORDS[index % 10]}`;
}

function hitsFor(query: string, index: number): WebSearchResult[] {
  const match = / ([A-Z]{2})$/.exec(query);
  const uf = match?.[1] ?? 'SP';
  const city = query
    .replace(/^.*?(ocupacional|clínica de terapia ocupacional)\s+/, '')
    .replace(/ [A-Z]{2}$/, '');
  const name = syntheticName(index);
  return [
    {
      rank: 1,
      url: `https://www.doctoralia.com.br/${name.toLowerCase().replace(/\s+/g, '-')}/terapeuta-ocupacional`,
      title: `${name} - Terapeuta Ocupacional - ${city} - ${uf}`,
      snippet: `${name} atende em ${city} - ${uf}. Agende pelo site.`,
      publishedAt: null,
      score: null,
    },
    {
      rank: 2,
      url: `https://clinica-${index}.test/sobre`,
      title: `Clínica Sintética ${WORDS[index % 10]} ${index} de Terapia Ocupacional | ${city}/${uf}`,
      snippet: 'Atendimento em terapia ocupacional infantil. Fale conosco: (11) 3333-4444.',
      publishedAt: null,
      score: null,
    },
  ];
}

const APPROVED_LIA: LiaVersion = {
  id: '33333333-3333-4333-8333-333333333333',
  version: 2,
  content: {
    purpose: 'Prospecção de profissionais para apresentar produtos.',
    legitimateInterest: 'Oferecer produto relevante para a prática profissional.',
    necessity: 'Só nome, profissão e local profissional.',
    dataCategories: ['name', 'profession', 'organization', 'location', 'role_title', 'work_email'],
    dataSources: ['professional_directory', 'search_result', 'company_website'],
    expectations: 'Profissionais públicos esperam contato profissional.',
    risks: 'Baixos.',
    safeguards: 'Opt-out imediato, prazo de 12 meses.',
    conclusion: 'Aprovada.',
  },
  createdAt: '2026-11-01T12:00:00.000Z',
  approvedAt: '2026-11-02T12:00:00.000Z',
  reviewDueOn: '2027-11-01',
  revokedAt: null,
};

interface SetupOptions {
  search?: 'enabled' | 'disabled';
  creditsRemaining?: number;
  lia?: LiaVersion[];
  personKey?: boolean;
  /** Falha da busca por índice de chamada (1, 2, …). */
  failures?: Record<number, WebSearchOutcome>;
  onSearch?: (call: number) => Promise<void> | void;
}

function setup(options: SetupOptions = {}) {
  let nowMs = Date.parse('2026-11-26T12:00:00.000Z');
  const clock = { now: () => new Date(nowMs) };
  const audit = createMemoryAuditRepository();
  const store = createMemoryDiscoveryStore({ audit, clock });
  const repository = createMemoryResearchRepository({
    audit,
    clock,
    jobs: { enqueueJob: store.enqueueJob, cancelJobs: store.cancelJobs },
  });
  const queries: string[] = [];
  let calls = 0;
  const service = createResearchService({
    research: repository,
    threads: {
      async getThread(id) {
        return id === THREAD_ID
          ? {
              id,
              title: 'Pesquisa',
              createdAt: clock.now().toISOString(),
              updatedAt: clock.now().toISOString(),
              archivedAt: null,
              lastActivityAt: clock.now().toISOString(),
              messageCount: 0,
            }
          : null;
      },
    },
    webResearch: {
      async status(): Promise<WebResearchStatus> {
        const enabled = (options.search ?? 'enabled') === 'enabled';
        return {
          search: enabled ? 'enabled' : 'disabled',
          pageReader: 'enabled',
          usage: enabled
            ? {
                period: '2026-11',
                provider: 'tavily',
                creditsUsed: 0,
                creditsBudget: 1000,
                creditsRemaining: options.creditsRemaining ?? 1000,
              }
            : null,
        };
      },
      async search(_ctx, raw) {
        calls += 1;
        await options.onSearch?.(calls);
        const failure = options.failures?.[calls];
        if (failure) return failure;
        const query = String(raw.query);
        queries.push(query);
        return {
          ok: true,
          provider: 'tavily',
          query,
          results: hitsFor(query, queries.length - 1),
          fetchedAt: clock.now().toISOString(),
          fromCache: false,
          creditsCharged: 1,
        };
      },
    },
    lia: { listLiaVersions: async () => options.lia ?? [APPROVED_LIA] },
    audit,
    personKey: options.personKey === false ? null : createPersonKeyHasher('segredo-de-teste'),
    clock,
    log: () => {},
  });
  const worker = createJobWorker({
    queue: store.queue,
    handlers: { copilot_research: service.jobHandler },
    workerId: 'teste',
    log: () => {},
  });
  return {
    service,
    repository,
    audit,
    queries,
    worker,
    advance(seconds: number) {
      nowMs += seconds * 1000;
    },
    async runAll(max = 50) {
      let ran = 0;
      while (ran < max && (await worker.tick())) ran += 1;
      return ran;
    },
  };
}

describe('pesquisa extensa: início (Partes 6.3 a 6.5)', () => {
  it('o pedido da Blummy vira pesquisa de 100 na fila, com perfil, plano e premissas', async () => {
    const t = setup();
    const { research, assumptions, profileReason } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    expect(research).toMatchObject({
      threadId: THREAD_ID,
      profileKey: 'blummy',
      profileName: 'Blummy',
      requestedCount: 100,
      status: 'queued',
      objective: 'Apresentar a Blummy',
      version: 1,
    });
    expect(profileReason).toBe('named');
    expect(research.plan.queries.length).toBe(research.creditCap);
    expect(research.plan.queries[0]?.query).toBe('terapeuta ocupacional São Paulo SP');
    expect(assumptions.join(' ')).toMatch(/Brasil inteiro/);
    // Nada foi pesquisado ainda: só a fila.
    expect(t.queries).toHaveLength(0);
    expect((await t.audit.listRecent(5)).map((entry) => entry.action)).toContain(
      'copilot.research.created',
    );
  });

  it('recusa com motivo: pedido que não é pesquisa, busca desligada, orçamento zerado, fila cheia', async () => {
    const t = setup();
    await expect(
      t.service.start(ctx, { threadId: THREAD_ID, request: 'O que é terapia ocupacional?' }),
    ).rejects.toMatchObject({ reason: 'research_not_understood' });
    await expect(
      setup({ search: 'disabled' }).service.start(ctx, {
        threadId: THREAD_ID,
        request: BLUMMY_REQUEST,
      }),
    ).rejects.toMatchObject({ reason: 'research_search_unavailable' });
    await expect(
      setup({ creditsRemaining: 0 }).service.start(ctx, {
        threadId: THREAD_ID,
        request: BLUMMY_REQUEST,
      }),
    ).rejects.toMatchObject({ reason: 'research_budget_exhausted' });
    for (let i = 0; i < 3; i += 1) {
      await t.service.start(ctx, { threadId: THREAD_ID, request: BLUMMY_REQUEST });
    }
    await expect(
      t.service.start(ctx, { threadId: THREAD_ID, request: BLUMMY_REQUEST }),
    ).rejects.toMatchObject({ reason: 'research_queue_full' });
  });

  it('pouco crédito no mês: teto menor, com a premissa explicada', async () => {
    const t = setup({ creditsRemaining: 10 });
    const { research, assumptions } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    expect(research.creditCap).toBe(10);
    expect(assumptions.join(' ')).toMatch(/Restam 10 buscas/);
  });
});

describe('pesquisa extensa: lotes na fila', () => {
  it('um lote por tarefa: pessoas com origem e LIA, clínicas com dados públicos, próximo lote na fila', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    expect(await t.worker.tick()).toBe(true);
    const after = await t.service.get(ctx, research.id);
    expect(after.status).toBe('running');
    expect(after.progress).toMatchObject({ batches: 1, queriesDone: 5, creditsUsed: 5 });
    expect(after.foundCount).toBe(10);
    expect(after.progress.people).toBe(5);
    expect(after.progress.organizations).toBe(5);
    expect(after.plan.queries.slice(0, 5).every((query) => query.status === 'done')).toBe(true);

    const items = await t.service.listItems(ctx, research.id);
    const person = items.find((item) => item.kind === 'person');
    expect(person).toMatchObject({
      name: 'Pessoa Alfa Alfa',
      uf: 'SP',
      approachable: true,
      audienceRole: 'user',
      publicPhone: null,
    });
    expect(person?.sourceQuote).toContain('Pessoa Alfa Alfa');
    const clinic = items.find((item) => item.kind === 'organization');
    expect(clinic).toMatchObject({
      segment: 'clinic',
      audienceRole: 'buyer',
      publicPhone: '11 3333-4444',
    });
    // A pessoa fica em `people` com a chave HMAC da identidade (nunca o nome em claro na chave).
    const [stored] = t.repository.people();
    expect(stored?.dedupeKey).toMatch(/^[a-f0-9]{64}$/);
    expect(stored?.liaVersion).toBe(2);

    // O próximo lote já está na fila: a pesquisa continua sem ninguém pedir.
    expect(await t.worker.tick()).toBe(true);
    expect((await t.service.get(ctx, research.id)).progress.batches).toBe(2);
  });

  it('para ao atingir a quantidade pedida, sem buscas a mais', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 12 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const done = await t.service.get(ctx, research.id);
    expect(done).toMatchObject({ status: 'done', stopReason: 'count_reached', foundCount: 12 });
    expect(done.finishedAt).not.toBeNull();
    expect(t.queries.length).toBeLessThanOrEqual(10);
    expect(await t.worker.tick()).toBe(false);
  });

  it('sem LIA que cubra: a pessoa fica guardada sem base para abordagem, por 90 dias', async () => {
    const t = setup({ lia: [] });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 4 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const person = (await t.service.listItems(ctx, research.id)).find(
      (item) => item.kind === 'person',
    );
    expect(person?.approachable).toBe(false);
    const [stored] = t.repository.people();
    expect(stored?.liaVersion).toBeNull();
    const days = (Date.parse(stored!.retentionUntil) - Date.parse(stored!.verifiedAt)) / 86_400_000;
    expect(days).toBe(90);
  });

  it('LIA que deixa de cobrir entre a leitura e a escrita: grava sem base, não derruba o lote', async () => {
    const t = setup();
    t.repository.failNextLia();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 4 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const people = t.repository.people();
    expect(people[0]?.liaVersion).toBeNull();
    expect((await t.service.get(ctx, research.id)).status).toBe('done');
  });

  it('pessoa suprimida ou com opt-out não entra de novo em lista nenhuma', async () => {
    const t = setup();
    const hash = createPersonKeyHasher('segredo-de-teste');
    const identity = normalizeIdentity(`${syntheticName(0)}|SP|terapeuta ocupacional`);
    t.repository.suppress('identity', await hash(identity));
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 6 terapeutas ocupacionais em SP',
    });
    await t.worker.tick();
    const after = await t.service.get(ctx, research.id);
    expect(after.progress.discarded.suppressed).toBe(1);
    const names = (await t.service.listItems(ctx, research.id)).map((item) => item.name);
    expect(names).not.toContain(syntheticName(0));
  });

  it('sem o segredo das pessoas: só clínicas são guardadas; as pessoas são contadas', async () => {
    const t = setup({ personKey: false });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 4 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const after = await t.service.get(ctx, research.id);
    expect(after.progress.peopleNotStored).toBeGreaterThan(0);
    expect(t.repository.people()).toHaveLength(0);
    expect(
      (await t.service.listItems(ctx, research.id)).every((item) => item.kind === 'organization'),
    ).toBe(true);
  });

  it('buscador fora do ar: grava o que rodou e a mesma tarefa volta depois da espera', async () => {
    const t = setup({
      failures: {
        3: {
          ok: false,
          failure: 'unavailable',
          message: 'Não consegui pesquisar agora.',
          provider: 'tavily',
          retryAfterSeconds: null,
        },
      },
    });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    await t.worker.tick();
    const paused = await t.service.get(ctx, research.id);
    expect(paused.status).toBe('running');
    expect(paused.progress.batches).toBe(0);
    expect(paused.progress.queriesDone).toBe(2);
    expect(paused.progress.lastError).toMatch(/Não consegui/);
    // Ainda na espera: nada roda.
    expect(await t.worker.tick()).toBe(false);
    t.advance(61);
    expect(await t.worker.tick()).toBe(true);
    const resumed = await t.service.get(ctx, research.id);
    expect(resumed.progress.batches).toBe(1);
    expect(resumed.progress.queriesDone).toBe(7);
    // Nenhuma consulta repetida.
    expect(new Set(t.queries).size).toBe(t.queries.length);
  });

  it('orçamento do mês acaba no meio: conclui com o motivo, sem inventar resultado', async () => {
    const t = setup({
      failures: {
        2: {
          ok: false,
          failure: 'budget_exhausted',
          message: 'O orçamento de pesquisas deste mês acabou.',
          provider: null,
          retryAfterSeconds: null,
        },
      },
    });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    await t.runAll();
    expect(await t.service.get(ctx, research.id)).toMatchObject({
      status: 'done',
      stopReason: 'budget_exhausted',
      foundCount: 2,
    });
  });
});

describe('pesquisa extensa: mudanças na mesma conversa (Parte 6.3)', () => {
  it('"agora priorize SP e MG" depois de um lote: o que rodou fica, o pendente muda de ordem', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    await t.worker.tick();
    const before = await t.service.get(ctx, research.id);
    const { research: revised, change } = await t.service.revise(ctx, {
      researchId: research.id,
      request: 'Agora priorize São Paulo e Minas Gerais.',
    });
    expect(change).toMatch(/SP, MG/);
    expect(revised.version).toBe(2);
    expect(revised.criteria.priorityUfs).toEqual(['SP', 'MG']);
    expect(revised.plan.queries.slice(0, 5)).toEqual(before.plan.queries.slice(0, 5));
    expect(revised.revisions).toHaveLength(1);
    expect(revised.foundCount).toBe(before.foundCount);

    // A tarefa da versão velha sai da fila sem buscar nada; a da versão nova roda o lote.
    await t.worker.tick();
    expect(t.queries).toHaveLength(5);
    await t.worker.tick();
    const next = t.queries.slice(5, 10);
    expect(next).toHaveLength(5);
    expect(next.every((query) => / (SP|MG)$/.test(query))).toBe(true);
    // Uma cadeia só de lotes: a tarefa da versão velha não roda junto.
    const progressed = await t.service.get(ctx, research.id);
    expect(progressed.progress.batches).toBe(2);
    expect(await t.worker.tick()).toBe(true);
    expect((await t.service.get(ctx, research.id)).progress.batches).toBe(3);
  });

  it('"mais 50" numa pesquisa concluída reabre e continua de onde parou', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 6 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    expect((await t.service.get(ctx, research.id)).status).toBe('done');
    const { research: reopened } = await t.service.revise(ctx, {
      researchId: research.id,
      request: 'mais 4',
    });
    expect(reopened).toMatchObject({ status: 'queued', requestedCount: 10, finishedAt: null });
    await t.runAll();
    expect(await t.service.get(ctx, research.id)).toMatchObject({
      status: 'done',
      foundCount: 10,
      stopReason: 'count_reached',
    });
    // Só a prioridade numa pesquisa que já atingiu a quantidade: guarda, não reabre.
    const priority = await t.service.revise(ctx, {
      researchId: research.id,
      request: 'agora priorize o PR',
    });
    expect(priority.research).toMatchObject({ status: 'done', criteria: { priorityUfs: ['PR'] } });
    expect(priority.change).toMatch(/já foi atingida/);
  });

  it('"pare a pesquisa" cancela, e o lote que estava rodando não desfaz o cancelamento', async () => {
    let cancelDuring: (() => Promise<void>) | null = null;
    const t = setup({
      onSearch: async (call) => {
        if (call === 2 && cancelDuring) await cancelDuring();
      },
    });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    cancelDuring = async () => {
      const result = await t.service.revise(ctx, {
        researchId: research.id,
        request: 'pode parar a pesquisa',
      });
      expect(result.cancelled).toBe(true);
    };
    await t.worker.tick();
    const cancelled = await t.service.get(ctx, research.id);
    expect(cancelled).toMatchObject({ status: 'cancelled', stopReason: 'cancelled' });
    expect(await t.worker.tick()).toBe(false);
    await expect(
      t.service.revise(ctx, { researchId: research.id, request: 'mais 10' }),
    ).rejects.toMatchObject({ reason: 'research_cancelled' });
  });

  it('mudança que não se entende vira erro explicado, sem gravar nada', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    const error = await t.service
      .revise(ctx, { researchId: research.id, request: 'obrigado!' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect((await t.service.get(ctx, research.id)).version).toBe(1);
    expect(t.service.isRevision('agora só no Paraná', research)).toBe(true);
    expect(t.service.isRevision('obrigado!', research)).toBe(false);
    expect(await t.service.latestForThread(ctx, THREAD_ID)).toMatchObject({ id: research.id });
  });
});

describe('pesquisa extensa: exportação', () => {
  it('baixar os resultados fica na auditoria, com a contagem e sem os dados', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    await t.runAll(1);
    const { items } = await t.service.exportItems(ctx, research.id);
    expect(items.length).toBeGreaterThan(0);
    const [entry] = await t.audit.listRecent(1);
    expect(entry).toMatchObject({
      action: 'copilot.research.exported',
      entityId: research.id,
      diff: { format: 'csv', rows: items.length },
    });
    expect(JSON.stringify(entry?.diff)).not.toMatch(/Pessoa/);
  });
});

describe('pesquisa extensa: turno do Copiloto (Parte 6.2)', () => {
  it('pedido de pesquisa cria e responde com premissas, plano e o link, sem nomes de pessoas', async () => {
    const t = setup();
    const turn = await runResearchTurn(ctx, t.service, {
      threadId: THREAD_ID,
      message: BLUMMY_REQUEST,
    });
    expect(turn).toMatchObject({
      status: 'ok',
      call: { name: RESEARCH_TOOL_NAME, arguments: { acao: 'iniciar' } },
      refs: [{ kind: 'research', label: 'Ver a pesquisa' }],
    });
    expect(turn?.answer).toMatch(/Vou pesquisar 100 terapeutas ocupacionais para Blummy/);
    expect(turn?.answer).toMatch(/Premissas que adotei/);
    expect(turn?.answer).toMatch(/Nada é enviado a ninguém/);
    expect(turn?.summary.length).toBeLessThanOrEqual(500);
  });

  it('pergunta comum segue para o modelo; pedido seguinte muda a pesquisa da conversa', async () => {
    const t = setup();
    expect(
      await runResearchTurn(ctx, t.service, {
        threadId: THREAD_ID,
        message: 'O que é terapia ocupacional?',
      }),
    ).toBeNull();
    await runResearchTurn(ctx, t.service, { threadId: THREAD_ID, message: BLUMMY_REQUEST });
    await t.runAll(1);
    const revised = await runResearchTurn(ctx, t.service, {
      threadId: THREAD_ID,
      message: 'agora priorize SP e MG',
    });
    expect(revised).toMatchObject({ status: 'ok', call: { arguments: { acao: 'mudar' } } });
    expect(revised?.answer).toMatch(/Pesquisa atualizada/);
    expect(revised?.research?.criteria.priorityUfs).toEqual(['SP', 'MG']);
    // Depois de uma pesquisa na conversa, uma pergunta comum ainda vai para o modelo.
    expect(
      await runResearchTurn(ctx, t.service, { threadId: THREAD_ID, message: 'obrigado!' }),
    ).toBeNull();
  });

  it('"continue" com a pesquisa rodando não muda nada; "pare" cancela e explica', async () => {
    const t = setup();
    await runResearchTurn(ctx, t.service, { threadId: THREAD_ID, message: BLUMMY_REQUEST });
    const resumed = await runResearchTurn(ctx, t.service, {
      threadId: THREAD_ID,
      message: 'continue a pesquisa',
    });
    expect(resumed?.research?.version).toBe(1);
    expect(resumed?.answer).toMatch(/já está em andamento/);
    const stopped = await runResearchTurn(ctx, t.service, {
      threadId: THREAD_ID,
      message: 'pare a pesquisa',
    });
    expect(stopped?.research?.status).toBe('cancelled');
    expect(stopped?.answer).toMatch(/Pesquisa cancelada/);
  });

  it('erro de regra vira turno com a mensagem, não exceção', async () => {
    const t = setup({ search: 'disabled' });
    const turn = await runResearchTurn(ctx, t.service, {
      threadId: THREAD_ID,
      message: BLUMMY_REQUEST,
    });
    expect(turn).toMatchObject({ status: 'error', refs: [], research: null });
    expect(turn?.answer.length).toBeGreaterThan(10);
  });
});

describe('pesquisa extensa: revisões de conformidade, segurança e arquitetura (2026-11-27)', () => {
  it('chave das pessoas diferente da que gravou o banco: nenhuma pessoa é guardada', async () => {
    const t = setup();
    // Outra chave já fixou a impressão no banco.
    await t.repository.ensurePeopleKeyCheck('f'.repeat(64));
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 4 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const after = await t.service.get(ctx, research.id);
    expect(after.progress.keyMismatch).toBe(true);
    expect(after.progress.peopleNotStored).toBeGreaterThan(0);
    expect(t.repository.people()).toHaveLength(0);
  });

  it('a primeira chave fixa a impressão; a mesma chave continua gravando pessoas', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 4 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const fingerprint = await createPersonKeyHasher('segredo-de-teste')(
      'prospector:people-key-check:v1',
    );
    expect(await t.repository.ensurePeopleKeyCheck('0'.repeat(64))).toBe(fingerprint);
    expect((await t.service.get(ctx, research.id)).progress.keyMismatch).toBe(false);
    expect(t.repository.people().length).toBeGreaterThan(0);
  });

  it('variação da identidade (sem a UF) também suprime', async () => {
    const t = setup();
    const hash = createPersonKeyHasher('segredo-de-teste');
    t.repository.suppress(
      'identity',
      await hash(normalizeIdentity(`${syntheticName(0)}||terapeuta ocupacional`)),
    );
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 6 terapeutas ocupacionais em SP',
    });
    await t.worker.tick();
    expect((await t.service.get(ctx, research.id)).progress.discarded.suppressed).toBe(1);
    const names = (await t.service.listItems(ctx, research.id)).map((item) => item.name);
    expect(names).not.toContain(syntheticName(0));
  });

  it('organização com o domínio suprimido no Relacionamento fica de fora', async () => {
    const t = setup();
    t.repository.suppressDomain('clinica-0.test');
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 6 terapeutas ocupacionais em SP',
    });
    await t.worker.tick();
    const after = await t.service.get(ctx, research.id);
    expect(after.progress.discarded.suppressed).toBe(1);
    const items = await t.service.listItems(ctx, research.id);
    expect(items.some((item) => item.website?.includes('clinica-0.test'))).toBe(false);
    expect(items.some((item) => item.kind === 'organization')).toBe(true);
  });

  it('opt-out pela tela: definitivo, sem contato, fora da planilha e com as variações suprimidas', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 6 terapeutas ocupacionais em SP',
    });
    await t.worker.tick();
    const person = (await t.service.listItems(ctx, research.id)).find(
      (item) => item.kind === 'person',
    )!;
    await t.service.optOutPerson(ctx, { researchId: research.id, itemId: person.id });
    const after = (await t.service.listItems(ctx, research.id)).find(
      (item) => item.id === person.id,
    );
    expect(after).toMatchObject({ optedOut: true, approachable: false, publicEmail: null });
    expect(after?.sourceQuote).toBe(person.name);
    const { items } = await t.service.exportItems(ctx, research.id);
    expect(items.map((item) => item.id)).not.toContain(person.id);
    const hash = createPersonKeyHasher('segredo-de-teste');
    const variant = await hash(normalizeIdentity(`${person.name}||terapeuta ocupacional`));
    expect(await t.repository.isSuppressed([{ kind: 'identity', valueHash: variant }])).toBe(true);
    const actions = (await t.audit.listRecent(10)).map((entry) => entry.action);
    expect(actions).toContain('copilot.research.person_opted_out');
    await expect(
      t.service.optOutPerson(ctx, {
        researchId: research.id,
        itemId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('abordável é conferido de novo a cada leitura: LIA revogada depois tira a cobertura', async () => {
    const options: SetupOptions = {};
    const t = setup(options);
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: 'Encontre 4 terapeutas ocupacionais em SP',
    });
    await t.runAll();
    const before = (await t.service.listItems(ctx, research.id)).find(
      (item) => item.kind === 'person',
    );
    expect(before).toMatchObject({ approachable: true, liaVersion: 2 });
    options.lia = [{ ...APPROVED_LIA, revokedAt: '2026-11-26T13:00:00.000Z' }];
    const after = (await t.service.listItems(ctx, research.id)).find(
      (item) => item.kind === 'person',
    );
    expect(after).toMatchObject({ approachable: false, liaVersion: 2 });
  });

  it('a mesma tarefa rodando duas vezes ao mesmo tempo: o segundo lote não grava por cima', async () => {
    let nested: (() => Promise<void>) | null = null;
    const t = setup({
      onSearch: async (call) => {
        if (call === 1 && nested) await nested();
      },
    });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    const job = {
      id: '44444444-4444-4444-8444-444444444444',
      payload: { researchId: research.id, version: 1, batch: 0 },
      attempts: 1,
      maxAttempts: 3,
      traceId: ctx.traceId,
    } as unknown as Parameters<typeof t.service.jobHandler.run>[0];
    nested = async () => {
      const inner = nested;
      nested = null;
      if (!inner) return;
      expect(await t.service.jobHandler.run(job, new AbortController().signal)).toEqual({
        status: 'succeeded',
      });
    };
    expect(await t.service.jobHandler.run(job, new AbortController().signal)).toEqual({
      status: 'succeeded',
    });
    const after = await t.service.get(ctx, research.id);
    expect(after.progress.batches).toBe(1);
  });

  it('falha passageira até a última tentativa: a pesquisa termina como falha, com a causa', async () => {
    const down: WebSearchOutcome = {
      ok: false,
      failure: 'unavailable',
      message: 'Não consegui pesquisar agora.',
      provider: 'tavily',
      retryAfterSeconds: null,
    };
    const t = setup({ failures: { 1: down, 2: down, 3: down } });
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await t.worker.tick();
      t.advance(120);
    }
    const failed = await t.service.get(ctx, research.id);
    expect(failed).toMatchObject({ status: 'failed', stopReason: null });
    expect(failed.progress.lastError).toMatch(/Não consegui/);
    expect(await t.worker.tick()).toBe(false);

    // Retomar pela tela reabre de onde parou.
    const { research: resumed, change } = await t.service.resume(ctx, { researchId: research.id });
    expect(resumed).toMatchObject({ status: 'queued', version: 2 });
    expect(change).toMatch(/retomada/);
    await t.worker.tick();
    expect((await t.service.get(ctx, research.id)).progress.batches).toBe(1);
  });

  it('abandono de tarefa velha não derruba a pesquisa atual; a atual sem causa ganha o texto padrão', async () => {
    const t = setup();
    const { research } = await t.service.start(ctx, {
      threadId: THREAD_ID,
      request: BLUMMY_REQUEST,
    });
    const job = (payload: Record<string, unknown>) =>
      ({ payload, attempts: 3, maxAttempts: 3, traceId: ctx.traceId }) as unknown as Parameters<
        typeof t.service.jobHandler.abandon
      >[0];
    await t.service.jobHandler.abandon(job({ researchId: research.id, version: 7, batch: 0 }));
    expect((await t.service.get(ctx, research.id)).status).toBe('queued');
    await t.service.jobHandler.abandon(job({ researchId: research.id, version: 1, batch: 0 }));
    const failed = await t.service.get(ctx, research.id);
    expect(failed.status).toBe('failed');
    expect(failed.progress.lastError).toMatch(/falha repetida/);
  });

  it('sem as tabelas da pesquisa, a conversa segue para o modelo em vez de falhar', async () => {
    const t = setup();
    const broken = {
      ...t.service,
      latestForThread: async () => {
        throw new Error('relation "copilot_research" does not exist');
      },
    };
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(
        await runResearchTurn(ctx, broken, { threadId: THREAD_ID, message: 'agora só no Paraná' }),
      ).toBeNull();
    } finally {
      console.warn = warn;
    }
  });

  it('cancelamento sem nada achado: texto no singular ou plural certo', async () => {
    const t = setup();
    await runResearchTurn(ctx, t.service, { threadId: THREAD_ID, message: BLUMMY_REQUEST });
    const stopped = await runResearchTurn(ctx, t.service, {
      threadId: THREAD_ID,
      message: 'pare a pesquisa',
    });
    expect(stopped?.answer).toMatch(/Nenhum resultado tinha sido achado/);
  });
});
