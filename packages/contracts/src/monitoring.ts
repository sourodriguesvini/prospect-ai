import { z } from 'zod';
import { Uuid } from './common';
import { InvestigationChange, Recommendation, type InvestigationChangeKind } from './investigation';

/**
 * Monitoramento de empresas já conhecidas (D15, primeira fatia; ADR-0017). Diferente de
 * "Descoberta > Monitoramentos", que são buscas recorrentes de empresas NOVAS. Aqui:
 *
 * - lista de acompanhamento implícita: toda empresa investigada e não arquivada, com a frequência
 *   tirada da recomendação da última investigação (doc 02, D15: "pursue semanal, monitor mensal");
 * - feed único de novidades: mudanças detectadas entre duas investigações da mesma empresa
 *   (texto do sistema, `detectChanges`) e as empresas novas que as buscas recorrentes acharam.
 *
 * A nova investigação só roda com o clique da pessoa (GPU e créditos da Tavily).
 */

const IsoDateTime = z.iso.datetime({ offset: true, error: 'Data e hora inválidas (ISO 8601).' });

/** Frequência de acompanhamento, vinda da recomendação (nunca escolhida pelo modelo). */
export const WatchCadence = z.enum(['weekly', 'monthly']);
export type WatchCadence = z.infer<typeof WatchCadence>;

export const WATCH_CADENCE_DAYS: Record<WatchCadence, number> = { weekly: 7, monthly: 30 };

export const WATCH_CADENCE_LABELS: Record<WatchCadence, string> = {
  weekly: 'A cada 7 dias',
  monthly: 'A cada 30 dias',
};

/** `running`: há investigação na fila ou rodando; `due`: passou do prazo; `upcoming`: em dia. */
export const WatchState = z.enum(['running', 'due', 'upcoming']);
export type WatchState = z.infer<typeof WatchState>;

export const WATCH_STATE_LABELS: Record<WatchState, string> = {
  running: 'Investigação em andamento',
  due: 'Vencida',
  upcoming: 'Em dia',
};

export const WatchItem = z.object({
  companyId: Uuid,
  companyName: z.string().min(1).max(160),
  isDemo: z.boolean(),
  /** Recomendação do último diagnóstico, que define a frequência. */
  recommendation: Recommendation,
  priority: z.number().int().min(0).max(100).nullable(),
  cadence: WatchCadence,
  lastInvestigatedAt: IsoDateTime,
  dueAt: IsoDateTime,
  state: WatchState,
  /** Dias inteiros de atraso (vencida) ou até o prazo (em dia, em andamento); 0 = hoje. */
  days: z.number().int().min(0),
});
export type WatchItem = z.infer<typeof WatchItem>;

/** Mudanças de uma investigação em relação à anterior da mesma empresa. */
export const CompanyChangeItem = z.object({
  kind: z.literal('company_change'),
  investigationId: Uuid,
  companyId: Uuid,
  companyName: z.string().min(1).max(160),
  isDemo: z.boolean(),
  occurredAt: IsoDateTime,
  /** Mudanças de fato (site, páginas, ofertas, comunicação, visual, sinais, concorrentes). */
  changes: z.array(InvestigationChange).max(30),
  /** Site ou página fora do ar NESTA coleta: registrado à parte, nunca como mudança. */
  unavailable: z.array(InvestigationChange).max(30),
});
export type CompanyChangeItem = z.infer<typeof CompanyChangeItem>;

/** Busca recorrente da Descoberta que achou empresas que nenhuma pesquisa tinha visto antes. */
export const DiscoveryNoveltyItem = z.object({
  kind: z.literal('discovery_novelty'),
  runId: Uuid,
  monitorId: Uuid,
  monitorName: z.string().min(1).max(120),
  occurredAt: IsoDateTime,
  newCompanies: z.number().int().min(1),
  isDemo: z.boolean(),
});
export type DiscoveryNoveltyItem = z.infer<typeof DiscoveryNoveltyItem>;

export const MonitoringFeedItem = z.discriminatedUnion('kind', [
  CompanyChangeItem,
  DiscoveryNoveltyItem,
]);
export type MonitoringFeedItem = z.infer<typeof MonitoringFeedItem>;

/** Filtro do feed na tela (`?origem=`). */
export const MonitoringFeedFilter = z.enum(['all', 'companies', 'discovery']);
export type MonitoringFeedFilter = z.infer<typeof MonitoringFeedFilter>;

/** `off`: Descoberta desligada; `unavailable`: a leitura dela falhou agora (o resto continua). */
export const MonitoringDiscoveryState = z.enum(['included', 'off', 'unavailable']);
export type MonitoringDiscoveryState = z.infer<typeof MonitoringDiscoveryState>;

export const MonitoringOverview = z.object({
  generatedAt: IsoDateTime,
  /** Mais recentes primeiro. */
  feed: z.array(MonitoringFeedItem).max(100),
  /** Vencidas primeiro (mais atrasadas, depois maior prioridade), em andamento, em dia. */
  watchlist: z.array(WatchItem).max(200),
  /** Investigadas com recomendação "Descartar por enquanto": ficam fora da lista. */
  excludedDiscarded: z.number().int().min(0),
  /** Em acompanhamento, mas ainda sem investigação concluída com diagnóstico. */
  notInvestigated: z.number().int().min(0),
  /** A leitura das empresas chegou ao teto (200 mais recentes): pode haver outras fora. */
  truncated: z.boolean(),
  discovery: MonitoringDiscoveryState,
  /** `unavailable`: a leitura das mudanças das empresas falhou agora (a lista continua). */
  companyChanges: z.enum(['included', 'unavailable']),
  /** O feed chegou ao teto de itens: há novidades mais antigas fora da tela. */
  feedTruncated: z.boolean(),
});
export type MonitoringOverview = z.infer<typeof MonitoringOverview>;

/** Rótulo curto de cada tipo de mudança (o texto completo vem do sistema, em `text`). */
export const INVESTIGATION_CHANGE_KIND_LABELS: Record<InvestigationChangeKind, string> = {
  site_changed: 'Site oficial',
  page_added: 'Página nova',
  page_missing: 'Página ausente',
  offering_added: 'Oferta nova',
  offering_missing: 'Oferta ausente',
  communication_changed: 'Comunicação',
  visual_changed: 'Identidade visual',
  new_signal: 'Sinal novo',
  competitor_added: 'Concorrente novo',
  temporarily_unavailable: 'Fora do ar nesta coleta',
};
