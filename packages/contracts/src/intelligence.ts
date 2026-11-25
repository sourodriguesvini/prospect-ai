import { z } from 'zod';

/**
 * Inteligência (D16 e F13, primeira fatia; ADR-0017): funil de prospecção com tamanho de amostra
 * e consumo do mês (IA local, créditos da Tavily e gasto em dinheiro). Aprendizados e propostas
 * de calibração ficam para quando houver desfechos suficientes (KI-181).
 *
 * O funil conta EMPRESAS DISTINTAS que passaram por cada etapa no período, pela data da própria
 * etapa. Não é uma coorte: uma empresa investigada neste mês pode ter sido encontrada no mês
 * passado. Por isso a razão entre etapas só aparece quando faz sentido (nunca acima de 100%) e
 * vem com aviso de amostra pequena.
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

export const FunnelStage = z.enum([
  'found',
  'saved',
  'investigated',
  'approached',
  'contacted',
  'replied',
  'won',
]);
export type FunnelStage = z.infer<typeof FunnelStage>;

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  found: 'Encontradas',
  saved: 'Em Empresas',
  investigated: 'Investigadas',
  approached: 'Com abordagem',
  contacted: 'Contatadas',
  replied: 'Responderam',
  won: 'Ganhas',
};

/** O que cada etapa conta, em uma frase (tela e Copiloto). */
export const FUNNEL_STAGE_HINTS: Record<FunnelStage, string> = {
  found: 'Vistas pela primeira vez numa pesquisa da Descoberta.',
  saved: 'Cadastradas em Empresas, de qualquer origem.',
  investigated: 'Com investigação concluída (completa ou parcial).',
  approached: 'Com plano de abordagem preparado no Relacionamento.',
  contacted: 'Com contato registrado a partir de mensagem aprovada.',
  replied: 'Com resposta registrada.',
  won: 'Com oportunidade ganha.',
};

export const IntelligencePeriod = z.enum(['month', 'all']);
export type IntelligencePeriod = z.infer<typeof IntelligencePeriod>;

export const INTELLIGENCE_PERIOD_LABELS: Record<IntelligencePeriod, string> = {
  month: 'Este mês',
  all: 'Desde o início',
};

/** `none`: sem razão a mostrar; `small`: etapa anterior abaixo da amostra mínima. */
export const SampleReliability = z.enum(['none', 'small', 'ok']);
export type SampleReliability = z.infer<typeof SampleReliability>;

export const FunnelStageView = z.object({
  stage: FunnelStage,
  count: z.number().int().min(0),
  /** Quantas dessas são registros de demonstração (selo DEMO). */
  demo: z.number().int().min(0),
  /** A leitura chegou ao teto de linhas: o número real pode ser maior. */
  capped: z.boolean(),
  /** Razão em relação à etapa anterior (0 a 1); null sem base ou quando passaria de 100%. */
  shareOfPrevious: z.number().min(0).max(1).nullable(),
  reliability: SampleReliability,
});
export type FunnelStageView = z.infer<typeof FunnelStageView>;

export const AiUsageView = z.object({
  generations: z.number().int().min(0),
  failed: z.number().int().min(0),
  cancelled: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Tempo das gerações (GPU), em milissegundos. */
  totalMs: z.number().min(0),
  byModel: z
    .array(
      z.object({
        model: z.string().min(1).max(120),
        generations: z.number().int().min(0),
        outputTokens: z.number().int().min(0),
      }),
    )
    .max(50),
  toolCalls: z.number().int().min(0),
  toolErrors: z.number().int().min(0),
  /** A leitura chegou ao teto de linhas: os números reais podem ser maiores. */
  capped: z.boolean(),
});
export type AiUsageView = z.infer<typeof AiUsageView>;

export const SearchUsageView = z.object({
  /** Mês civil no fuso da agência (AAAA-MM). */
  period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
  creditsUsed: z.number().int().min(0),
  /** Teto do app (`WEB_SEARCH_MONTHLY_CREDITS`), nunca acima da cota gratuita. */
  creditsBudget: z.number().int().min(0),
  creditsRemaining: z.number().int().min(0),
  /** Cota gratuita do plano da Tavily. */
  freeQuota: z.number().int().min(0),
});
export type SearchUsageView = z.infer<typeof SearchUsageView>;

export const SearchState = z.enum(['enabled', 'disabled', 'not_configured']);
export type SearchState = z.infer<typeof SearchState>;

export const IntelligenceOverview = z.object({
  period: IntelligencePeriod,
  /** Início do período do funil; null = desde o início. */
  since: IsoDateTime.nullable(),
  /** Início do mês civil (fuso da agência): base do consumo e do gasto. */
  monthStart: IsoDateTime,
  generatedAt: IsoDateTime,
  funnel: z.array(FunnelStageView).length(FunnelStage.options.length),
  /** Abaixo disto na etapa anterior, a razão vem com aviso de amostra pequena. */
  minSample: z.number().int().min(1),
  /** null = a leitura da telemetria falhou agora (o resto da tela continua). */
  ai: AiUsageView.nullable(),
  search: z.object({
    state: SearchState,
    /** null = busca desligada ou consumo ilegível agora. */
    usage: SearchUsageView.nullable(),
  }),
  /** Gasto em dinheiro no mês (custo de IA e de provedores), em micro-dólares. */
  money: z
    .object({
      usdMicros: z.number().int().min(0),
      capped: z.boolean(),
    })
    .nullable(),
});
export type IntelligenceOverview = z.infer<typeof IntelligenceOverview>;
