import {
  CopilotResearchJobPayload,
  RESEARCH_MAX_COUNT,
  RESEARCH_MAX_CREDITS,
  ResearchItemRef,
  ResearchProgress,
  ResearchRef,
  ReviseResearchInput,
  StartResearchInput,
  type AiJob,
  type CopilotResearch,
  type LiaDataCategory,
  type LiaVersion,
  type ResearchCriteria,
  type ResearchItemView,
  type ResearchQuery,
  type ResearchRevision,
  type ResearchStopReason,
} from '@prospector/contracts';
import {
  COMMERCIAL_PROFILES,
  DEFAULT_COMMERCIAL_PROFILE_ID,
  commercialProfileById,
  creditCapFor,
  effectiveLia,
  extractCandidates,
  hostOf,
  interpretResearchRequest,
  interpretResearchRevision,
  nextBatch,
  personIdentities,
  planResearch,
  registrableDomain,
  replanResearch,
  type ExtractedCandidate,
  type ResearchInterpretation,
  type ResearchRevisionIntent,
} from '@prospector/domain';
import { calendarDate, systemClock, type Clock } from '../clock';
import { auditActor, type RequestContext } from '../context';
import { AppError, isAppError, parseInput } from '../errors';
import type { AuditRepository } from '../ports/audit-repository';
import type { CopilotRepository } from '../ports/copilot-repository';
import type { JobOutcome } from '../ports/discovery';
import type {
  ResearchPatch,
  ResearchRepository,
  SuppressionProbe,
} from '../ports/research-repository';
import type { StrategyRepository } from '../ports/strategy-repository';
import type { JobHandler } from './job-worker';
import { pendingAudit } from './pending-audit';
import type { WebResearchService } from './web-research-service';

/**
 * Pesquisa extensa do Copiloto (diretriz de 2026-11-26, Partes 6.3 a 6.5; ADR-0020).
 *
 * - O pedido ("100 terapeutas ocupacionais no Brasil para apresentar a Blummy") é interpretado por
 *   regra (domínio), sem modelo: perfil, público, quantidade, região e premissas adotadas.
 * - A pesquisa fica ligada à conversa (contexto persistente). Um pedido seguinte ("agora priorize
 *   SP e MG") muda a mesma pesquisa: o que já rodou fica, o pendente é refeito na ordem nova.
 * - Os lotes rodam na fila durável (ADR-0011), um lote por tarefa (chave id:versão:lote): o app
 *   pode fechar no meio e a pesquisa continua de onde parou. Toda gravação confere `version` e
 *   `rowVersion`; um lote que perdeu a corrida não grava por cima do outro.
 * - Cada resultado é extraído literalmente do título e do trecho do buscador (nada deduzido) e
 *   gravado com origem e trecho. Pessoa vai para `people` (base legal, prazo, opt-out); sem LIA
 *   que a cubra fica guardada sem base para abordagem, por 90 dias. Pessoa ou organização
 *   suprimida não entra. Com a chave das pessoas trocada, nenhuma pessoa é gravada.
 * - Consultas por profissão e região, nunca pelo nome de uma pessoa. Nada aqui contata ninguém.
 */

/** Pesquisas na fila ou rodando ao mesmo tempo. */
export const MAX_OPEN_RESEARCH = 3;
/** Buscas por lote (uma tarefa da fila). */
export const RESEARCH_BATCH_SIZE = 5;
const RESULTS_PER_QUERY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Prazo da pesquisa e da pessoa coberta pela LIA (até 12 meses). */
const RETENTION_DAYS = 365;
/** Pessoa sem LIA que a cubra (migração de pessoas). */
const UNCOVERED_RETENTION_DAYS = 90;
const MAX_REVISIONS = 30;
/** Texto fixo cuja assinatura identifica a chave das pessoas (`people_key_checks`). */
const PEOPLE_KEY_CHECK = 'prospector:people-key-check:v1';
const FAILED_DEFAULT =
  'A pesquisa parou por uma falha repetida. O que já foi achado continua guardado.';
const INTERRUPTED =
  'A busca foi interrompida antes de terminar o lote (o app fechou ou a tarefa demorou demais).';

export interface StartResearchResult {
  research: CopilotResearch;
  /** Premissas adotadas sem perguntar (Parte 6.6). */
  assumptions: string[];
  profileReason: ResearchInterpretation['profileReason'];
}

export interface ReviseResearchResult {
  research: CopilotResearch;
  change: string;
  cancelled: boolean;
}

