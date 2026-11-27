import {
  DISCOVERY_DEPTH_LIMITS,
  DiscoveryRequestInput,
  MONITOR_FREQUENCY_HOURS,
  MonitorInput,
  MonitorStatus,
  ProspectDecisionInput,
  ProspectListFilter,
  SIGNAL_TYPE_LABELS,
  Uuid,
  WEB_LEDGER_SNIPPET_MAX_CHARS,
  type DiscoveryLimits,
  type DiscoveryMonitor,
  type DiscoveryRun,
  type DiscoveryRunQuery,
  type DiscoveryTrigger,
  type Prospect,
  type ProspectSignal,
  type ProspectSource,
  type SignalType,
  type WebResearchUsage,
  withoutCpf,
  type Claim,
} from '@prospector/contracts';
import { quoteFoundIn, registryRetentionUntil } from '@prospector/domain';
import { calendarDate, localDay, systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import type { CompanyRepository, EvidenceRepository } from '../ports/company-repository';
import type { DiscoveryRepository, ProspectRecord } from '../ports/discovery';
import type { CompanyService } from './company-service';
import type { EvidenceDraft, EvidenceService } from './evidence-service';
import { pendingAudit } from './pending-audit';
import { WEB_MENTION_KEY, type WebResearchService } from './web-research-service';

/**
 * Serviço da Descoberta (F4, ADR-0013) para a tela e para o Copiloto. Cria pesquisas (que o
 * trabalhador executa em segundo plano), mostra resultados e registra as decisões da pessoa.
 * "Investigar" é a ponte com o módulo Empresas: cria (ou liga) a empresa e grava fontes e sinais
 * no Evidence Ledger, com trecho conferido. Nada sai do computador sem aprovação: a Descoberta
 * só pesquisa e organiza.
 */

export interface DiscoveryStatus {
  search: 'enabled' | 'disabled' | 'not_configured';
  pageReader: 'enabled' | 'disabled';
  usage: WebResearchUsage | null;
  /** Pesquisas na fila ou rodando (e rascunhos do Copiloto esperando confirmação). */
  activeRuns: number;
  drafts: number;
}

/** Referência curta a uma fonte (para mostrar "Fonte: host" ao lado do trecho ou do motivo). */
export type SourceRef = Pick<ProspectSource, 'id' | 'url' | 'host' | 'title'>;

export interface ProspectView {
  prospect: Prospect;
  /** Sinais da empresa (mais fortes primeiro). */
  signals: ProspectSignal[];
  /** Fontes citadas pelos sinais e pelos motivos da triagem, por id. */
  sources: Record<string, SourceRef>;
  /** Apareceu pela primeira vez na pesquisa em questão (null fora de uma pesquisa). */
  isNew: boolean | null;
}

export interface DiscoveryRunDetail {
  run: DiscoveryRun;
  queries: DiscoveryRunQuery[];
  prospects: ProspectView[];
  monitor: DiscoveryMonitor | null;
}

export interface ProspectDetail {
  prospect: Prospect;
  sources: ProspectSource[];
  signals: ProspectSignal[];
  company: { id: string; displayName: string; lifecycle: string } | null;
}

export interface SignalView {
  signal: ProspectSignal;
  prospect: Pick<Prospect, 'id' | 'displayName' | 'city' | 'uf' | 'priority' | 'status' | 'isDemo'>;
  source: Pick<ProspectSource, 'url' | 'host' | 'title'> | null;
}

export interface InvestigateResult {
  companyId: string;
  /** false = a empresa já existia em Empresas (mesmo CNPJ ou domínio) e foi ligada. */
  created: boolean;
  /** Evidências gravadas no dossiê (fontes com trecho e sinais). */
  claims: number;
}

export interface DiscoveryService {
  status(ctx: RequestContext): Promise<DiscoveryStatus>;
  /** Copiloto cria rascunho (`draft`), que só roda depois da confirmação da pessoa. */
  createRun(
    ctx: RequestContext,
    raw: unknown,
    options?: { trigger?: 'user' | 'copilot' },
  ): Promise<DiscoveryRun>;
  /**
   * Pesquisa pedida pela pessoa na tela: se a mesma pesquisa (pedido e filtros) já está na fila ou
   * rodando, devolve ela (`reused`) em vez de criar outra e gastar créditos de novo.
   */
  startRun(ctx: RequestContext, raw: unknown): Promise<{ run: DiscoveryRun; reused: boolean }>;
  confirmRun(ctx: RequestContext, runId: string): Promise<DiscoveryRun>;
  cancelRun(ctx: RequestContext, runId: string): Promise<DiscoveryRun>;
  /** Nova pesquisa com o mesmo pedido (buscas iguais em 24 h vêm do cache, sem crédito). */
  retryRun(ctx: RequestContext, runId: string): Promise<DiscoveryRun>;
  getRun(ctx: RequestContext, runId: string): Promise<DiscoveryRunDetail>;
  listRuns(
    ctx: RequestContext,
    options?: { limit?: number; monitorId?: string | null },
  ): Promise<DiscoveryRun[]>;
  listProspects(ctx: RequestContext, raw?: unknown): Promise<ProspectView[]>;
  getProspect(ctx: RequestContext, prospectId: string): Promise<ProspectDetail>;
  decide(ctx: RequestContext, raw: unknown): Promise<Prospect>;
  investigate(ctx: RequestContext, prospectId: string): Promise<InvestigateResult>;
  /** Oportunidades: prioridade alta ou média, ainda não ignoradas nem investigadas. */
  opportunities(ctx: RequestContext, options?: { limit?: number }): Promise<ProspectView[]>;
  signals(
    ctx: RequestContext,
    options?: {
      types?: SignalType[];
      since?: string | null;
      runId?: string | null;
      limit?: number;
    },
  ): Promise<SignalView[]>;

  listMonitors(
    ctx: RequestContext,
    options?: { includeArchived?: boolean },
  ): Promise<DiscoveryMonitor[]>;
  getMonitor(ctx: RequestContext, monitorId: string): Promise<DiscoveryMonitor>;
  createMonitor(ctx: RequestContext, raw: unknown): Promise<DiscoveryMonitor>;
  updateMonitor(ctx: RequestContext, monitorId: string, raw: unknown): Promise<DiscoveryMonitor>;
  setMonitorStatus(
    ctx: RequestContext,
    monitorId: string,
    status: unknown,
  ): Promise<DiscoveryMonitor>;
  /** Roda o monitoramento agora (pedido da pessoa). */
  runMonitorNow(ctx: RequestContext, monitorId: string): Promise<DiscoveryRun>;
}

export interface DiscoveryServiceDeps {
  repo: DiscoveryRepository;
  web: Pick<WebResearchService, 'status'>;
  companies: Pick<CompanyService, 'createFromDiscovery'>;
  /** Empresas e o dossiê (o mesmo repositório implementa os dois). */
  companyRepo: Pick<CompanyRepository, 'get'> & Pick<EvidenceRepository, 'claimsFor'>;
  evidenceService: Pick<EvidenceService, 'record'>;
  clock?: Clock;
  newId?: () => string;
  /** Pesquisas ao mesmo tempo na fila (o trabalhador roda uma por vez). */
  maxActiveRuns?: number;
  /**
   * Modo de demonstração (buscador e IA SINTÉTICOS, só em memória): tudo o que for criado sai
   * marcado `isDemo` e aparece com o selo DEMO (regra 4).
   */
  demo?: boolean;
}

const ACTIVE_STATUSES = ['queued', 'running'] as const;

/** Texto do pedido comparável: sem acento, minúsculas e espaços simples. */
function requestKey(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mesma pesquisa: mesmo pedido e mesma cidade (ignorando acento, maiúsculas e espaços) e mesmos
 * filtros. Usado para não criar uma segunda pesquisa igual enquanto a primeira ainda roda.
 */
export function sameDiscoveryRequest(
  run: Pick<DiscoveryRun, 'request' | 'options'>,
  input: DiscoveryRequestInput,
): boolean {
  const { request, ...options } = input;
  const a = run.options;
  // Profundidade e quantidade valem pelo efeito: sem profundidade é a padrão, e pedir o teto é o
  // mesmo que não pedir quantidade.
  const reach = (depth: typeof a.depth, quantity: number | null | undefined): string => {
    const level = depth ?? 'standard';
    return `${level}:${limitsFor(level, quantity ?? null).maxProspects}`;
  };
  return (
    requestKey(run.request) === requestKey(request) &&
    requestKey(a.city ?? '') === requestKey(options.city ?? '') &&
    (a.uf ?? null) === (options.uf ?? null) &&
    reach(a.depth, a.quantity) === reach(options.depth, options.quantity) &&
    (a.icpId ?? null) === (options.icpId ?? null) &&
    [...(a.signals ?? [])].sort().join(',') === [...options.signals].sort().join(',')
  );
}
const FINAL_STATUSES = ['completed', 'failed', 'cancelled'] as const;
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2, insufficient: 3 } as const;

function signalStrength(signal: ProspectSignal): number {
  return (
    (signal.verification === 'confirmed' ? 2 : 0) +
    (signal.relevance === 'high' ? 2 : signal.relevance === 'medium' ? 1 : 0) +
    (signal.recency === 'recent' ? 1 : 0) +
    signal.confidence
  );
}

function publicProspect(record: ProspectRecord): Prospect {
  const { nameKey: _nameKey, ...prospect } = record;
  return prospect;
}

/** Limites da pesquisa pela profundidade e pela quantidade pedida. */
export function limitsFor(
  depth: keyof typeof DISCOVERY_DEPTH_LIMITS,
  quantity: number | null,
): DiscoveryLimits {
  const base = DISCOVERY_DEPTH_LIMITS[depth];
  return {
    ...base,
    maxProspects: Math.min(base.maxProspects, Math.max(quantity ?? base.maxProspects, 1)),
  };
}

/** Rascunhos do Copiloto esperando confirmação, no máximo. */
const MAX_OPEN_DRAFTS = 3;

/** 2026-09-02 → 02/09/2026 (datas do enunciado, em pt-BR). */
function brDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return year && month && day ? `${day}/${month}/${year}` : iso;
}

