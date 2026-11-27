import { DRAFT_BRANDING_RUBRIC, DRAFT_SCORING_MODEL } from '@prospector/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AppError,
  TOOL_OUTPUT_MAX_CHARS,
  createAuditService,
  createStrategyService,
  createToolRegistry,
  defineTool,
  strategyTools,
  type RequestContext,
  type ToolRegistry,
} from '../src';
import {
  createMemoryAuditRepository,
  createMemoryCopilotRepository,
  createMemoryStrategyRepository,
} from '../src/memory';
import { seedStrategyDemo } from './support/demo-seed';

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
};

describe('registro de ferramentas', () => {
  const audit = createMemoryAuditRepository();
  let telemetry: ReturnType<typeof createMemoryCopilotRepository>;
  let logs: string[];
  let registry: ToolRegistry;

  beforeEach(() => {
    telemetry = createMemoryCopilotRepository({ audit });
    logs = [];
    registry = createToolRegistry({
      telemetry,
      timeoutMs: 50,
      log: (message) => logs.push(message),
      tools: [
        defineTool({
          name: 'echo',
          title: 'Repetindo',
          description: 'Devolve o texto.',
          input: z.object({ text: z.string().max(10), times: z.number().int().min(1).default(1) }),
          kind: 'read',
          async run(_ctx, input) {
            return {
              summary: `Repetido ${input.times}x.`,
              data: { text: input.text.repeat(input.times) },
              refs: [{ kind: 'offer', id: 'x', label: 'X' }],
            };
          },
        }),
        defineTool({
          name: 'huge',
          title: 'Muito grande',
          description: 'Devolve dados demais.',
          input: z.object({}),
          kind: 'read',
          async run() {
            return { summary: 'ok', data: 'a'.repeat(TOOL_OUTPUT_MAX_CHARS * 2) };
          },
        }),
        defineTool({
          name: 'slow',
          title: 'Devagar',
          description: 'Nunca termina.',
          input: z.object({}),
          kind: 'read',
          run: () => new Promise(() => {}),
        }),
        defineTool({
          name: 'missing',
          title: 'Faltando',
          description: 'Não acha nada.',
          input: z.object({}),
          kind: 'read',
          async run() {
            throw new AppError('not_found', 'not_found');
          },
        }),
        defineTool({
          name: 'broken',
          title: 'Quebrada',
          description: 'Erro inesperado.',
          input: z.object({}),
          kind: 'read',
          async run() {
            throw new Error('detalhe interno com stack');
          },
        }),
      ],
    });
  });

  it('descreve as ferramentas com JSON Schema da entrada (sem $schema)', () => {
    const echo = registry.specs().find((spec) => spec.name === 'echo');
    expect(echo).toMatchObject({
      title: 'Repetindo',
      parameters: {
        type: 'object',
        properties: { text: { type: 'string', maxLength: 10 }, times: { type: 'integer' } },
        required: ['text'],
      },
    });
    expect(echo?.parameters).not.toHaveProperty('$schema');
  });

  it('executa com a entrada validada, devolve resumo, dados e refs e grava a telemetria', async () => {
    const { result, forModel } = await registry.execute(
      ctx,
      { id: 'c1', name: 'echo', arguments: { text: 'oi', times: 2 } },
      { threadId: null },
    );
    expect(result).toEqual({
      status: 'ok',
      summary: 'Repetido 2x.',
      data: { text: 'oioi' },
      refs: [{ kind: 'offer', id: 'x', label: 'X' }],
      errorCode: null,
    });
    expect(JSON.parse(forModel)).toEqual({
      status: 'ok',
      resumo: 'Repetido 2x.',
      dados: { text: 'oioi' },
    });
    expect(telemetry.toolCalls()).toEqual([
      expect.objectContaining({
        tool: 'echo',
        status: 'ok',
        traceId: ctx.traceId,
        inputRedacted: { text: 'oi', times: 2 },
        outputSummary: 'Repetido 2x.',
      }),
    ]);
  });

  it('ferramenta desconhecida e argumentos inválidos viram erro explicado ao modelo', async () => {
    const unknown = await registry.execute(ctx, { id: 'c', name: 'delete_all', arguments: {} });
    expect(unknown.result).toMatchObject({ status: 'error', errorCode: 'unknown_tool' });
    expect(unknown.result.summary).toContain('echo');

    const invalid = await registry.execute(ctx, {
      id: 'c',
      name: 'echo',
      arguments: { text: 'longo demais para caber' },
    });
    expect(invalid.result).toMatchObject({ status: 'error', errorCode: 'invalid_arguments' });
    expect(invalid.result.summary).toContain('text');

    const malformed = await registry.execute(ctx, {
      id: 'c',
      name: 'Nome Inválido',
      arguments: {},
    } as never);
    expect(malformed.result.errorCode).toBe('unknown_tool');
    // A telemetria guarda o nome que o modelo pediu (diagnóstico); nome fora do formato vira
    // unknown_tool.
    expect(telemetry.toolCalls().map((call) => [call.tool, call.errorCode])).toEqual([
      ['delete_all', 'unknown_tool'],
      ['echo', 'invalid_arguments'],
      ['unknown_tool', 'unknown_tool'],
    ]);
  });

  it('demora, erro de negócio e erro inesperado: nunca lança, nada interno vai para o modelo', async () => {
    const slow = await registry.execute(ctx, { id: 'c', name: 'slow', arguments: {} });
    expect(slow.result).toMatchObject({ status: 'error', errorCode: 'timeout' });

    const missing = await registry.execute(ctx, { id: 'c', name: 'missing', arguments: {} });
    expect(missing.result).toMatchObject({ status: 'error', errorCode: 'not_found' });

    const broken = await registry.execute(ctx, { id: 'c', name: 'broken', arguments: {} });
    expect(broken.result).toMatchObject({ status: 'error', errorCode: 'unexpected' });
    expect(broken.forModel).not.toContain('stack');
    expect(logs.join('\n')).toContain('detalhe interno');
  });

  it('corta o texto devolvido ao modelo no limite', async () => {
    const { forModel } = await registry.execute(ctx, { id: 'c', name: 'huge', arguments: {} });
    expect(forModel.length).toBeLessThan(TOOL_OUTPUT_MAX_CHARS + 80);
    expect(forModel).toContain('resultado cortado');
  });

  it('telemetria fora do ar não derruba a consulta', async () => {
    const failing = createToolRegistry({
      telemetry: {
        recordLlmCall: async () => {},
        recordToolCall: async () => {
          throw new Error('banco fora');
        },
        usageSince: async () => {
          throw new Error('banco fora');
        },
      },
      log: (message) => logs.push(message),
      tools: [
        defineTool({
          name: 'ping',
          title: 'Ping',
          description: 'ping',
          input: z.object({}),
          kind: 'read',
          run: async () => ({ summary: 'pong', data: null }),
        }),
      ],
    });
    const { result } = await failing.execute(ctx, { id: 'c', name: 'ping', arguments: {} });
    expect(result.status).toBe('ok');
    expect(logs.join('\n')).toContain('telemetria falhou');
  });

  it('recusa duas ferramentas com o mesmo nome', () => {
    const tool = defineTool({
      name: 'dup',
      title: 'Dup',
      description: 'dup',
      input: z.object({}),
      kind: 'read',
      run: async () => ({ summary: '', data: null }),
    });
    expect(() => createToolRegistry({ telemetry: null, tools: [tool, tool] })).toThrow();
  });
});

