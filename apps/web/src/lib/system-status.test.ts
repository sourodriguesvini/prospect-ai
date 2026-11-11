import type { AiRuntimeStatus, LoadedModel } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  buildSystemStatus,
  databaseIndicator,
  localAiIndicator,
  SystemStatusView,
  webSearchIndicator,
} from './system-status';

const online = (loaded: LoadedModel[] | null) =>
  ({
    state: 'online',
    provider: 'ollama',
    version: '0.40.15',
    installed: [],
    loaded,
    routing: [],
    gpu: null,
    limits: { maxConcurrent: 1, maxQueue: 2 },
  }) as unknown as AiRuntimeStatus;

describe('IA local', () => {
  it('no ar, com o modelo carregado na dica', () => {
    const indicator = localAiIndicator(
      online([
        {
          name: 'qwen3.5:4b',
          sizeBytes: 1,
          vramBytes: 1,
          expiresAt: null,
          contextLength: null,
        },
      ]),
    );
    expect(indicator).toMatchObject({ value: 'No ar', tone: 'success', href: '/copiloto' });
    expect(indicator.detail).toBe('qwen3.5:4b na memória.');
  });

  it('no ar sem modelo carregado', () => {
    expect(localAiIndicator(online([])).detail).toBe('Ollama 0.40.15, nenhum modelo na memória.');
  });

  it('fora do ar orienta a abrir o Ollama', () => {
    const indicator = localAiIndicator({
      state: 'offline',
      provider: 'ollama',
      code: 'runtime_unavailable',
      message: 'x',
      gpu: null,
    } as AiRuntimeStatus);
    expect(indicator).toMatchObject({ value: 'Fora do ar', tone: 'warning' });
    expect(indicator.detail).toContain('Abra pelo menu Iniciar');
  });

  it('outro erro mostra a mensagem do serviço, sem inventar o motivo', () => {
    const message = 'A configuração da IA local é inválida. Confira as variáveis AI_*.';
    const indicator = localAiIndicator({
      state: 'offline',
      provider: 'ollama',
      code: 'invalid_config',
      message,
      gpu: null,
    } as AiRuntimeStatus);
    expect(indicator).toMatchObject({ value: 'Fora do ar', tone: 'warning', detail: message });
  });

  it('sem leitura não afirma nada', () => {
    expect(localAiIndicator(null)).toMatchObject({ value: 'Não conferido', tone: 'neutral' });
  });
});

describe('pesquisa na internet', () => {
  const usage = (creditsUsed: number, creditsBudget = 1000) => ({
    search: 'enabled' as const,
    usage: {
      period: '2026-11',
      provider: 'tavily' as const,
      creditsUsed,
      creditsBudget,
      creditsRemaining: Math.max(0, creditsBudget - creditsUsed),
    },
  });

  it('mostra o consumo do mês', () => {
    const indicator = webSearchIndicator(usage(12));
    expect(indicator).toMatchObject({ value: '12/1.000', tone: 'success' });
    expect(indicator.detail).toBe('12 de 1.000 créditos da Tavily usados em novembro.');
  });

  it('avisa quando restam menos de 10% e quando acabou', () => {
    expect(webSearchIndicator(usage(950)).tone).toBe('warning');
    expect(webSearchIndicator(usage(1000))).toMatchObject({
      value: 'Sem créditos',
      tone: 'danger',
    });
  });

  it('sem chave, desligada e sem banco', () => {
    expect(webSearchIndicator({ search: 'not_configured', usage: null }).value).toBe('Sem chave');
    expect(webSearchIndicator({ search: 'disabled', usage: null }).value).toBe('Desligada');
    expect(webSearchIndicator('unavailable').value).toBe('Sem banco');
    expect(webSearchIndicator(null).value).toBe('Não conferido');
  });

  it('no modo memória explica que falta o banco', () => {
    expect(webSearchIndicator({ search: 'disabled', usage: null }, 'memory')).toMatchObject({
      value: 'Sem banco',
      tone: 'neutral',
    });
  });
});

describe('banco', () => {
  it('usa os mesmos rótulos do cartão do Início', () => {
    expect(databaseIndicator('ok')).toMatchObject({ value: 'Conectado', tone: 'success' });
    expect(databaseIndicator('not_configured')).toMatchObject({
      value: 'Não configurado',
      tone: 'warning',
    });
    expect(databaseIndicator('unreachable').tone).toBe('danger');
    expect(databaseIndicator(null).value).toBe('Não conferido');
  });
});

describe('buildSystemStatus', () => {
  it('três indicadores na ordem IA local, pesquisa, banco', () => {
    const view = buildSystemStatus({
      database: 'memory',
      localAi: null,
      research: 'unavailable',
      now: new Date('2026-11-11T12:00:00Z'),
    });
    expect(view.checkedAt).toBe('2026-11-11T12:00:00.000Z');
    expect(view.indicators.map((item) => item.id)).toEqual(['ia-local', 'pesquisa', 'banco']);
    expect(JSON.stringify(view)).not.toMatch(/SUPABASE_SECRET|tvly-/);
    // O que a rota monta passa no contrato que o menu confere.
    expect(SystemStatusView.safeParse(view).success).toBe(true);
  });
});