export function createDiscoveryService(deps: DiscoveryServiceDeps): DiscoveryService {
  const { repo } = deps;
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const maxActiveRuns = deps.maxActiveRuns ?? 5;
  const nowIso = () => clock.now().toISOString();

  async function requireRun(runId: string): Promise<DiscoveryRun> {
    const id = parseInput(Uuid, runId);
    const run = await repo.getRun(id);
    if (!run) throw new AppError('not_found', 'not_found');
    return run;
  }

  async function requireProspect(prospectId: string): Promise<ProspectRecord> {
    const id = parseInput(Uuid, prospectId);
    const prospect = await repo.getProspect(id);
    if (!prospect) throw new AppError('not_found', 'not_found');
    return prospect;
  }

  async function requireMonitor(monitorId: string): Promise<DiscoveryMonitor> {
    const id = parseInput(Uuid, monitorId);
    const monitor = await repo.getMonitor(id);
    if (!monitor) throw new AppError('not_found', 'not_found');
    return monitor;
  }

  async function assertSearchEnabled(ctx: RequestContext): Promise<void> {
    const status = await deps.web.status(ctx);
    if (status.search !== 'enabled') throw new AppError('conflict', 'discovery_search_unavailable');
  }

  async function assertQueueRoom(): Promise<void> {
    const active = await repo.listRuns({ limit: maxActiveRuns + 1, statuses: ACTIVE_STATUSES });
    if (active.length >= maxActiveRuns) throw new AppError('conflict', 'discovery_queue_full');
  }

  async function views(
    records: readonly ProspectRecord[],
    isNew?: Map<string, boolean>,
  ): Promise<ProspectView[]> {
    const ids = records.map((item) => item.id);
    const [signals, sources] =
      ids.length > 0 ? await Promise.all([repo.signalsFor(ids), repo.sourcesFor(ids)]) : [[], []];
    const byProspect = new Map<string, ProspectSignal[]>();
    for (const signal of signals) {
      byProspect.set(signal.prospectId, [...(byProspect.get(signal.prospectId) ?? []), signal]);
    }
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    return records.map((record) => {
      const own = (byProspect.get(record.id) ?? []).sort(
        (a, b) => signalStrength(b) - signalStrength(a),
      );
      const cited = new Set([
        ...own.map((signal) => signal.sourceId),
        ...(record.assessment?.reasons ?? []).flatMap((reason) => reason.sourceIds),
      ]);
      const refs: Record<string, SourceRef> = {};
      for (const id of cited) {
        const source = sourceById.get(id);
        if (source) refs[id] = { id, url: source.url, host: source.host, title: source.title };
      }
      return {
        prospect: publicProspect(record),
        signals: own,
        sources: refs,
        isNew: isNew ? (isNew.get(record.id) ?? null) : null,
      };
    });
  }

  let startQueue: Promise<unknown> = Promise.resolve();

  /** Reaproveita a pesquisa igual que ainda está na fila ou rodando (e sem cancelamento pedido). */
  async function startRunNow(
    ctx: RequestContext,
    raw: unknown,
  ): Promise<{ run: DiscoveryRun; reused: boolean }> {
    const input = parseInput(DiscoveryRequestInput, raw);
    const active = await repo.listRuns({ limit: 50, statuses: ACTIVE_STATUSES });
    const same = active.find(
      (run) => run.monitorId === null && !run.cancelRequestedAt && sameDiscoveryRequest(run, input),
    );
    if (same) return { run: same, reused: true };
    await assertSearchEnabled(ctx);
    await assertQueueRoom();
    return { run: await insertRun(ctx, input, 'user'), reused: false };
  }

  async function insertRun(
    ctx: RequestContext,
    input: DiscoveryRequestInput,
    trigger: DiscoveryTrigger,
    options: { monitorId?: string | null; limits?: DiscoveryLimits; draft?: boolean } = {},
  ): Promise<DiscoveryRun> {
    const { request, ...rest } = input;
    const limits = options.limits ?? limitsFor(input.depth ?? 'standard', input.quantity);
    const now = nowIso();
    const draft = options.draft ?? false;
    return repo.createRun(
      {
        id: newId(),
        request,
        options: rest,
        trigger,
        monitorId: options.monitorId ?? null,
        status: draft ? 'draft' : 'queued',
        limits,
        icpId: input.icpId,
        traceId: ctx.traceId,
        isDemo: deps.demo ?? false,
        createdAt: now,
        confirmedAt: draft ? null : now,
      },
      pendingAudit(ctx, {
        action: draft ? 'discovery.run.prepared' : 'discovery.run.created',
        entityType: 'discovery_run',
        diff: { trigger, maxSearches: limits.maxSearches, maxProspects: limits.maxProspects },
      }),
    );
  }

  /**
   * Fontes e sinais da empresa encontrada, como evidência do dossiê (trecho conferido).
   * Idempotente (ADR-0002, emenda): o que já está no dossiê não é gravado de novo; a mesma página
   * coletada de novo vira nova versão (`supersedes`). O enunciado do sinal é montado pelo servidor
   * com a citação literal da fonte; o resumo do modelo vai só para a justificativa.
   */
  async function evidenceDraft(
    companyId: string,
    prospect: ProspectRecord,
    sources: readonly ProspectSource[],
    signals: readonly ProspectSignal[],
    existing: readonly Claim[],
    promptIdsByRun: ReadonlyMap<string, readonly string[]>,
  ): Promise<EvidenceDraft> {
    const draft: EvidenceDraft = { sources: [], claims: [] };
    const current = existing.filter(
      (claim) => claim.status !== 'superseded' && claim.status !== 'rejected',
    );
    const mentionByUrl = new Map<string, Claim>();
    const recordedSignals = new Set<string>();
    for (const claim of current) {
      const value = (claim.value ?? {}) as Record<string, unknown>;
      if (claim.key === WEB_MENTION_KEY && typeof value.url === 'string') {
        mentionByUrl.set(value.url, claim);
      }
      if (typeof value.discoverySignalId === 'string') recordedSignals.add(value.discoverySignalId);
    }
    const ledgerSource = new Map<string, { id: string; excerpt: string }>();
    async function toLedger(source: ProspectSource): Promise<{ id: string; excerpt: string }> {
      const known = ledgerSource.get(source.id);
      if (known) return known;
      const snippet = source.snippet.slice(0, WEB_LEDGER_SNIPPET_MAX_CHARS);
      const title = (source.title ?? source.host).slice(0, 200);
      const excerpt = [
        `Título: ${title}`,
        `Endereço: ${source.url}`,
        snippet ? `Trecho: ${snippet}` : null,
      ]
        .filter((line): line is string => line !== null)
        .join('\n');
      const id = newId();
      ledgerSource.set(source.id, { id, excerpt });
      draft.sources?.push({
        id,
        source: {
          schemaVersion: 1,
          kind: source.kind,
          url: source.url,
          provider: source.provider,
          capturedAt: source.capturedAt,
          contentHash: await sha256Hex(excerpt),
          mime: 'text/plain',
          title,
          excerptText: excerpt,
          licenseNote:
            source.kind === 'web_page'
              ? 'Página pública lida pela Descoberta: título e começo do texto.'
              : 'Resultado de busca guardado pela Descoberta: título e começo do trecho do provedor.',
          retentionUntil: registryRetentionUntil(source.capturedAt),
          isDemo: prospect.isDemo,
        },
      });
      return ledgerSource.get(source.id)!;
    }

    for (const source of sources) {
      if (source.kind !== 'search_result') continue;
      const previous = mentionByUrl.get(source.url);
      const previousCapture = (previous?.value as { capturedAt?: unknown } | undefined)?.capturedAt;
      if (previous && previousCapture === source.capturedAt) continue; // já está no dossiê
      const snippet = source.snippet.slice(0, WEB_LEDGER_SNIPPET_MAX_CHARS);
      const title = (source.title ?? source.host).slice(0, 200);
      const ledger = await toLedger(source);
      draft.claims.push({
        id: newId(),
        supersedes: previous?.id ?? null,
        claim: {
          schemaVersion: 1,
          subjectType: 'company',
          subjectId: companyId,
          domain: 'digital_presence',
          key: WEB_MENTION_KEY,
          statement: `Uma página de ${source.host.slice(0, 80)} citou esta empresa numa pesquisa da Descoberta.`,
          value: {
            url: source.url,
            host: source.host,
            capturedAt: source.capturedAt,
            provider: source.provider,
            discoveryRunId: source.runId,
          },
          epistemicType: 'hypothesis',
          evidence: [{ sourceId: ledger.id, quote: snippet || title }],
          reasoning:
            'Resultado de busca ligado à empresa pela Descoberta (nome conferido no trecho). Leia a página para confirmar antes de usar.',
          isDemo: prospect.isDemo,
        },
      });
    }

    const byId = new Map(sources.map((source) => [source.id, source]));
    for (const signal of signals) {
      if (recordedSignals.has(signal.id)) continue; // o mesmo sinal já foi levado antes
      const source = byId.get(signal.sourceId);
      if (!source) continue;
      const ledger = await toLedger(source);
      const quoted = quoteFoundIn(signal.quote, ledger.excerpt);
      const confirmed = signal.verification === 'confirmed' && quoted;
      const label = SIGNAL_TYPE_LABELS[signal.type];
      const host = source.host.slice(0, 80);
      const when = brDate(localDay(source.publishedAt ?? source.capturedAt));
      const aiSummary = `Resumo da IA local (não é citação): ${signal.summary}`;
      draft.claims.push({
        id: newId(),
        claim: {
          schemaVersion: 1,
          subjectType: 'company',
          subjectId: companyId,
          domain: 'signal',
          key: `signal.${signal.type}`,
          // Fato afirma o que a fonte diz (doc 08 §1): a frase é do servidor, a citação é literal.
          statement: (quoted
            ? `${label}, segundo ${host} (${when}): «${signal.quote}»`
            : `Possível sinal (${label.toLowerCase()}) numa página de ${host}, a confirmar na fonte.`
          ).slice(0, 500),
          value: {
            type: signal.type,
            eventDate: signal.eventDate,
            publishedAt: signal.publishedAt,
            discoveredAt: signal.discoveredAt,
            relevance: signal.relevance,
            relatedService: signal.relatedService,
            discoverySignalId: signal.id,
            discoveryRunId: signal.runId,
            promptIds: [...(promptIdsByRun.get(signal.runId) ?? [])],
          },
          epistemicType: confirmed ? 'fact' : 'hypothesis',
          evidence: quoted ? [{ sourceId: ledger.id, quote: signal.quote }] : [],
          reasoning: (confirmed
            ? aiSummary
            : `Sinal a confirmar: ${signal.rationale || 'o trecho sugere o acontecimento, mas não o descreve diretamente.'} ${aiSummary}`
          ).slice(0, 800),
          isDemo: prospect.isDemo,
        },
      });
    }
    return draft;
  }

  return {
    async status(ctx) {
      const [web, active, drafts] = await Promise.all([
        deps.web.status(ctx),
        repo.listRuns({ limit: 50, statuses: ACTIVE_STATUSES }),
        repo.listRuns({ limit: 50, statuses: ['draft'] }),
      ]);
      return {
        search: web.search,
        pageReader: web.pageReader,
        usage: web.usage,
        activeRuns: active.length,
        drafts: drafts.length,
      };
    },

    async createRun(ctx, raw, options = {}) {
      const input = parseInput(DiscoveryRequestInput, raw);
      const trigger = options.trigger ?? 'user';
      await assertSearchEnabled(ctx);
      if (trigger === 'user') await assertQueueRoom();
      if (trigger === 'copilot') {
        // Rascunho não gasta nada, mas uma injeção (texto de página lido pelo Copiloto) não
        // pode encher a tela de pedidos escritos por terceiros prontos para confirmar.
        const drafts = await repo.listRuns({ limit: MAX_OPEN_DRAFTS, statuses: ['draft'] });
        if (drafts.length >= MAX_OPEN_DRAFTS)
          throw new AppError('conflict', 'discovery_drafts_full');
      }
      return insertRun(ctx, input, trigger, { draft: trigger === 'copilot' });
    },

    startRun(ctx, raw) {
      // Um pedido por vez: dois pedidos iguais ao mesmo tempo (duas abas, envio repetido) viram um
      // só. Basta a fila em memória porque o app roda num processo só (ADR-0007).
      const next = startQueue.then(() => startRunNow(ctx, raw));
      startQueue = next.catch(() => undefined);
      return next;
    },

    async confirmRun(ctx, runId) {
      const run = await requireRun(runId);
      if (run.status !== 'draft') throw new AppError('conflict', 'discovery_run_not_draft');
      await assertSearchEnabled(ctx);
      await assertQueueRoom();
      const ok = await repo.confirmRun(
        run.id,
        nowIso(),
        pendingAudit(ctx, {
          action: 'discovery.run.confirmed',
          entityType: 'discovery_run',
          entityId: run.id,
        }),
      );
      if (!ok) throw new AppError('conflict', 'discovery_run_not_draft');
      return (await repo.getRun(run.id)) ?? run;
    },

    async cancelRun(ctx, runId) {
      const run = await requireRun(runId);
      if ((FINAL_STATUSES as readonly string[]).includes(run.status) || run.cancelRequestedAt) {
        throw new AppError('conflict', 'discovery_run_finished');
      }
      const finishNow = run.status === 'draft' || run.status === 'queued';
      const ok = await repo.requestCancel(
        run.id,
        nowIso(),
        finishNow,
        pendingAudit(ctx, {
          action: 'discovery.run.cancelled',
          entityType: 'discovery_run',
          entityId: run.id,
          diff: { from: run.status },
        }),
      );
      if (!ok) throw new AppError('conflict', 'discovery_run_finished');
      return (await repo.getRun(run.id)) ?? run;
    },

    async retryRun(ctx, runId) {
      const run = await requireRun(runId);
      await assertSearchEnabled(ctx);
      await assertQueueRoom();
      const input = parseInput(DiscoveryRequestInput, { request: run.request, ...run.options });
      return insertRun(ctx, input, 'user', { monitorId: run.monitorId, limits: run.limits });
    },

    async getRun(_ctx, runId) {
      const run = await requireRun(runId);
      const [queries, links, monitor] = await Promise.all([
        repo.listQueries(run.id),
        repo.runProspects(run.id),
        run.monitorId ? repo.getMonitor(run.monitorId) : Promise.resolve(null),
      ]);
      const ordered = [...links].sort(
        (a, b) =>
          PRIORITY_ORDER[a.prospect.priority] - PRIORITY_ORDER[b.prospect.priority] ||
          (b.prospect.priorityScore ?? -1) - (a.prospect.priorityScore ?? -1) ||
          a.position - b.position,
      );
      const prospects = await views(
        ordered.map((link) => link.prospect),
        new Map(ordered.map((link) => [link.prospect.id, link.isNew])),
      );
      return { run, queries, prospects, monitor };
    },

    async listRuns(_ctx, options = {}) {
      return repo.listRuns({
        limit: Math.min(Math.max(options.limit ?? 20, 1), 100),
        monitorId: options.monitorId ?? null,
      });
    },

    async listProspects(_ctx, raw = {}) {
      const filter = parseInput(ProspectListFilter, raw);
      return views(await repo.listProspects(filter));
    },

    async getProspect(_ctx, prospectId) {
      const prospect = await requireProspect(prospectId);
      const [sources, signals, company] = await Promise.all([
        repo.sourcesFor([prospect.id]),
        repo.signalsFor([prospect.id]),
        prospect.companyId ? deps.companyRepo.get(prospect.companyId) : Promise.resolve(null),
      ]);
      return {
        prospect: publicProspect(prospect),
        sources,
        signals: signals.sort((a, b) => signalStrength(b) - signalStrength(a)),
        company: company
          ? { id: company.id, displayName: company.displayName, lifecycle: company.lifecycle }
          : null,
      };
    },

    async decide(ctx, raw) {
      const input = parseInput(ProspectDecisionInput, raw);
      const prospect = await requireProspect(input.prospectId);
      const ok = await repo.setProspectStatus(
        prospect.id,
        {
          status: input.status,
          dismissedReason: input.status === 'dismissed' ? input.reason : null,
        },
        pendingAudit(ctx, {
          action: 'discovery.prospect.status_changed',
          entityType: 'discovery_prospect',
          entityId: prospect.id,
          diff: { from: prospect.status, to: input.status },
        }),
      );
      if (!ok) throw new AppError('not_found', 'not_found');
      return publicProspect({
        ...prospect,
        status: input.status,
        dismissedReason: input.status === 'dismissed' ? input.reason : null,
      });
    },

    async investigate(ctx, prospectId) {
      const prospect = await requireProspect(prospectId);
      let companyId = prospect.companyId;
      let created = false;
      if (companyId && !(await deps.companyRepo.get(companyId))) companyId = null;
      const link = (claims: number | null) =>
        repo.setProspectStatus(
          prospect.id,
          { status: 'investigating', dismissedReason: null, companyId },
          pendingAudit(ctx, {
            action: 'discovery.prospect.investigated',
            entityType: 'discovery_prospect',
            entityId: prospect.id,
            diff: { companyId, created, ...(claims === null ? {} : { claims }) },
          }),
        );
      let linked = false;
      if (!companyId) {
        // Domínio só quando o site foi conferido (nome na página): senão, uma página de terceiro
        // viraria "site próprio" da empresa no dossiê.
        const verifiedDomain =
          prospect.siteVerified && prospect.domain && !prospect.domain.includes('/')
            ? prospect.domain
            : null;
        const result = await deps.companies.createFromDiscovery(
          ctx,
          {
            schemaVersion: 1,
            displayName: withoutCpf(prospect.displayName),
            cnpj: prospect.cnpj ?? '',
            primaryDomain: verifiedDomain ?? '',
            city: prospect.city ?? '',
            uf: prospect.uf ?? '',
          },
          { isDemo: prospect.isDemo },
        );
        companyId = result.company.id;
        created = result.status === 'created';
        // Liga já: se gravar as evidências falhar, a próxima tentativa reaproveita a empresa.
        await link(null);
        linked = true;
      }
      const [company, sources, signals, existing] = await Promise.all([
        deps.companyRepo.get(companyId),
        repo.sourcesFor([prospect.id]),
        repo.signalsFor([prospect.id]),
        deps.companyRepo.claimsFor('company', companyId),
      ]);
      const runIds = [...new Set(signals.map((signal) => signal.runId))];
      const runs = await Promise.all(runIds.map((id) => repo.getRun(id)));
      const promptIdsByRun = new Map(
        runs
          .filter((run): run is DiscoveryRun => run !== null)
          .map((run) => [run.id, run.promptIds] as const),
      );
      const draft = await evidenceDraft(
        companyId,
        prospect,
        sources,
        signals,
        existing,
        promptIdsByRun,
      );
      if (draft.claims.length > 0) {
        await deps.evidenceService.record(ctx, companyId, draft, {
          action: 'prospect.company.discovery_recorded',
          // Site próprio = o domínio da empresa gravada ou ligada, nunca o palpite do modelo.
          ownedOrigins: company?.primaryDomain ? [company.primaryDomain] : [],
        });
      }
      if (!linked) await link(draft.claims.length);
      return { companyId, created, claims: draft.claims.length };
    },

    async opportunities(_ctx, options = {}) {
      const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
      const records = await repo.listProspects(
        parseInput(ProspectListFilter, {
          status: ['new', 'saved'],
          priority: ['high', 'medium'],
          limit: 100,
        }),
      );
      const ordered = [...records].sort(
        (a, b) =>
          PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
          (b.priorityScore ?? 0) - (a.priorityScore ?? 0) ||
          b.lastSeenAt.localeCompare(a.lastSeenAt),
      );
      return views(ordered.slice(0, limit));
    },

    async signals(_ctx, options = {}) {
      const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
      const signals = await repo.listSignals({
        types: options.types ?? [],
        since: options.since ?? null,
        runId: options.runId ?? null,
        limit,
      });
      const prospectIds = [...new Set(signals.map((signal) => signal.prospectId))];
      const [prospects, sources] = await Promise.all([
        Promise.all(prospectIds.map((id) => repo.getProspect(id))),
        prospectIds.length > 0 ? repo.sourcesFor(prospectIds) : Promise.resolve([]),
      ]);
      const byId = new Map(
        prospects
          .filter((item): item is ProspectRecord => item !== null)
          .map((item) => [item.id, item]),
      );
      const sourceById = new Map(sources.map((source) => [source.id, source]));
      return signals.flatMap((signal) => {
        const prospect = byId.get(signal.prospectId);
        if (!prospect) return [];
        const source = sourceById.get(signal.sourceId);
        return [
          {
            signal,
            prospect: {
              id: prospect.id,
              displayName: prospect.displayName,
              city: prospect.city,
              uf: prospect.uf,
              priority: prospect.priority,
              status: prospect.status,
              isDemo: prospect.isDemo,
            },
            source: source ? { url: source.url, host: source.host, title: source.title } : null,
          },
        ];
      });
    },

    async listMonitors(_ctx, options = {}) {
      return repo.listMonitors(
        options.includeArchived ? ['active', 'paused', 'archived'] : ['active', 'paused'],
      );
    },

    async getMonitor(_ctx, monitorId) {
      return requireMonitor(monitorId);
    },

    async createMonitor(ctx, raw) {
      const input = parseInput(MonitorInput, raw);
      await assertSearchEnabled(ctx);
      return repo.createMonitor(
        {
          id: newId(),
          name: input.name,
          request: input.request,
          frequency: input.frequency,
          status: 'active',
          maxSearches: input.maxSearches,
          maxProspects: input.maxProspects,
          icpId: input.icpId,
          // Primeira execução na próxima volta do agendador.
          nextRunAt: nowIso(),
          isDemo: deps.demo ?? false,
        },
        pendingAudit(ctx, {
          action: 'discovery.monitor.created',
          entityType: 'discovery_monitor',
          diff: {
            frequency: input.frequency,
            maxSearches: input.maxSearches,
            maxProspects: input.maxProspects,
          },
        }),
      );
    },

    async updateMonitor(ctx, monitorId, raw) {
      const monitor = await requireMonitor(monitorId);
      if (monitor.status === 'archived') throw new AppError('conflict', 'monitor_archived');
      const input = parseInput(MonitorInput, raw);
      const updated = await repo.updateMonitor(
        monitor.id,
        {
          name: input.name,
          request: input.request,
          frequency: input.frequency,
          maxSearches: input.maxSearches,
          maxProspects: input.maxProspects,
          icpId: input.icpId,
        },
        pendingAudit(ctx, {
          action: 'discovery.monitor.updated',
          entityType: 'discovery_monitor',
          entityId: monitor.id,
          diff: {
            frequency: input.frequency,
            maxSearches: input.maxSearches,
            maxProspects: input.maxProspects,
          },
        }),
      );
      if (!updated) throw new AppError('not_found', 'not_found');
      return updated;
    },

    async setMonitorStatus(ctx, monitorId, raw) {
      const monitor = await requireMonitor(monitorId);
      const status = parseInput(MonitorStatus, raw);
      if (monitor.status === 'archived' && status !== 'archived') {
        throw new AppError('conflict', 'monitor_archived');
      }
      if (status === 'active') await assertSearchEnabled(ctx);
      const updated = await repo.updateMonitor(
        monitor.id,
        { status, nextRunAt: status === 'active' ? nowIso() : null },
        pendingAudit(ctx, {
          action: 'discovery.monitor.status_changed',
          entityType: 'discovery_monitor',
          entityId: monitor.id,
          diff: { from: monitor.status, to: status },
        }),
      );
      if (!updated) throw new AppError('not_found', 'not_found');
      return updated;
    },

    async runMonitorNow(ctx, monitorId) {
      const monitor = await requireMonitor(monitorId);
      if (monitor.status === 'archived') throw new AppError('conflict', 'monitor_archived');
      await assertSearchEnabled(ctx);
      await assertQueueRoom();
      const input = parseInput(DiscoveryRequestInput, {
        request: monitor.request,
        depth: 'quick',
        quantity: monitor.maxProspects,
        icpId: monitor.icpId,
      });
      const run = await insertRun(ctx, input, 'user', {
        monitorId: monitor.id,
        limits: monitorLimits(monitor),
      });
      await repo.scheduleMonitor(monitor.id, { lastRunAt: run.createdAt, lastRunId: run.id });
      return run;
    },
  };
}

