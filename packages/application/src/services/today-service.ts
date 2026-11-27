import {
  ACTIVE_INVESTIGATION_STATUSES,
  type AttentionItem,
  type Company,
  type DiscoveryRun,
  type MessageChannel,
  type PriorityBand,
  type Recommendation,
  type WatchItem,
} from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError } from '../errors';
import type { CompanyService } from './company-service';
import type { DiscoveryService, ProspectView } from './discovery-service';
import type { InvestigationService } from './investigation-service';
import type { MonitoringService } from './monitoring-service';
import type { RelationshipService } from './relationship-service';

/**
 * Tela Hoje (proposta de 26/11, Frente 1): o que pede a atenção da pessoa agora, na ordem de
 * prioridade pedida pelo usuário. Só leitura e só composição: cada parte vem do serviço que já
 * é dono dela (Relacionamento, Investigação, Empresas, Descoberta, Monitoramento), sem regra nova
 * de negócio. Uma parte que não pôde ser lida entra em `unavailable` e a tela avisa, sem esconder
 * as outras.
 */
export interface TodayService {
  overview(ctx: RequestContext): Promise<TodayOverview>;
}

export type TodaySection = 'relationship' | 'approvals' | 'companies' | 'discovery' | 'monitoring';

/** Lista curta para a tela (`items`) e quantos existem ao todo (`total`). */
export interface TodayList<T> {
  items: T[];
  total: number;
}

/** Empresa analisada com recomendação de abordar e ainda sem conversa aberta. */
export interface ReadyCompany {
  companyId: string;
  companyName: string;
  isDemo: boolean;
  recommendation: Extract<Recommendation, 'pursue' | 'prepare_access'>;
  offerName: string | null;
  analyzedAt: string;
}

export interface RunningAnalysis {
  companyId: string;
  companyName: string;
  isDemo: boolean;
  status: 'queued' | 'running';
  since: string;
}

/** Mensagem aprovada que ainda vale (nenhum problema na aprovação) e não foi registrada como enviada. */
export interface ApprovedMessage {
  approvalId: string;
  opportunityId: string;
  companyId: string;
  companyName: string;
  isDemo: boolean;
  channel: MessageChannel;
  expiresAt: string;
}

export interface TodaySearch {
  runId: string;
  request: string;
  /** Empresas novas (não vistas em pesquisas anteriores) e total achado. */
  newProspects: number;
  prospects: number;
  at: string;
  isDemo: boolean;
}

export interface TodayProspect {
  prospectId: string;
  name: string;
  segment: string | null;
  place: string | null;
  priority: PriorityBand;
  /** Primeiro motivo da triagem (com fonte, quando houver); null se a triagem não deu motivo. */
  reason: string | null;
  isDemo: boolean;
}

export interface TodayOverview {
  readAt: string;
  /** Partes que não puderam ser lidas agora (a tela avisa e mostra o resto). */
  unavailable: TodaySection[];
  readyToApproach: TodayList<ReadyCompany>;
  /** Responderam e ainda não houve retorno nosso. */
  replies: TodayList<AttentionItem>;
  /** Rascunhos esperando revisão (um item por conversa). */
  drafts: TodayList<AttentionItem>;
  /** Aprovadas e ainda válidas: falta enviar por fora do app, pelo canal aprovado, e registrar. */
  approved: TodayList<ApprovedMessage>;
  /** Tarefas vencidas ou de hoje, e contatos sem resposta nem follow-up marcado. */
  followUps: TodayList<AttentionItem>;
  /** Pesquisas concluídas nos últimos dias que acharam empresas novas. */
  finishedSearches: TodayList<TodaySearch>;
  /** Resultados de pesquisa com prioridade alta ou média, ainda não analisados nem ignorados. */
  newOpportunities: TodayList<TodayProspect>;
  /** Empresas acompanhadas cuja hora de rever chegou. */
  toReview: TodayList<WatchItem>;
  /** Análises de empresas na fila ou rodando. */
  runningAnalyses: TodayList<RunningAnalysis>;
  /** Pesquisas na fila ou rodando. */
  runningSearches: TodayList<TodaySearch>;
  /** Resumo comercial; null se o Relacionamento não pôde ser lido. */
  pipeline: { openCount: number; valueWithBasisCents: number; valuedCount: number } | null;
}

export interface TodayServiceDeps {
  /** null = sem banco configurado: as partes dependentes ficam vazias (a tela já avisa do banco). */
  relationship: Pick<
    RelationshipService,
    'overview' | 'approvalQueue' | 'suppressionsOf' | 'listOpportunities'
  > | null;
  companies: Pick<CompanyService, 'list'> | null;
  investigations: Pick<InvestigationService, 'summaries'> | null;
  /** null = Descoberta desligada. */
  discovery: Pick<DiscoveryService, 'listRuns' | 'opportunities'> | null;
  monitoring: Pick<MonitoringService, 'overview'> | null;
  clock?: Clock;
  /** Registro de uma parte que falhou (só tipo e código do erro, sem dados). Padrão: console. */
  log?: (message: string) => void;
}