export interface ResearchService {
  /** O texto é um pedido de pesquisa extensa? null = não (segue para o modelo). */
  interpret(text: string): ResearchInterpretation | null;
  start(ctx: RequestContext, raw: unknown): Promise<StartResearchResult>;
  /** Mudança numa pesquisa da conversa. Não entendida: AppError `research_revision_not_understood`. */
  revise(ctx: RequestContext, raw: unknown): Promise<ReviseResearchResult>;
  /** Retomar de onde parou (botão da tela; o mesmo que pedir "continue a pesquisa"). */
  resume(ctx: RequestContext, raw: unknown): Promise<ReviseResearchResult>;
  /** O texto pede uma mudança numa pesquisa? (sem gravar nada) */
  isRevision(text: string, research: CopilotResearch): boolean;
  cancel(ctx: RequestContext, raw: unknown): Promise<CopilotResearch>;
  /**
   * Opt-out de uma pessoa achada (regra 7): final; os meios de contato somem, o trecho fica só com
   * o nome e a identidade (com as variações e o e-mail) entra na supressão.
   */
  optOutPerson(ctx: RequestContext, raw: unknown): Promise<void>;
  get(ctx: RequestContext, id: string): Promise<CopilotResearch>;
  /** A pesquisa mais recente da conversa (o contexto que um pedido seguinte muda). */
  latestForThread(ctx: RequestContext, threadId: string): Promise<CopilotResearch | null>;
  listForThread(ctx: RequestContext, threadId: string): Promise<CopilotResearch[]>;
  listRecent(ctx: RequestContext, limit?: number): Promise<CopilotResearch[]>;
  /** `approachable` é conferido de novo a cada leitura (LIA em vigor hoje, supressão). */
  listItems(
    ctx: RequestContext,
    researchId: string,
    options?: { limit?: number; offset?: number },
  ): Promise<ResearchItemView[]>;
  /**
   * Resultados para baixar (CSV), sem quem pediu opt-out: a saída de dados de pessoas do app fica
   * na auditoria (`copilot.research.exported`, com a quantidade de linhas, sem os dados).
   */
  exportItems(
    ctx: RequestContext,
    researchId: string,
  ): Promise<{ research: CopilotResearch; items: ResearchItemView[] }>;
  /** Um lote por tarefa da fila (`copilot_research`). */
  readonly jobHandler: JobHandler;
}

type PersonKey = (normalized: string) => Promise<string>;

export interface ResearchServiceDeps {
  research: ResearchRepository;
  threads: Pick<CopilotRepository, 'getThread'>;
  webResearch: Pick<WebResearchService, 'status' | 'search'>;
  lia: Pick<StrategyRepository, 'listLiaVersions'>;
  /** Trilha de auditoria para leituras que tiram dados do app (exportação). */
  audit: Pick<AuditRepository, 'append'>;
  /**
   * HMAC-SHA256 (segredo do servidor, ADR-0006) de um texto já normalizado, em hexadecimal. null =
   * segredo não configurado: pessoas achadas são só contadas, nunca guardadas (KI-222).
   */
  personKey: PersonKey | null;
  /** Buscador sintético (modo de demonstração, só em memória): a pesquisa sai com selo DEMO. */
  demo?: boolean;
  batchSize?: number;
  clock?: Clock;
  log?: (message: string) => void;
}

