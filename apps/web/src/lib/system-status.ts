import type { WebResearchStatus } from '@prospector/application';
import type { AiRuntimeStatus, DatabaseStatus } from '@prospector/contracts';
import type { StatusTone } from '@prospector/ui';
import { z } from 'zod';
import { DATABASE_STATUS_VIEW } from './database-status';

/**
 * Indicadores do rodapé do menu lateral: IA local, pesquisa na internet e banco. Montados no
 * servidor (rota /api/estado) a partir do que os serviços já informam; o navegador só exibe.
 * Nada sensível: nenhum valor de variável, chave ou dado de empresa. O contrato vale nos dois
 * lados (rota e menu), como na rota do Copiloto.
 */
const TONES = [
  'success',
  'warning',
  'danger',
  'neutral',
  'accent',
] as const satisfies readonly StatusTone[];

export const StatusIndicator = z.object({
  id: z.enum(['ia-local', 'pesquisa', 'banco']),
  label: z.string(),
  /** Valor curto, ao lado do rótulo. */
  value: z.string(),
  /** Frase de apoio, na dica e na descrição acessível. */
  detail: z.string(),
  tone: z.enum(TONES),
  /** Tela onde dá para ver mais ou resolver (link interno). */
  href: z.string().startsWith('/'),
});
export type StatusIndicator = z.infer<typeof StatusIndicator>;

export const SystemStatusView = z.object({
  checkedAt: z.iso.datetime(),
  indicators: z.array(StatusIndicator),
});
export type SystemStatusView = z.infer<typeof SystemStatusView>;

/** O que a rota recebe dos serviços (falha de leitura vira null: "não deu para conferir"). */
export interface SystemStatusInput {
  database: DatabaseStatus | null;
  localAi: AiRuntimeStatus | null;
  /** "unavailable": o app não tem o serviço de pesquisa (sem banco). */
  research: Pick<WebResearchStatus, 'search' | 'usage'> | 'unavailable' | null;
  now: Date;
}

const UNKNOWN = 'Não conferido';

const integer = new Intl.NumberFormat('pt-BR');
const month = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' });

/** "2026-11" → "novembro". */
function monthName(period: string): string {
  const [year, mm] = period.split('-').map(Number);
  if (!year || !mm) return period;
  return month.format(new Date(Date.UTC(year, mm - 1, 1)));
}

export function localAiIndicator(status: AiRuntimeStatus | null): StatusIndicator {
  const base = { id: 'ia-local' as const, label: 'IA local', href: '/copiloto' };
  if (!status) {
    return {
      ...base,
      value: UNKNOWN,
      detail: 'Não foi possível conferir o Ollama.',
      tone: 'neutral',
    };
  }
  if (status.state === 'offline') {
    return {
      ...base,
      value: 'Fora do ar',
      // A mensagem do serviço já vem em pt-BR e sem valores de variáveis (AiErrorCode); só o
      // caso mais comum ganha a orientação de como resolver.
      detail:
        status.code === 'runtime_unavailable'
          ? 'O Ollama não está aberto. Abra pelo menu Iniciar.'
          : status.message,
      tone: 'warning',
    };
  }
  const loaded = status.loaded;
  const detail =
    loaded === null
      ? `Ollama ${status.version} respondendo.`
      : loaded.length === 0
        ? `Ollama ${status.version}, nenhum modelo na memória.`
        : `${loaded.map((model) => model.name).join(', ')} na memória.`;
  return { ...base, value: 'No ar', detail, tone: 'success' };
}

export function webSearchIndicator(
  research: SystemStatusInput['research'],
  database: DatabaseStatus | null = null,
): StatusIndicator {
  const base = { id: 'pesquisa' as const, label: 'Pesquisa na internet', href: '/copiloto' };
  if (research === null) {
    return {
      ...base,
      value: UNKNOWN,
      detail: 'Não foi possível ler o consumo da pesquisa na internet.',
      tone: 'neutral',
    };
  }
  // No modo memória o serviço existe, mas fica desligado pelo mesmo motivo: falta o banco.
  if (research === 'unavailable' || (research.search === 'disabled' && database === 'memory')) {
    return {
      ...base,
      value: 'Sem banco',
      detail: 'A pesquisa na internet precisa do banco configurado para contar os créditos.',
      tone: 'neutral',
    };
  }
  if (research.search === 'not_configured') {
    return {
      ...base,
      value: 'Sem chave',
      detail: 'Defina TAVILY_API_KEY em apps/web/.env.local para ligar a pesquisa.',
      tone: 'neutral',
    };
  }
  if (research.search === 'disabled') {
    return {
      ...base,
      value: 'Desligada',
      detail: 'Pesquisa na internet desligada.',
      tone: 'neutral',
    };
  }
  const usage = research.usage;
  if (!usage) {
    return { ...base, value: 'Ligada', detail: 'Pesquisa na internet ligada.', tone: 'success' };
  }
  const used = integer.format(usage.creditsUsed);
  const budget = integer.format(usage.creditsBudget);
  const detail = `${used} de ${budget} créditos da Tavily usados em ${monthName(usage.period)}.`;
  if (usage.creditsRemaining === 0) {
    return { ...base, value: 'Sem créditos', detail, tone: 'danger' };
  }
  const low = usage.creditsRemaining < usage.creditsBudget * 0.1;
  return { ...base, value: `${used}/${budget}`, detail, tone: low ? 'warning' : 'success' };
}

export function databaseIndicator(status: DatabaseStatus | null): StatusIndicator {
  const base = { id: 'banco' as const, label: 'Banco', href: '/' };
  if (!status) {
    return {
      ...base,
      value: UNKNOWN,
      detail: 'Não foi possível conferir o banco.',
      tone: 'neutral',
    };
  }
  const view = DATABASE_STATUS_VIEW[status];
  const detail =
    status === 'ok'
      ? 'O banco responde e as migrações estão aplicadas.'
      : status === 'memory'
        ? 'Dados só na memória do servidor: somem ao reiniciar.'
        : 'Veja o cartão Banco de dados no Início.';
  return { ...base, value: view.label, detail, tone: view.tone };
}

export function buildSystemStatus(input: SystemStatusInput): SystemStatusView {
  return {
    checkedAt: input.now.toISOString(),
    indicators: [
      localAiIndicator(input.localAi),
      webSearchIndicator(input.research, input.database),
      databaseIndicator(input.database),
    ],
  };
}