/** Itens por lista na tela; o total aparece em "Ver todas". */
export const TODAY_LIST_LIMIT = 5;
/** Pesquisas concluídas há até tantos dias entram em Hoje. */
export const TODAY_SEARCH_DAYS = 7;
/** O mesmo teto da lista de Empresas e do Monitoramento. */
const COMPANY_LIMIT = 200;
const RUNS_LIMIT = 20;
const OPPORTUNITIES_LIMIT = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

const READY: ReadonlySet<Recommendation> = new Set(['pursue', 'prepare_access']);
/** Etapas em que a empresa já não está "para abordar": descartada, em conversa ou cliente. */
const SETTLED: ReadonlySet<Company['lifecycle']> = new Set(['disqualified', 'engaged', 'customer']);
const FOLLOW_UP_KINDS: ReadonlySet<AttentionItem['kind']> = new Set([
  'task_overdue',
  'task_due_today',
  'awaiting_their_reply',
]);

function list<T>(all: readonly T[], limit = TODAY_LIST_LIMIT): TodayList<T> {
  return { items: all.slice(0, limit), total: all.length };
}

function placeOf(city: string | null, uf: string | null): string | null {
  if (city && uf) return `${city}/${uf}`;
  return city ?? uf ?? null;
}

function searchOf(run: DiscoveryRun): TodaySearch {
  return {
    runId: run.id,
    request: run.request,
    newProspects: run.progress.newProspects,
    prospects: run.progress.prospects,
    at: run.finishedAt ?? run.startedAt ?? run.createdAt,
    isDemo: run.isDemo,
  };
}

/**
 * "Por quê" de uma oportunidade em Hoje: o sinal confirmado mais forte (a lista já vem do mais
 * forte), senão o primeiro motivo da triagem com fonte, senão o primeiro motivo. O primeiro motivo
 * sozinho às vezes é uma lacuna ("falta confirmar o segmento"), que não explica a oportunidade.
 */
function opportunityReason(view: ProspectView): string | null {
  const signal = view.signals.find((item) => item.verification === 'confirmed');
  if (signal) return signal.summary;
  const reasons = view.prospect.assessment?.reasons ?? [];
  return (reasons.find((reason) => reason.sourceIds.length > 0) ?? reasons[0])?.text ?? null;
}