/** Texto normalizado da identidade (sem acento, minúsculo, espaços simples). */
export function normalizeIdentity(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** HMAC-SHA256 em hexadecimal com o segredo do servidor (o app passa o segredo, nunca o loga). */
export function createPersonKeyHasher(secret: string): PersonKey {
  const key = crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return async (normalized) => {
    const signature = await crypto.subtle.sign(
      'HMAC',
      await key,
      new TextEncoder().encode(normalized),
    );
    return [...new Uint8Array(signature)].map((b) => b.toString(16).padStart(2, '0')).join('');
  };
}

/** Dados da pessoa que a LIA precisa listar (mesma regra do gatilho `app.guard_person_lia`). */
function neededCategories(candidate: ExtractedCandidate): LiaDataCategory[] {
  const needed: LiaDataCategory[] = ['name'];
  if (candidate.roleTitle) needed.push('role_title');
  if (candidate.email) needed.push('work_email');
  if (candidate.profession) needed.push('profession');
  if (candidate.organization) needed.push('organization');
  if (candidate.city || candidate.uf) needed.push('location');
  return needed;
}

/** Versão da LIA que cobre a pessoa, ou null (guardada sem base para abordagem). */
export function coveringLiaVersion(
  versions: readonly LiaVersion[],
  today: string,
  candidate: ExtractedCandidate,
): number | null {
  const lia = effectiveLia(versions, today);
  if (lia.status !== 'approved') return null;
  const content = lia.version.content;
  if (!content.dataSources.includes(candidate.sourceKind)) return null;
  const covered = neededCategories(candidate).every((category) =>
    content.dataCategories.includes(category),
  );
  return covered ? lia.version.version : null;
}

/**
 * Domínios de uma organização para conferir a supressão do Relacionamento: o host do site e do
 * e-mail, com e sem subdomínio (`agenda.clinica.com.br` → também `clinica.com.br`).
 */
export function organizationDomains(website: string | null, email: string | null): string[] {
  const hosts = [website ? hostOf(website) : null, email?.split('@')[1]?.toLowerCase() ?? null];
  const out = new Set<string>();
  for (const host of hosts) {
    if (!host) continue;
    out.add(host);
    out.add(registrableDomain(host));
  }
  return [...out];
}

/** O que a regra de mudança precisa saber da pesquisa. */
function revisionContext(research: CopilotResearch) {
  return {
    requestedCount: research.requestedCount,
    terms: [research.criteria.profession, ...research.criteria.terms],
  };
}

function stopFor(
  research: Pick<CopilotResearch, 'foundCount' | 'requestedCount' | 'creditCap'>,
  progress: ResearchProgress,
  queries: readonly ResearchQuery[],
): ResearchStopReason | null {
  if (research.foundCount >= research.requestedCount) return 'count_reached';
  if (progress.creditsUsed >= research.creditCap) return 'credit_cap';
  if (!queries.some((query) => query.status === 'pending')) return 'sources_exhausted';
  return null;
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export function createResearchService(deps: ResearchServiceDeps): ResearchService {
  const clock = deps.clock ?? systemClock;
  const batchSize = deps.batchSize ?? RESEARCH_BATCH_SIZE;
  const log = deps.log ?? ((message: string) => console.warn(message));
  /** Resultado da conferência da chave das pessoas (uma vez por processo). */
  let keyCheck: Promise<boolean> | null = null;

  function nowIso(): string {
    return clock.now().toISOString();
  }

  function daysFrom(at: string, days: number): string {
    return new Date(Date.parse(at) + days * DAY_MS).toISOString();
  }

  /**
   * A chave deste computador é a mesma que gravou as pessoas? A primeira gravação fixa a impressão
   * no banco; outra chave geraria identidades novas e a supressão deixaria de reconhecer quem pediu
   * opt-out, então nada de pessoa é gravado até a chave certa voltar.
   */
  async function peopleKey(): Promise<{ key: PersonKey | null; mismatch: boolean }> {
    const key = deps.personKey;
    if (!key) return { key: null, mismatch: false };
    keyCheck ??= (async () => {
      const mine = await key(PEOPLE_KEY_CHECK);
      return (await deps.research.ensurePeopleKeyCheck(mine)) === mine;
    })();
    try {
      const matches = await keyCheck;
      return matches ? { key, mismatch: false } : { key: null, mismatch: true };
    } catch (error) {
      keyCheck = null;
      throw error;
    }
  }

  async function monthlyCreditsLeft(ctx: RequestContext): Promise<number | null> {
    const status = await deps.webResearch.status(ctx);
    if (status.search !== 'enabled') {
      throw new AppError('unavailable', 'research_search_unavailable');
    }
    return status.usage ? status.usage.creditsRemaining : null;
  }

  async function load(id: string): Promise<CopilotResearch> {
    const research = await deps.research.get(id);
    if (!research) throw new AppError('not_found', 'not_found');
    return research;
  }

  function profileName(key: string): string {
    return commercialProfileById(key)?.name ?? key;
  }

  async function cancel(ctx: RequestContext, raw: unknown): Promise<CopilotResearch> {
    const { researchId } = parseInput(ResearchRef, raw);
    // Uma nova leitura se um lote gravou entre a leitura e o cancelamento.
    for (let attempt = 0; ; attempt += 1) {
      const research = await load(researchId);
      if (TERMINAL.has(research.status)) return research;
      const updated = await deps.research.update(
        research,
        {
          status: 'cancelled',
          stopReason: 'cancelled',
          finishedAt: nowIso(),
          progress: { ...research.progress, lastError: null },
          // A versão sobe: o lote que estiver rodando não grava por cima do cancelamento.
          bumpVersion: true,
        },
        pendingAudit(ctx, {
          action: 'copilot.research.cancelled',
          entityType: 'copilot_research',
          entityId: research.id,
          withVersion: true,
        }),
      );
      if (updated) return updated;
      if (attempt >= 1) throw new AppError('conflict', 'concurrent_change');
    }
  }

  /** Mudança (pedido na conversa ou botão da tela), com uma nova leitura se outra gravação chegou antes. */
  async function applyRevision(
    ctx: RequestContext,
    researchId: string,
    request: string,
    intentFor: (research: CopilotResearch) => ResearchRevisionIntent | null,
  ): Promise<ReviseResearchResult> {
    for (let attempt = 0; ; attempt += 1) {
      const research = await load(researchId);
      if (research.status === 'cancelled') throw new AppError('conflict', 'research_cancelled');
      const intent = intentFor(research);
      if (!intent) throw new AppError('validation', 'research_revision_not_understood');
      if (intent.cancel && TERMINAL.has(research.status)) {
        return { research, change: 'A pesquisa já tinha terminado.', cancelled: false };
      }
      if (intent.cancel) {
        const cancelled = await cancel(ctx, { researchId: research.id });
        return { research: cancelled, change: intent.change, cancelled: true };
      }
      if (intent.resume && !TERMINAL.has(research.status)) {
        return { research, change: 'A pesquisa já está em andamento.', cancelled: false };
      }

      const criteria: ResearchCriteria = { ...research.criteria };
      if (intent.ufs) {
        const ufs = intent.ufs;
        criteria.ufs = ufs;
        criteria.priorityUfs = criteria.priorityUfs.filter((uf) => ufs.includes(uf));
      }
      if (intent.priorityUfs) {
        criteria.priorityUfs = intent.priorityUfs;
        if (criteria.ufs.length > 0) {
          criteria.ufs = [...new Set([...criteria.ufs, ...intent.priorityUfs])];
        }
      }
      const requestedCount = Math.min(
        RESEARCH_MAX_COUNT,
        intent.requestedCount ?? research.requestedCount,
      );
      // Buscas já feitas contam mesmo sem crédito (cache de 24 horas): o plano tem uma busca por crédito.
      const used = Math.max(research.progress.creditsUsed, research.progress.queriesDone);
      // Terminada com a quantidade atingida e sem pedir mais: guarda a mudança, não reabre (não
      // haveria o que buscar e a resposta diria "retomada" à toa).
      const reached = research.foundCount >= requestedCount;
      const reopen = TERMINAL.has(research.status) && !reached;
      let creditCap = research.creditCap;
      if (requestedCount > research.requestedCount || reopen) {
        const monthlyLeft = await monthlyCreditsLeft(ctx);
        const extra = creditCapFor(Math.max(1, requestedCount - research.foundCount), monthlyLeft);
        creditCap = Math.min(RESEARCH_MAX_CREDITS, Math.max(creditCap, used + extra));
        if (monthlyLeft === 0 && research.foundCount < requestedCount) {
          throw new AppError('conflict', 'research_budget_exhausted');
        }
      }
      creditCap = Math.max(1, creditCap);
      const queries = replanResearch(research.plan.queries, criteria, creditCap);
      const revision: ResearchRevision = {
        at: nowIso(),
        request: request.slice(0, 500),
        change: intent.change.slice(0, 240),
      };
      const patch: ResearchPatch = {
        criteria,
        requestedCount,
        creditCap,
        plan: { queries },
        revisions: [...research.revisions, revision].slice(-MAX_REVISIONS),
        bumpVersion: true,
      };
      if (reopen) {
        patch.status = 'queued';
        patch.stopReason = null;
        patch.finishedAt = null;
        patch.progress = { ...research.progress, lastError: null };
      }
      const updated = await deps.research.update(
        research,
        patch,
        pendingAudit(ctx, {
          action: 'copilot.research.revised',
          entityType: 'copilot_research',
          entityId: research.id,
          withVersion: true,
          diff: { requestedCount, creditCap, reopened: reopen },
        }),
      );
      if (!updated) {
        if (attempt >= 1) throw new AppError('conflict', 'concurrent_change');
        continue;
      }
      const change =
        TERMINAL.has(research.status) && reached
          ? `${revision.change} A quantidade pedida já foi atingida, então nada novo é buscado agora; para buscar mais, peça "mais 20", por exemplo.`
          : revision.change;
      return { research: updated, change, cancelled: false };
    }
  }

  /** Confere de novo a cada leitura: LIA em vigor hoje (mesma versão gravada) e supressão. */
  async function present(items: ResearchItemView[]): Promise<ResearchItemView[]> {
    let current: number | null = null;
    if (items.some((item) => item.kind === 'person')) {
      const lia = effectiveLia(await deps.lia.listLiaVersions(), calendarDate(clock.now()));
      current = lia.status === 'approved' ? lia.version.version : null;
    }
    const domains = items
      .filter((item) => item.kind === 'organization')
      .flatMap((item) => organizationDomains(item.website, item.publicEmail));
    const suppressed =
      domains.length > 0 ? await deps.research.suppressedDomains(domains) : new Set<string>();
    return items.map((item) =>
      item.kind === 'person'
        ? {
            ...item,
            approachable: !item.optedOut && item.liaVersion !== null && item.liaVersion === current,
          }
        : {
            ...item,
            approachable: !organizationDomains(item.website, item.publicEmail).some((domain) =>
              suppressed.has(domain),
            ),
          },
    );
  }

  // ---------------------------------------------------------------------------
  // Lote (tarefa da fila)
  // ---------------------------------------------------------------------------

  interface BatchState {
    research: CopilotResearch;
    queries: ResearchQuery[];
    progress: ResearchProgress;
    foundCount: number;
    /** null = sem chave ou chave trocada: pessoa achada só entra na contagem. */
    personKey: PersonKey | null;
    /** Consultas deste lote, pelo texto (para reaplicar num plano refeito ao mesmo tempo). */
    touched: Map<string, ResearchQuery>;
  }

  function jobContext(job: AiJob, researchId: string): RequestContext {
    return {
      actor: { type: 'agent', agent: 'copilot-research', runId: researchId },
      traceId: job.traceId,
    };
  }

  async function addOrganization(
    ctx: RequestContext,
    state: BatchState,
    candidate: ExtractedCandidate,
    query: ResearchQuery,
    keys: Set<string>,
    discard: (reason: string) => false,
  ): Promise<boolean> {
    const { research, progress } = state;
    const dedupeKey = await sha256Hex(`org|${normalizeIdentity(candidate.identity)}`);
    if (keys.has(dedupeKey)) return discard('duplicate');
    // A organização pediu para não ser contatada (Relacionamento) ou o e-mail é de quem pediu
    // opt-out: fica de fora.
    const domains = organizationDomains(candidate.website, candidate.email);
    if (domains.length > 0 && (await deps.research.suppressedDomains(domains)).size > 0) {
      keys.add(dedupeKey);
      return discard('suppressed');
    }
    if (candidate.email && state.personKey) {
      const valueHash = await state.personKey(`email:${candidate.email.toLowerCase()}`);
      if (await deps.research.isSuppressed([{ kind: 'email', valueHash }])) {
        keys.add(dedupeKey);
        return discard('suppressed');
      }
    }
    const verifiedAt = nowIso();
    const retentionUntil = new Date(
      Math.min(
        Date.parse(daysFrom(verifiedAt, RETENTION_DAYS)),
        Date.parse(research.retentionUntil),
      ),
    ).toISOString();
    let result: 'added' | 'duplicate';
    try {
      result = await deps.research.addOrganization(
        {
          researchId: research.id,
          dedupeKey,
          name: candidate.name,
          city: candidate.city,
          uf: candidate.uf,
          website: candidate.website,
          publicEmail: candidate.email,
          publicPhone: candidate.phone,
          sourceUrl: candidate.sourceUrl,
          sourceQuote: candidate.sourceQuote,
          audienceRole: candidate.audienceRole,
          segment: candidate.segment,
          fitReason: candidate.fitReason,
          locationBasis: candidate.locationBasis,
          queryIndex: query.index,
          rank: state.foundCount + 1,
          verifiedAt,
          retentionUntil,
        },
        pendingAudit(ctx, {
          action: 'copilot.research.item_added',
          entityType: 'copilot_research',
          entityId: research.id,
          diff: { kind: 'organization' },
        }),
      );
    } catch (error) {
      // Dado que o banco recusa (trecho longo demais, endereço inválido): fica de fora.
      if (isAppError(error) && error.code === 'validation') return discard('invalid');
      throw error;
    }
    keys.add(dedupeKey);
    if (result === 'duplicate') return discard('duplicate');
    progress.organizations += 1;
    return true;
  }

  async function addCandidate(
    ctx: RequestContext,
    state: BatchState,
    candidate: ExtractedCandidate,
    query: ResearchQuery,
    keys: Set<string>,
    liaVersions: readonly LiaVersion[],
  ): Promise<boolean> {
    const { research, progress } = state;
    const discard = (reason: string): false => {
      progress.discarded[reason] = (progress.discarded[reason] ?? 0) + 1;
      return false;
    };
    if (candidate.kind === 'organization') {
      return addOrganization(ctx, state, candidate, query, keys, discard);
    }

    const key = state.personKey;
    if (!key) {
      progress.peopleNotStored += 1;
      return false;
    }
    const dedupeKey = await key(normalizeIdentity(candidate.identity));
    if (keys.has(dedupeKey)) return discard('duplicate');
    // A identidade gravada e as variações (sem a UF, com a profissão no lugar da organização):
    // quem pediu opt-out não volta por aparecer escrito de outro jeito.
    const probes: SuppressionProbe[] = [{ kind: 'identity', valueHash: dedupeKey }];
    for (const variant of candidate.identityVariants) {
      probes.push({ kind: 'identity', valueHash: await key(normalizeIdentity(variant)) });
    }
    if (candidate.email) {
      probes.push({
        kind: 'email',
        valueHash: await key(`email:${candidate.email.toLowerCase()}`),
      });
    }
    if (await deps.research.isSuppressed(probes)) {
      keys.add(dedupeKey);
      return discard('suppressed');
    }
    const verifiedAt = nowIso();
    const liaVersion = coveringLiaVersion(liaVersions, calendarDate(clock.now()), candidate);
    const person = (lia: number | null) => {
      const retentionUntil = daysFrom(
        verifiedAt,
        lia === null ? UNCOVERED_RETENTION_DAYS : RETENTION_DAYS,
      );
      return {
        researchId: research.id,
        profileKey: research.profileKey,
        dedupeKey,
        fullName: candidate.name,
        profession: candidate.profession,
        roleTitle: candidate.roleTitle,
        organizationName: candidate.organization,
        city: candidate.city,
        uf: candidate.uf,
        workEmail: candidate.email,
        sourceUrl: candidate.sourceUrl,
        sourceKind: candidate.sourceKind,
        sourceQuote: candidate.sourceQuote,
        audienceRole: candidate.audienceRole,
        verifiedAt,
        liaVersion: lia,
        retentionUntil,
        segment: candidate.segment,
        fitReason: candidate.fitReason,
        locationBasis: candidate.locationBasis,
        queryIndex: query.index,
        rank: state.foundCount + 1,
        itemRetentionUntil: retentionUntil,
      };
    };
    const audit = (lia: number | null) => ({
      person: pendingAudit(ctx, {
        action: 'copilot.research.person_found',
        entityType: 'people',
        diff: { researchId: research.id, covered: lia !== null },
      }),
      item: pendingAudit(ctx, {
        action: 'copilot.research.item_added',
        entityType: 'copilot_research',
        entityId: research.id,
        diff: { kind: 'person' },
      }),
    });
    let result;
    try {
      result = await deps.research.addPerson(person(liaVersion), audit(liaVersion));
    } catch (error) {
      if (isAppError(error) && error.reason === 'person_suppressed') {
        keys.add(dedupeKey);
        return discard('suppressed');
      }
      if (isAppError(error) && error.code === 'validation') return discard('invalid');
      // A LIA mudou entre a leitura e a escrita: guarda sem base para abordagem (90 dias).
      if (isAppError(error) && error.reason === 'person_lia_not_covering' && liaVersion !== null) {
        result = await deps.research.addPerson(person(null), audit(null));
      } else {
        throw error;
      }
    }
    keys.add(dedupeKey);
    if (result === 'duplicate') return discard('duplicate');
    if (result === 'opted_out') return discard('opted_out');
    progress.people += 1;
    return true;
  }

  /**
   * Grava o lote. Se a pessoa mudou a pesquisa no meio, reaplica o lote no plano novo; se outro
   * lote já gravou (tarefa repetida), devolve `superseded` e não grava por cima.
   */
  async function saveBatch(
    ctx: RequestContext,
    state: BatchState,
    finishing: ResearchStopReason | null,
    failed = false,
  ): Promise<CopilotResearch | 'superseded' | null> {
    let base = state.research;
    let queries = state.queries;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const stop = failed
        ? null
        : (finishing ??
          stopFor({ ...base, foundCount: state.foundCount }, state.progress, queries));
      const done = failed || stop !== null;
      const saved = await deps.research.update(
        base,
        {
          plan: { queries },
          progress: state.progress,
          foundCount: state.foundCount,
          status: failed ? 'failed' : done ? 'done' : 'running',
          stopReason: stop,
          finishedAt: done ? nowIso() : null,
        },
        pendingAudit(ctx, {
          action: failed
            ? 'copilot.research.failed'
            : done
              ? 'copilot.research.finished'
              : 'copilot.research.batch_done',
          entityType: 'copilot_research',
          entityId: base.id,
          diff: {
            batch: state.progress.batches,
            found: state.foundCount,
            credits: state.progress.creditsUsed,
            ...(stop ? { stopReason: stop } : {}),
          },
        }),
      );
      if (saved) return saved;
      const fresh = await deps.research.get(base.id);
      if (!fresh || TERMINAL.has(fresh.status)) return fresh;
      if (fresh.progress.batches > state.research.progress.batches) return 'superseded';
      base = fresh;
      queries = fresh.plan.queries.map((query) => {
        const ran = state.touched.get(query.query);
        return ran
          ? { ...query, status: ran.status, results: ran.results, added: ran.added }
          : query;
      });
    }
    return null;
  }

  /** Encerra como falha a pesquisa da tarefa, se a tarefa ainda for a do estado atual. */
  async function markFailed(
    job: AiJob,
    payload: CopilotResearchJobPayload,
    cause: string | null,
  ): Promise<void> {
    const research = await deps.research.get(payload.researchId);
    if (!research || TERMINAL.has(research.status)) return;
    // Tarefa velha: a pesquisa mudou ou outro lote já rodou (a tarefa atual segue na fila).
    if (research.version !== payload.version || research.progress.batches !== payload.batch) return;
    await deps.research.update(
      research,
      {
        status: 'failed',
        stopReason: null,
        finishedAt: nowIso(),
        // A causa registrada pelo lote fica; só sem causa entra o texto genérico.
        progress: {
          ...research.progress,
          lastError: cause ?? research.progress.lastError ?? FAILED_DEFAULT,
        },
      },
      pendingAudit(jobContext(job, research.id), {
        action: 'copilot.research.failed',
        entityType: 'copilot_research',
        entityId: research.id,
      }),
    );
  }

  async function runBatch(job: AiJob, signal: AbortSignal): Promise<JobOutcome> {
    const payload = CopilotResearchJobPayload.safeParse(job.payload);
    if (!payload.success) return { status: 'failed', errorCode: 'invalid_payload' };
    const research = await deps.research.get(payload.data.researchId);
    if (!research || TERMINAL.has(research.status)) return { status: 'succeeded' };
    // Tarefa velha (a pesquisa mudou ou outro lote já rodou): a do estado atual está na fila.
    if (
      payload.data.version !== research.version ||
      payload.data.batch !== research.progress.batches
    ) {
      return { status: 'succeeded' };
    }
    const ctx = jobContext(job, research.id);
    let current = research;
    if (research.status !== 'running') {
      const running = await deps.research.update(
        research,
        { status: 'running' },
        pendingAudit(ctx, {
          action: 'copilot.research.started',
          entityType: 'copilot_research',
          entityId: research.id,
        }),
      );
      // Mudou ao mesmo tempo: a tarefa do estado novo já está na fila.
      if (!running) return { status: 'succeeded' };
      current = running;
    }
    const wantsPeople = current.criteria.entityKinds.includes('person');
    // A chave serve também para conferir o e-mail de organização contra o opt-out de pessoas.
    const people = await peopleKey();
    const state: BatchState = {
      research: current,
      queries: current.plan.queries.map((query) => ({ ...query })),
      progress: ResearchProgress.parse(structuredClone(current.progress)),
      // A contagem vem dos itens gravados: um lote repetido depois de cair no meio não conta duas
      // vezes, e pessoa apagada (prazo, opt-out) sai da conta.
      foundCount: await deps.research.countItems(current.id),
      personKey: people.key,
      touched: new Map(),
    };
    state.progress.lastError = null;
    state.progress.keyMismatch = wantsPeople && people.mismatch;

    const already = stopFor(
      { ...current, foundCount: state.foundCount },
      state.progress,
      state.queries,
    );
    if (already) {
      await saveBatch(ctx, state, already);
      return { status: 'succeeded' };
    }

    const room = Math.max(0, current.creditCap - state.progress.creditsUsed);
    const batch = nextBatch(state.queries, Math.min(batchSize, room));
    const keys = await deps.research.itemKeys(current.id);
    const liaVersions = wantsPeople && state.personKey ? await deps.lia.listLiaVersions() : [];
    const name = profileName(current.profileKey);
    let finishing: ResearchStopReason | null = null;
    let retryAfter: number | null = null;

    for (const planned of batch) {
      if (signal.aborted) break;
      const query = state.queries.find((item) => item.index === planned.index);
      if (!query) continue;
      const outcome = await deps.webResearch.search(ctx, {
        query: query.query,
        maxResults: RESULTS_PER_QUERY,
        region: 'br',
      });
      if (!outcome.ok) {
        state.progress.lastError = outcome.message.slice(0, 240);
        if (outcome.failure === 'budget_exhausted' || outcome.failure === 'quota_exceeded') {
          finishing = 'budget_exhausted';
        } else if (
          outcome.failure === 'disabled' ||
          outcome.failure === 'not_configured' ||
          outcome.failure === 'unauthorized'
        ) {
          finishing = 'search_unavailable';
        } else {
          retryAfter = Math.max(30, outcome.retryAfterSeconds ?? 60);
        }
        break;
      }
      state.progress.creditsUsed += outcome.creditsCharged;
      let added = 0;
      for (const result of outcome.results) {
        if (state.foundCount >= current.requestedCount) break;
        const extraction = extractCandidates(
          {
            url: result.url,
            title: result.title,
            snippet: result.snippet,
            query: { index: query.index, uf: query.uf, city: query.city },
          },
          current.criteria,
          name,
        );
        if (extraction.discarded) {
          const reason = extraction.discarded;
          state.progress.discarded[reason] = (state.progress.discarded[reason] ?? 0) + 1;
        }
        for (const candidate of extraction.candidates) {
          if (state.foundCount >= current.requestedCount) break;
          if (!current.criteria.entityKinds.includes(candidate.kind)) continue;
          if (await addCandidate(ctx, state, candidate, query, keys, liaVersions)) {
            state.foundCount += 1;
            added += 1;
          }
        }
      }
      query.status = 'done';
      query.results = Math.min(50, outcome.results.length);
      query.added = Math.min(50, added);
      state.touched.set(query.query, { ...query });
      state.progress.queriesDone += 1;
    }

    // Lote completo: o número sobe e o banco põe o seguinte na fila. Falha passageira do buscador
    // (pausa pedida, fora do ar) ou interrupção: grava o que rodou e a mesma tarefa volta depois
    // da espera; na última tentativa a pesquisa termina como falha, com a causa guardada.
    const transient = finishing === null && (retryAfter !== null || signal.aborted);
    const lastAttempt = job.attempts >= job.maxAttempts;
    if (signal.aborted && state.progress.lastError === null) state.progress.lastError = INTERRUPTED;
    if (!transient) state.progress.batches += 1;
    const saved = await saveBatch(ctx, state, finishing, transient && lastAttempt);
    if (saved === 'superseded') return { status: 'succeeded' };
    if (!saved) {
      log(`[pesquisa] lote de ${current.id} não foi gravado (mudanças simultâneas)`);
      if (lastAttempt) {
        await markFailed(job, payload.data, null);
        return { status: 'failed', errorCode: 'concurrent_change' };
      }
      return { status: 'retry', errorCode: 'concurrent_change', retryAfterSeconds: 30 };
    }
    if (saved.status === 'cancelled') return { status: 'cancelled', errorCode: null };
    const errorCode = retryAfter !== null ? 'search_unavailable' : 'interrupted';
    if (saved.status === 'failed') return { status: 'failed', errorCode };
    if (saved.status === 'running' && transient) {
      return { status: 'retry', errorCode, retryAfterSeconds: retryAfter ?? 30 };
    }
    return { status: 'succeeded' };
  }

  const jobHandler: JobHandler = {
    run: runBatch,
    async abandon(job) {
      const payload = CopilotResearchJobPayload.safeParse(job.payload);
      if (!payload.success) return;
      await markFailed(job, payload.data, null);
    },
  };

  return {
    interpret(text) {
      return interpretResearchRequest(text, COMMERCIAL_PROFILES);
    },

    async start(ctx, raw) {
      const input = parseInput(StartResearchInput, raw);
      const interpretation = interpretResearchRequest(input.request, COMMERCIAL_PROFILES);
      if (!interpretation) throw new AppError('validation', 'research_not_understood');
      const thread = await deps.threads.getThread(input.threadId);
      if (!thread) throw new AppError('not_found', 'not_found');
      const monthlyLeft = await monthlyCreditsLeft(ctx);
      if (monthlyLeft === 0) throw new AppError('conflict', 'research_budget_exhausted');
      if ((await deps.research.countOpen()) >= MAX_OPEN_RESEARCH) {
        throw new AppError('conflict', 'research_queue_full');
      }

      const assumptions = [...interpretation.criteria.assumptions];
      const profileKey = interpretation.profileId ?? DEFAULT_COMMERCIAL_PROFILE_ID;
      if (!interpretation.profileId) {
        assumptions.unshift(
          `Sem perfil comercial claro no pedido: ${profileName(profileKey)} (o perfil padrão).`,
        );
      }
      const creditCap = creditCapFor(interpretation.requestedCount, monthlyLeft);
      if (monthlyLeft !== null && monthlyLeft < creditCapFor(interpretation.requestedCount, null)) {
        assumptions.push(
          `Restam ${monthlyLeft} buscas no mês: a pesquisa usa no máximo ${creditCap} e pode parar antes da quantidade pedida.`,
        );
      }
      const criteria: ResearchCriteria = {
        ...interpretation.criteria,
        assumptions: assumptions.slice(0, 8).map((text) => text.slice(0, 240)),
      };
      const createdAt = nowIso();
      const research = await deps.research.create(
        {
          threadId: thread.id,
          profileKey,
          request: input.request,
          objective: interpretation.objective.slice(0, 300),
          audience: interpretation.audience.slice(0, 120),
          criteria,
          requestedCount: interpretation.requestedCount,
          plan: { queries: planResearch(criteria, creditCap) },
          creditCap,
          traceId: ctx.traceId,
          retentionUntil: daysFrom(createdAt, RETENTION_DAYS),
          ...(deps.demo ? { isDemo: true } : {}),
        },
        pendingAudit(ctx, {
          action: 'copilot.research.created',
          entityType: 'copilot_research',
          diff: {
            requestedCount: interpretation.requestedCount,
            creditCap,
            profile: profileKey,
          },
        }),
      );
      return {
        research,
        assumptions: criteria.assumptions,
        profileReason: interpretation.profileReason,
      };
    },

    isRevision(text, research) {
      return interpretResearchRevision(text, revisionContext(research)) !== null;
    },

    async revise(ctx, raw) {
      const input = parseInput(ReviseResearchInput, raw);
      return applyRevision(ctx, input.researchId, input.request, (research) =>
        interpretResearchRevision(input.request, revisionContext(research)),
      );
    },

    async resume(ctx, raw) {
      const { researchId } = parseInput(ResearchRef, raw);
      return applyRevision(ctx, researchId, 'Retomar a pesquisa (botão da tela).', () => ({
        resume: true,
        change: 'Pesquisa retomada de onde parou.',
      }));
    },

    cancel,

    async optOutPerson(ctx, raw) {
      const { researchId, itemId } = parseInput(ResearchItemRef, raw);
      const items = await deps.research.listItems(researchId, {
        limit: RESEARCH_MAX_COUNT,
        offset: 0,
      });
      const item = items.find((entry) => entry.id === itemId);
      if (!item || item.kind !== 'person' || !item.personId) {
        throw new AppError('not_found', 'not_found');
      }
      // A identidade gravada entra pelo gatilho do banco; aqui vão as variações e o e-mail (com a
      // chave certa; com a chave trocada, os hashes não reconheceriam ninguém).
      const suppressions: SuppressionProbe[] = [];
      const { key } = await peopleKey();
      if (key) {
        const { variants } = personIdentities({
          name: item.name,
          uf: item.uf,
          organization: item.organization,
          profession: item.profession,
        });
        for (const variant of variants) {
          suppressions.push({ kind: 'identity', valueHash: await key(normalizeIdentity(variant)) });
        }
        if (item.publicEmail) {
          suppressions.push({
            kind: 'email',
            valueHash: await key(`email:${item.publicEmail.toLowerCase()}`),
          });
        }
      }
      const done = await deps.research.optOutPerson(
        { personId: item.personId, suppressions },
        pendingAudit(ctx, {
          action: 'copilot.research.person_opted_out',
          entityType: 'people',
          entityId: item.personId,
          diff: { researchId },
        }),
      );
      if (!done) throw new AppError('not_found', 'not_found');
    },

    async get(_ctx, id) {
      return load(parseInput(ResearchRef, { researchId: id }).researchId);
    },

    async latestForThread(_ctx, threadId) {
      const [latest] = await deps.research.listForThread(threadId, 1);
      return latest ?? null;
    },

    async listForThread(_ctx, threadId) {
      return deps.research.listForThread(threadId, 20);
    },

    async listRecent(_ctx, limit = 20) {
      return deps.research.listRecent(Math.min(100, Math.max(1, limit)));
    },

    async listItems(_ctx, researchId, options = {}) {
      const { researchId: id } = parseInput(ResearchRef, { researchId });
      return present(
        await deps.research.listItems(id, {
          limit: Math.min(RESEARCH_MAX_COUNT, Math.max(1, options.limit ?? 100)),
          offset: Math.max(0, options.offset ?? 0),
        }),
      );
    },

    async exportItems(ctx, researchId) {
      const research = await load(parseInput(ResearchRef, { researchId }).researchId);
      const all = await present(
        await deps.research.listItems(research.id, { limit: RESEARCH_MAX_COUNT, offset: 0 }),
      );
      // Quem pediu opt-out não sai em planilha nenhuma.
      const items = all.filter((item) => !item.optedOut);
      // A saída fica registrada antes de o arquivo sair; sem registro, não sai.
      await deps.audit.append({
        ...auditActor(ctx.actor),
        action: 'copilot.research.exported',
        entityType: 'copilot_research',
        entityId: research.id,
        diff: {
          format: 'csv',
          rows: items.length,
          people: items.filter((item) => item.kind === 'person').length,
        },
        traceId: ctx.traceId,
      });
      return { research, items };
    },

    jobHandler,
  };
}
