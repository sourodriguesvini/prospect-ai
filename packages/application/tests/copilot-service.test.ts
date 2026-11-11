import type { CopilotStoredMessage } from '@prospector/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createCopilotService,
  historyFromMessages,
  type CopilotService,
  type RequestContext,
} from '../src';
import { createMemoryAuditRepository, createMemoryCopilotRepository } from '../src/memory';

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '5b0f6c1d-2e3f-4a5b-8c6d-7e8f9a0b1c2d',
};
const ask = (message: string, threadId: string | null = null) => ({
  schemaVersion: 2 as const,
  threadId,
  message,
  think: false,
});

describe('CopilotService (IA-2)', () => {
  let now: Date;
  let audit: ReturnType<typeof createMemoryAuditRepository>;
  let repo: ReturnType<typeof createMemoryCopilotRepository>;
  let service: CopilotService;
  const actions = () => audit.entries().map((entry) => entry.action);

  beforeEach(() => {
    now = new Date('2026-11-10T12:00:00Z');
    const clock = { now: () => now };
    audit = createMemoryAuditRepository({ clock });
    repo = createMemoryCopilotRepository({ audit, clock });
    service = createCopilotService({ repo, telemetry: repo });
  });

  it('a primeira pergunta cria a conversa com título, auditoria e só a pergunta no histórico', async () => {
    const opened = await service.openTurn(ctx, ask('Quais ofertas eu tenho hoje?'));
    expect(opened.created).toBe(true);
    expect(opened.thread.title).toBe('Quais ofertas eu tenho hoje?');
    expect(opened.history).toEqual([{ role: 'user', content: 'Quais ofertas eu tenho hoje?' }]);
    expect(actions()).toEqual(['copilot.thread.create']);
    expect(audit.entries()[0]).toMatchObject({
      entityType: 'copilot_thread',
      traceId: ctx.traceId,
    });
    // O diff da auditoria não leva o conteúdo da conversa (KI-015).
    expect(JSON.stringify(audit.entries()[0]?.diff)).not.toContain('ofertas');
  });

  it('a pergunta seguinte recebe o histórico do banco, sem resultados de ferramenta', async () => {
    const first = await service.openTurn(ctx, ask('Quais ofertas eu tenho?'));
    const threadId = first.thread.id;
    await service.saveToolResult(ctx, {
      threadId,
      call: { id: 'c1', name: 'list_offers', arguments: {} },
      status: 'ok',
      summary: '1 oferta: 1 ativa.',
    });
    await service.saveAnswer(ctx, {
      threadId,
      content: 'Você tem 1 oferta ativa.',
      status: 'complete',
      model: 'qwen3.5:4b',
      promptVersion: 'copilot-tools/v1',
      toolCalls: [{ id: 'c1', name: 'list_offers', arguments: {} }],
      errorCode: null,
      usage: null,
    });

    const second = await service.openTurn(ctx, ask('E qual é o preço?', threadId));
    expect(second.created).toBe(false);
    expect(second.history).toEqual([
      { role: 'user', content: 'Quais ofertas eu tenho?' },
      { role: 'assistant', content: 'Você tem 1 oferta ativa.' },
      { role: 'user', content: 'E qual é o preço?' },
    ]);

    const conversation = await service.conversation(ctx, threadId);
    expect(conversation?.messages.map((message) => message.role)).toEqual([
      'user',
      'tool',
      'assistant',
      'user',
    ]);
    expect(conversation?.messages[1]).toMatchObject({
      toolName: 'list_offers',
      toolCallId: 'c1',
      toolStatus: 'ok',
    });
    // A contagem mostrada na lista é de falas (pergunta e resposta), como na view do banco.
    expect(conversation?.thread.messageCount).toBe(3);
  });

  it('conversa inexistente: openTurn lança not_found e conversation devolve null', async () => {
    const missing = '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f';
    await expect(service.openTurn(ctx, ask('oi', missing))).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await service.conversation(ctx, missing)).toBeNull();
    expect(await service.conversation(ctx, 'não é uuid')).toBeNull();
  });

  it('renomear, arquivar e voltar a conversar: tudo auditado; arquivada sai da lista', async () => {
    const { thread } = await service.openTurn(ctx, ask('oi'));
    await service.rename(ctx, { threadId: thread.id, title: '  Ofertas de 2026  ' });
    expect((await service.conversation(ctx, thread.id))?.thread.title).toBe('Ofertas de 2026');

    await service.setArchived(ctx, thread.id, true);
    expect(await service.listThreads(ctx)).toEqual([]);
    expect((await service.listThreads(ctx, { archived: true })).map((t) => t.id)).toEqual([
      thread.id,
    ]);

    // Continuar uma conversa arquivada a traz de volta.
    await service.openTurn(ctx, ask('voltei', thread.id));
    expect((await service.listThreads(ctx)).map((t) => t.id)).toEqual([thread.id]);
    expect(actions()).toEqual([
      'copilot.thread.create',
      'copilot.thread.rename',
      'copilot.thread.archive',
      'copilot.thread.unarchive',
    ]);
  });

  it('valida o título e recusa conversa que não existe', async () => {
    const { thread } = await service.openTurn(ctx, ask('oi'));
    const invalid = await service
      .rename(ctx, { threadId: thread.id, title: '   ' })
      .catch((error: unknown) => error);
    expect(invalid).toBeInstanceOf(AppError);
    expect((invalid as AppError).code).toBe('validation');
    await expect(
      service.rename(ctx, { threadId: '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f', title: 'x' }),
    ).rejects.toMatchObject({ code: 'not_found' });
    await expect(service.setArchived(ctx, 'abc', true)).rejects.toMatchObject({
      code: 'validation',
    });
  });

  it('lista as conversas pela última atividade', async () => {
    const older = await service.openTurn(ctx, ask('primeira'));
    now = new Date('2026-11-10T12:05:00Z');
    const newer = await service.openTurn(ctx, ask('segunda'));
    now = new Date('2026-11-10T12:10:00Z');
    await service.openTurn(ctx, ask('de novo na primeira', older.thread.id));
    const ids = (await service.listThreads(ctx)).map((thread) => thread.id);
    expect(ids).toEqual([older.thread.id, newer.thread.id]);
  });

  it('telemetria: cada geração vira uma linha de llm_calls, e o resumo soma o uso', async () => {
    await service.recordGeneration(ctx, {
      threadId: null,
      model: 'qwen3.5:4b',
      promptVersion: 'copilot-tools/v1',
      status: 'ok',
      errorCode: null,
      doneReason: 'stop',
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalMs: 900,
        loadMs: 0,
        outputTokensPerSecond: 25,
      },
    });
    await service.recordGeneration(ctx, {
      threadId: null,
      model: '',
      promptVersion: null,
      status: 'error',
      errorCode: 'timeout',
      doneReason: null,
      usage: null,
    });
    expect(repo.llmCalls().map((call) => [call.model, call.status])).toEqual([
      ['qwen3.5:4b', 'ok'],
      ['desconhecido', 'error'],
    ]);
    const usage = await service.usageSince(ctx, new Date('2026-11-01T00:00:00Z'));
    expect(usage).toMatchObject({ generations: 2, failed: 1, cancelled: 0, outputTokens: 20 });
    expect(usage.byModel).toEqual([
      { model: 'qwen3.5:4b', generations: 1, outputTokens: 20 },
      { model: 'desconhecido', generations: 1, outputTokens: 0 },
    ]);
  });
});