/** Limites de uma execução de monitoramento (sempre rápida e pequena). */
export function monitorLimits(
  monitor: Pick<DiscoveryMonitor, 'maxSearches' | 'maxProspects'>,
): DiscoveryLimits {
  return {
    maxSearches: monitor.maxSearches,
    maxPages: Math.min(monitor.maxSearches, 3),
    maxProspects: monitor.maxProspects,
  };
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// -----------------------------------------------------------------------------
// Agendador de monitoramentos
// -----------------------------------------------------------------------------

export interface DiscoverySchedulerDeps {
  repo: DiscoveryRepository;
  web: Pick<WebResearchService, 'status'>;
  clock?: Clock;
  newId?: () => string;
  /**
   * Teto de créditos por dia para pesquisas automáticas (agendadas e de recuperação). Protege o
   * orçamento do mês de um monitoramento esquecido. 0 = monitoramentos não rodam sozinhos.
   */
  dailyAutoCredits: number;
  log?: (message: string) => void;
}

export interface DiscoveryScheduler {
  /** Cria as pesquisas dos monitoramentos vencidos e faz a limpeza diária. */
  tick(): Promise<{ created: number; skipped: number }>;
}

export function createDiscoveryScheduler(deps: DiscoverySchedulerDeps): DiscoveryScheduler {
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const log = deps.log ?? ((message: string) => console.warn(message));
  let lastPurgeDay: string | null = null;
  const ctx = (): RequestContext => ({
    actor: { type: 'system', component: 'discovery-scheduler' },
    traceId: newId(),
  });

  return {
    async tick() {
      const now = clock.now();
      const today = calendarDate(now);
      if (lastPurgeDay !== today) {
        lastPurgeDay = today;
        try {
          await deps.repo.purgeExpired(now.toISOString());
        } catch (error) {
          log(`[descoberta] limpeza do prazo de guarda falhou: ${String(error)}`);
        }
      }
      const due = await deps.repo.dueMonitors(now.toISOString());
      if (due.length === 0) return { created: 0, skipped: 0 };
      const status = await deps.web.status(ctx());
      let created = 0;
      let skipped = 0;
      // Início do dia no fuso da agência (aproximação: 24 h corridas para trás).
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      for (const monitor of due) {
        const period = MONITOR_FREQUENCY_HOURS[monitor.frequency] * 60 * 60 * 1000;
        const late = monitor.nextRunAt ? now.getTime() - new Date(monitor.nextRunAt).getTime() : 0;
        const missed = Math.max(0, Math.floor(late / period));
        const nextRunAt = new Date(now.getTime() + period).toISOString();
        if (monitor.lastRunId) {
          const last = await deps.repo.getRun(monitor.lastRunId);
          if (last && (last.status === 'queued' || last.status === 'running')) {
            skipped += 1; // a anterior ainda roda: espera ela terminar
            continue;
          }
        }
        // Dois agendadores no mesmo banco (pnpm dev e o app instalado): só um pega a vez.
        if (!(await deps.repo.claimMonitor(monitor.id, now.toISOString(), nextRunAt))) {
          skipped += 1;
          continue;
        }
        if (status.search !== 'enabled') {
          // Sem buscador: não cria pesquisa que falharia; tenta de novo no próximo período.
          await deps.repo.scheduleMonitor(monitor.id, {
            nextRunAt,
            missedRuns: monitor.missedRuns + 1 + missed,
          });
          skipped += 1;
          continue;
        }
        // Créditos comprometidos nas últimas 24 h: gastos + teto das que ainda estão na fila,
        // inclusive as criadas nesta mesma volta.
        const usage = await deps.repo.usageSince(since, ['schedule', 'catch_up']);
        if (usage.credits + monitor.maxSearches > deps.dailyAutoCredits) {
          log(
            `[descoberta] monitoramento ${monitor.id} adiado: teto diário de créditos automáticos.`,
          );
          await deps.repo.scheduleMonitor(monitor.id, {
            nextRunAt: new Date(now.getTime() + 6 * 60 * 60 * 1000).toISOString(),
          });
          skipped += 1;
          continue;
        }
        const trigger: DiscoveryTrigger = missed >= 1 ? 'catch_up' : 'schedule';
        const runCtx = ctx();
        const input = parseInput(DiscoveryRequestInput, {
          request: monitor.request,
          depth: 'quick',
          quantity: monitor.maxProspects,
          icpId: monitor.icpId,
        });
        const { request, ...options } = input;
        const run = await deps.repo.createRun(
          {
            id: newId(),
            request,
            options,
            trigger,
            monitorId: monitor.id,
            status: 'queued',
            limits: monitorLimits(monitor),
            icpId: monitor.icpId,
            traceId: runCtx.traceId,
            isDemo: monitor.isDemo,
            createdAt: now.toISOString(),
            confirmedAt: now.toISOString(),
          },
          pendingAudit(runCtx, {
            action: 'discovery.run.scheduled',
            entityType: 'discovery_run',
            diff: { trigger, monitorId: monitor.id, missed },
          }),
        );
        await deps.repo.scheduleMonitor(monitor.id, {
          nextRunAt,
          lastRunAt: now.toISOString(),
          lastRunId: run.id,
          missedRuns: monitor.missedRuns + missed,
        });
        created += 1;
      }
      return { created, skipped };
    },
  };
}