describe('ferramentas da estratégia', () => {
  let registry: ToolRegistry;
  let strategy: ReturnType<typeof createStrategyService>;
  let repo: ReturnType<typeof createMemoryStrategyRepository>;

  beforeEach(() => {
    const clock = { now: () => new Date('2026-11-10T12:00:00Z') };
    const auditRepo = createMemoryAuditRepository({ clock });
    repo = createMemoryStrategyRepository({ clock, audit: auditRepo });
    strategy = createStrategyService({ repo, clock });
    registry = createToolRegistry({
      telemetry: null,
      tools: strategyTools({ strategy, audit: createAuditService(auditRepo) }),
    });
  });

  const run = async (name: string, args: Record<string, unknown> = {}) =>
    (await registry.execute(ctx, { id: 'c', name, arguments: args })).result;

  it('oferece só ferramentas de leitura com nomes válidos', () => {
    expect(registry.specs().map((spec) => spec.name)).toEqual([
      'get_readiness',
      'list_offers',
      'get_offer',
      'list_icps',
      'list_proof_assets',
      'get_compliance_status',
      'list_recent_activity',
    ]);
  });

  it('sem dados: diz que não há ofertas e que a prospecção está bloqueada', async () => {
    expect(await run('list_offers')).toMatchObject({
      status: 'ok',
      summary: 'Nenhuma oferta cadastrada com esse filtro.',
      data: [],
    });
    const readiness = await run('get_readiness');
    expect(readiness.summary).toMatch(/^Descoberta bloqueada/);
  });

  it('lista e abre a oferta pelo nome, com link para a tela', async () => {
    const offer = await strategy.createOffer(ctx, {
      name: 'Identidade visual para clínicas',
      problems: ['Marca desatualizada'],
      needSignals: ['Site sem versão mobile'],
      disqualifiers: ['Rebrand recente'],
      deliverables: ['Manual de marca'],
      priceMinCents: 1_500_000,
      priceMaxCents: 4_000_000,
    });
    await strategy.saveRubric(ctx, offer.id, DRAFT_BRANDING_RUBRIC);
    await strategy.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL);

    const list = await run('list_offers');
    expect(list.summary).toBe('1 oferta: 1 em rascunho.');
    expect(list.data).toEqual([
      expect.objectContaining({
        id: offer.id,
        nome: 'Identidade visual para clínicas',
        status: 'rascunho',
        demo: false,
        preco_min: expect.stringContaining('15.000,00'),
      }),
    ]);
    expect(list.refs).toEqual([
      { kind: 'offer', id: offer.id, label: 'Identidade visual para clínicas' },
    ]);

    const opened = await run('get_offer', { offer: 'clínicas' });
    expect(opened.status).toBe('ok');
    expect(JSON.stringify(opened.data)).toContain('Manual de marca');

    expect(await run('get_offer', { offer: 'não existe' })).toMatchObject({
      status: 'error',
      errorCode: 'not_found',
    });
  });

  it('dados de demonstração saem marcados como demo', async () => {
    await seedStrategyDemo(repo);
    const list = await run('list_offers');
    expect(list.data).toEqual([expect.objectContaining({ demo: true })]);
  });

  it('conformidade: informa a LIA sem permitir aprovação pelo Copiloto', async () => {
    const result = await run('get_compliance_status');
    expect(result.status).toBe('ok');
    expect(JSON.stringify(result.data)).toContain('nenhuma LIA criada');
  });

  it('atividade recente respeita o limite', async () => {
    expect(await run('list_recent_activity', { limit: 99 })).toMatchObject({
      status: 'error',
      errorCode: 'invalid_arguments',
    });
    const empty = await run('list_recent_activity', { limit: 5 });
    expect(empty).toMatchObject({ status: 'ok', summary: 'Nenhuma ação registrada ainda.' });
    await strategy.saveVoiceGuide(ctx, { summary: 'Direta, cordial e sem jargão.' });
    await strategy.saveVoiceGuide(ctx, { summary: 'Direta e cordial.' });
    expect((await run('list_recent_activity', { limit: 5 })).summary).toBe(
      '2 ações mais recentes.',
    );
  });
});