describe('historyFromMessages', () => {
  const base = {
    threadId: '11111111-1111-4111-8111-111111111111',
    status: 'complete' as const,
    model: null,
    promptVersion: null,
    traceId: 't',
    toolCalls: null,
    toolCallId: null,
    toolName: null,
    toolStatus: null,
    errorCode: null,
    usage: null,
    createdAt: '2026-11-10T12:00:00Z',
  };
  const message = (role: CopilotStoredMessage['role'], content: string): CopilotStoredMessage => ({
    ...base,
    id: crypto.randomUUID(),
    role,
    content,
  });

  it('tira ferramentas e falas vazias, corta mensagens longas e começa pelo usuário', () => {
    const history = historyFromMessages([
      message('assistant', 'sobrou de antes'),
      message('user', 'pergunta'),
      message('tool', '1 oferta'),
      message('assistant', ''),
      message('user', 'x'.repeat(9000)),
    ]);
    expect(history.map((item) => item.role)).toEqual(['user', 'user']);
    expect(history[1]?.content.length).toBeLessThanOrEqual(8000);
    expect(history[1]?.content.endsWith('[…]')).toBe(true);
  });

  it('fica com as 24 falas mais recentes', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      message(index % 2 === 0 ? 'user' : 'assistant', `fala ${index}`),
    );
    const history = historyFromMessages(many);
    expect(history).toHaveLength(24);
    expect(history[0]).toEqual({ role: 'user', content: 'fala 16' });
  });
});