export function createTodayService(deps: TodayServiceDeps): TodayService {
  const clock = deps.clock ?? systemClock;
  const log = deps.log ?? ((message: string) => console.warn(message));

  /**
   * Lê uma parte; falha vira `unavailable` (nunca derruba a tela inteira), mas fica registrada no
   * servidor: um defeito não pode virar só "não foi possível ler" sem pista.
   */
  async function attempt<T>(
    section: TodaySection,
    unavailable: Set<TodaySection>,
    read: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      unavailable.add(section);
      const detail =
        error instanceof AppError
          ? `${error.code}/${error.reason}`
          : error instanceof Error
            ? error.name
            : typeof error;
      log(`[hoje] parte "${section}" indisponível: ${detail}`);
      return null;
    }
  }

  return {
    async overview(ctx) {
      const now = clock.now();
      const unavailable = new Set<TodaySection>();
      const { relationship, companies, investigations, discovery, monitoring } = deps;

      const [relation, queue, companyRows, runs, prospects, watch] = await Promise.all([
        relationship
          ? attempt('relationship', unavailable, () => relationship.overview(ctx))
          : Promise.resolve(null),
        relationship
          ? attempt('approvals', unavailable, () => relationship.approvalQueue(ctx))
          : Promise.resolve(null),
        companies && investigations
          ? attempt('companies', unavailable, async () => {
              const rows = await companies.list(ctx, {
                includeArchived: false,
                limit: COMPANY_LIMIT,
              });
              const summaries =
                rows.length > 0
                  ? await investigations.summaries(
                      ctx,
                      rows.map((row) => row.id),
                    )
                  : [];
              return { rows, summaries };
            })
          : Promise.resolve(null),
        discovery
          ? attempt('discovery', unavailable, () => discovery.listRuns(ctx, { limit: RUNS_LIMIT }))
          : Promise.resolve(null),
        discovery
          ? attempt('discovery', unavailable, () =>
              discovery.opportunities(ctx, { limit: OPPORTUNITIES_LIMIT }),
            )
          : Promise.resolve(null),
        monitoring
          ? attempt('monitoring', unavailable, () => monitoring.overview(ctx))
          : Promise.resolve(null),
      ]);

      const attention = relation?.attention ?? [];
      const byKind = (test: (item: AttentionItem) => boolean) => attention.filter(test);

      // Conversa aberta: a empresa já está em Conversas e não aparece como "pronta".
      const inConversation = new Set((relation?.opportunities ?? []).map((item) => item.companyId));

      let readyToApproach: ReadyCompany[] = [];
      const readyCompanies: Company[] = [];
      const runningAnalyses: RunningAnalysis[] = [];
      if (companyRows) {
        const byId = new Map(companyRows.rows.map((row) => [row.id, row]));
        for (const summary of companyRows.summaries) {
          const company = byId.get(summary.companyId);
          if (!company) continue;
          if (ACTIVE_INVESTIGATION_STATUSES.includes(summary.status)) {
            runningAnalyses.push({
              companyId: company.id,
              companyName: company.displayName,
              isDemo: company.isDemo,
              status: summary.status === 'queued' ? 'queued' : 'running',
              since: summary.updatedAt,
            });
            continue;
          }
          // A recomendação é a da última análise com diagnóstico (a mesma do topo da página da
          // empresa); uma atualização que falhou ou foi cancelada depois não a apaga.
          if (
            !SETTLED.has(company.lifecycle) &&
            summary.recommendation &&
            READY.has(summary.recommendation) &&
            !inConversation.has(company.id)
          ) {
            readyCompanies.push(company);
            readyToApproach.push({
              companyId: company.id,
              companyName: company.displayName,
              isDemo: company.isDemo,
              recommendation: summary.recommendation as ReadyCompany['recommendation'],
              offerName: summary.recommendedOfferName,
              analyzedAt: summary.finishedAt ?? summary.updatedAt,
            });
          }
        }
        // Nunca aparece como pronta para abordar:
        // - quem pediu para não ser contatado (pela empresa, raiz do CNPJ ou domínio; regra 7);
        // - quem já teve conversa, aberta ou encerrada (abordar de novo é decisão da pessoa).
        // Sem conseguir conferir, a lista fica vazia: na dúvida, não recomenda.
        if (readyCompanies.length > 0) {
          const checked = relationship
            ? await attempt('relationship', unavailable, () =>
                Promise.all([
                  relationship.suppressionsOf(ctx, readyCompanies),
                  relationship.listOpportunities(ctx, { includeClosed: true }),
                ]),
              )
            : null;
          if (checked) {
            const [suppressed, conversations] = checked;
            const talked = new Set(conversations.map((item) => item.companyId));
            readyToApproach = readyToApproach.filter(
              (item) => !suppressed.has(item.companyId) && !talked.has(item.companyId),
            );
          } else if (relationship) {
            readyToApproach = [];
          }
        }
        // "Abordar agora" antes de "abordar"; dentro de cada uma, a análise mais recente primeiro.
        readyToApproach.sort(
          (a, b) =>
            Number(b.recommendation === 'pursue') - Number(a.recommendation === 'pursue') ||
            b.analyzedAt.localeCompare(a.analyzedAt),
        );
        runningAnalyses.sort((a, b) => a.since.localeCompare(b.since));
      }

      const approved: ApprovedMessage[] = [];
      for (const entry of queue?.recent ?? []) {
        if (entry.problems.length > 0 || !entry.opportunity || !entry.message) continue;
        if (entry.opportunity.closedAt) continue;
        approved.push({
          approvalId: entry.approval.id,
          opportunityId: entry.opportunity.id,
          companyId: entry.opportunity.companyId,
          companyName: entry.opportunity.companyName,
          isDemo: entry.opportunity.companyIsDemo,
          channel: entry.approval.channel,
          expiresAt: entry.approval.expiresAt,
        });
      }
      approved.sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));

      const since = now.getTime() - TODAY_SEARCH_DAYS * DAY_MS;
      const finishedSearches = (runs ?? [])
        .filter(
          (run) =>
            run.status === 'completed' &&
            run.progress.newProspects > 0 &&
            run.finishedAt !== null &&
            Date.parse(run.finishedAt) >= since,
        )
        .map(searchOf)
        .sort((a, b) => b.at.localeCompare(a.at));
      const runningSearches = (runs ?? [])
        .filter((run) => run.status === 'queued' || run.status === 'running')
        .map(searchOf);

      const newOpportunities: TodayProspect[] = (prospects ?? []).map((view) => ({
        prospectId: view.prospect.id,
        name: view.prospect.displayName,
        segment: view.prospect.segment,
        place: placeOf(view.prospect.city, view.prospect.uf),
        priority: view.prospect.priority,
        reason: opportunityReason(view),
        isDemo: view.prospect.isDemo,
      }));

      const toReview = (watch?.watchlist ?? []).filter((item) => item.state === 'due');

      return {
        readAt: now.toISOString(),
        unavailable: [...unavailable],
        readyToApproach: list(readyToApproach),
        replies: list(byKind((item) => item.kind === 'reply_waiting_us')),
        drafts: list(byKind((item) => item.kind === 'draft_to_review')),
        approved: list(approved),
        followUps: list(byKind((item) => FOLLOW_UP_KINDS.has(item.kind))),
        finishedSearches: list(finishedSearches, 3),
        newOpportunities: list(newOpportunities),
        toReview: list(toReview),
        runningAnalyses: list(runningAnalyses),
        runningSearches: list(runningSearches, 3),
        pipeline: relation
          ? {
              openCount: relation.openCount,
              valueWithBasisCents: relation.valueWithBasisCents,
              valuedCount: relation.valuedCount,
            }
          : null,
      };
    },
  };
}
