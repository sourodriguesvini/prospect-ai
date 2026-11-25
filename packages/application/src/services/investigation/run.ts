import {
  assertClaimKey,
  type AnalysisAgent,
  type Claim,
  type ClaimDomain,
  type ClaimInputDraft,
  type Company,
  type Diagnosis,
  type Investigation,
  type InvestigationChange,
  type InvestigationIssueCode,
  type InvestigationModelUse,
  type InvestigationSnapshot,
  type InvestigationStepKey,
  type InvestigationUsage,
  type SourceInputDraft,
  type StrategySnapshot,
  type WebPage,
} from '@prospector/contracts';
import {
  effectiveStatus,
  forbiddenAssertion,
  incompleteStatement,
  recordDiscard,
  registryRetentionUntil,
  type VerificationLog,
} from '@prospector/domain';
import { localDay, type Clock } from '../../clock';
import type { RequestContext } from '../../context';
import type { CompanyRepository, EvidenceRepository } from '../../ports/company-repository';
import type {
  AnalysisCompany,
  AnalysisErrorCode,
  AnalysisResult,
  BrandAnalysisAi,
  BrandCapturer,
  CaptureStore,
  InvestigationRepository,
} from '../../ports/investigation';
import type { AiTelemetryRepository } from '../../ports/copilot-repository';
import type { StrategyRepository } from '../../ports/strategy-repository';
import type { EvidenceDraft, EvidenceService } from '../evidence-service';
import { WEBSITE_PAGE_KEY, type WebResearchService } from '../web-research-service';

/**
 * Estado de UMA execução de investigação e utilitários comuns às etapas. As conclusões vão para o
 * ledger a cada etapa (modo tolerante do EvidenceService: o que não passa nas regras fica fora,
 * com o motivo no registro de verificação); as etapas seguintes leem do ledger, não da memória.
 * Isso torna a execução retomável depois de um reinício: só o texto das páginas fica em memória,
 * e é lido de novo quando falta.
 */

export interface InvestigationDeps {
  investigations: InvestigationRepository;
  companies: Pick<CompanyRepository, 'get' | 'identifiers'>;
  evidence: Pick<EvidenceRepository, 'claimsFor' | 'evidenceFor' | 'sourcesByIds'>;
  evidenceService: EvidenceService;
  strategy: Pick<StrategyRepository, 'loadSnapshot'>;
  /** null = pesquisa e leitor indisponíveis nesta instalação. */
  webResearch: WebResearchService | null;
  capturer: BrandCapturer | null;
  /** null = pasta das capturas não configurada (imagens não são guardadas). */
  captureStore: CaptureStore | null;
  ai: BrandAnalysisAi | null;
  /** `llm_calls` (ADR-0005): uma linha por análise, com tokens e tempo de GPU. */
  telemetry?: Pick<AiTelemetryRepository, 'recordLlmCall'> | null;
  clock: Clock;
  newId: () => string;
  log: (message: string) => void;
}

export interface PageMemo {
  ref: string;
  url: string;
  category: string;
  title: string | null;
  text: string;
  contentHash: string;
  fetchedAt: string;
  /** O site pediu para não guardar cópia: a página não vira trecho no ledger. */
  noArchive: boolean;
}

export interface StepOutcome {
  state: 'done' | 'reused' | 'skipped' | 'failed';
  issue?: InvestigationIssueCode | null;
  counts?: Record<string, number>;
}

export interface Run {
  deps: InvestigationDeps;
  id: string;
  ctx: RequestContext;
  company: Company;
  /** Domínios da empresa (fontes deles contam como próprias). */
  ownedOrigins: string[];
  investigation: Investigation;
  previous: Investigation | null;
  force: boolean;
  signal: AbortSignal;
  usage: InvestigationUsage;
  models: InvestigationModelUse[];
  verification: VerificationLog;
  snapshot: InvestigationSnapshot;
  /** URL inicial do site (com esquema) ou null. */
  siteUrl: string | null;
  pages: PageMemo[];
  /** Imagens desta execução (as guardadas também podem vir do CaptureStore). */
  images: Partial<Record<'desktop' | 'mobile', Uint8Array>>;
  /** Claims em vigor da empresa, por chave (atualizado a cada gravação). */
  inForce: Map<string, Claim>;
  /** Ids gravados por esta execução, por tipo. */
  produced: { facts: string[]; inferences: string[]; hypotheses: string[] };
  /** Ids das oportunidades (por oferta) e da síntese, para o diagnóstico. */
  opportunityIds: Map<string, string>;
  summaryClaimId: string | null;
  /** Ids citados pela IA no diagnóstico (fatos que sustentam). */
  citedFactIds: Set<string>;
  /** Saída do diagnóstico por oferta, já conferida (para a qualificação). */
  offerReadings: Map<string, OfferReading>;
  /** Começo do texto dos concorrentes lidos nesta execução (por domínio), para a comparação. */
  competitorTexts: Map<string, string>;
  /** Estado de cada etapa nesta execução (as análises decidem o reaproveitamento por ele). */
  stepStates: Partial<Record<InvestigationStepKey, StepOutcome['state']>>;
  /** Fato "o site publica a página X" em vigor, por URL (refs `P1`… das análises). */
  pageClaims: Map<string, string>;
  /** Estratégia (ofertas, rubricas, ICPs, modelos de score) lida no começo da execução. */
  strategy: StrategySnapshot | null;
  /** Hipóteses do diagnóstico desta execução (ou da anterior, quando reaproveitado). */
  hypothesisIds: string[];
  diagnosis: Diagnosis | null;
  changes: InvestigationChange[];
}

export interface OfferReading {
  relevance: 'strong' | 'moderate' | 'weak' | 'none';
  supporting: Array<{ id: string; confidence: number | null }>;
  flaggedDisqualifiers: number[];
  rationale: string | null;
  openingAngle: string | null;
  objections: string[];
  toVerify: string[];
}

// -----------------------------------------------------------------------------
// Texto, datas e hash
// -----------------------------------------------------------------------------

export function cut(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Dia em pt-BR (DD/MM/AAAA) de uma data ou instante, no fuso da agência (KI-149). */
export function brazilianDay(iso: string): string {
  const [year, month, day] = localDay(iso).split('-');
  return `${day}/${month}/${year}`;
}

export function daysBetween(fromIso: string, to: Date): number {
  const from = Date.parse(fromIso);
  if (Number.isNaN(from)) return 0;
  return Math.max(0, Math.floor((to.getTime() - from) / 86_400_000));
}

/**
 * Vale como evidência atual nesta investigação: nem substituído ou rejeitado, nem vencido
 * (`validUntil` passou) nem contestado (ADR-0002). Vencido e contestado contam como desconhecidos
 * e são coletados de novo, em vez de entrar no diagnóstico com a confiança da época.
 */
export function isInForce(claim: Claim, now: Date): boolean {
  return effectiveStatus(claim, now) === 'active';
}

/**
 * Prazo de guarda das fontes desta investigação: 12 meses, a mesma regra das páginas do ADR-0012
 * (o expurgo e o "arquivada + 90 dias" do doc 06 §6 pendem, KI-084 e KI-136).
 */
export function retention(capturedAt: string): string {
  return registryRetentionUntil(capturedAt);
}

// -----------------------------------------------------------------------------
// Gravação no ledger
// -----------------------------------------------------------------------------

export interface ClaimDraftItem {
  id: string;
  claim: ClaimInputDraft;
  ownedOrigins?: readonly string[];
}

/** Fator de raciocínio dentro da faixa do ledger (docs/08 §2.3). */
export function clampFactor(factor: number): number {
  return Math.round(Math.min(0.9, Math.max(0.5, factor)) * 100) / 100;
}

/** Monta um claim da empresa investigada (sujeito sempre a empresa). */
export function companyClaim(
  run: Run,
  fields: {
    domain: ClaimDomain;
    key: string;
    statement: string;
    epistemicType: 'fact' | 'inference' | 'hypothesis';
    value?: Record<string, unknown> | null;
    evidence?: ClaimInputDraft['evidence'];
    dependsOn?: string[];
    reasoning?: string | null;
    reasoningFactor?: number | null;
  },
): ClaimInputDraft {
  return {
    schemaVersion: 1,
    subjectType: 'company',
    subjectId: run.company.id,
    domain: fields.domain,
    key: assertClaimKey(fields.key),
    statement: cut(fields.statement, 500),
    value: fields.value ?? null,
    epistemicType: fields.epistemicType,
    evidence: fields.evidence ?? [],
    dependsOn: [...new Set(fields.dependsOn ?? [])].slice(0, 20),
    reasoning: fields.reasoning ? cut(fields.reasoning, 800) : null,
    reasoningFactor:
      fields.epistemicType === 'inference' ? clampFactor(fields.reasoningFactor ?? 0.6) : null,
    isDemo: run.company.isDemo,
  };
}

/**
 * Afirmação ou raciocínio proibido (faturamento, intenção de contratar…)? Registra o descarte e
 * devolve true. Vale para tudo que a IA escreve antes de virar claim.
 */
export function rejectedByPolicy(run: Run, ...texts: Array<string | null | undefined>): boolean {
  // A primeira é a afirmação; frase interrompida não vira claim (o raciocínio pode vir encurtado).
  if (texts[0] && incompleteStatement(texts[0])) {
    recordDiscard(run.verification, 'Conclusão descartada: frase interrompida pelo modelo.');
    return true;
  }
  for (const text of texts) {
    if (!text) continue;
    const hit = forbiddenAssertion(text);
    if (hit) {
      recordDiscard(run.verification, `Conclusão descartada: ${hit.reason}.`);
      return true;
    }
  }
  return false;
}

/**
 * Grava fontes e claims de uma etapa no modo tolerante, substituindo a versão em vigor de cada
 * chave. Claims da mesma chave no lote: fica o primeiro. Devolve os ids aceitos.
 */
export async function recordStep(
  run: Run,
  input: {
    action: string;
    sources?: Array<{ id: string; source: SourceInputDraft }>;
    claims: ClaimDraftItem[];
    patch?: { lastInvestigatedAt?: string | null };
  },
): Promise<Set<string>> {
  const seenKeys = new Set<string>();
  const claims: EvidenceDraft['claims'] = [];
  for (const item of input.claims) {
    const key = item.claim.key;
    if (typeof key !== 'string' || seenKeys.has(key)) {
      recordDiscard(run.verification, 'Conclusão repetida na mesma etapa.');
      continue;
    }
    seenKeys.add(key);
    const previous = run.inForce.get(key);
    claims.push({
      id: item.id,
      claim: item.claim,
      supersedes: previous && previous.subjectId === run.company.id ? previous.id : null,
      ...(item.ownedOrigins ? { ownedOrigins: item.ownedOrigins } : {}),
    });
  }
  if (claims.length === 0) return new Set();
  const batch = await run.deps.evidenceService.record(
    run.ctx,
    run.company.id,
    { sources: input.sources ?? [], claims, producedByRunId: run.id },
    {
      action: input.action,
      ownedOrigins: run.ownedOrigins,
      lenient: true,
      ...(input.patch ? { patch: input.patch } : {}),
    },
  );
  for (const rejected of batch.rejected) {
    const first = rejected.issues[0]?.message ?? 'regra do ledger';
    recordDiscard(run.verification, `Conclusão sem suporte suficiente: ${cut(first, 110)}`);
  }
  const accepted = new Set<string>();
  for (const claim of batch.claims) {
    accepted.add(claim.id);
    const full: Claim = {
      ...claim,
      reviewedAt: null,
      createdAt: run.deps.clock.now().toISOString(),
    };
    run.inForce.set(claim.key, full);
    if (claim.epistemicType === 'fact') run.produced.facts.push(claim.id);
    else if (claim.epistemicType === 'inference') run.produced.inferences.push(claim.id);
    else run.produced.hypotheses.push(claim.id);
  }
  return accepted;
}

/** Recarrega os claims em vigor da empresa (início e retomada). */
export async function loadInForce(run: Run): Promise<void> {
  const claims = await run.deps.evidence.claimsFor('company', run.company.id);
  const now = run.deps.clock.now();
  run.inForce = new Map();
  run.pageClaims = new Map();
  // Mais recentes primeiro: a primeira de cada chave é a versão em vigor (as anteriores estão
  // substituídas). Vencida ou contestada, a chave fica sem valor atual.
  for (const claim of claims) {
    if (!isInForce(claim, now)) continue;
    const url = typeof claim.value?.url === 'string' ? claim.value.url : null;
    if (claim.key === WEBSITE_PAGE_KEY && url && !run.pageClaims.has(url)) {
      run.pageClaims.set(url, claim.id);
    }
    if (!run.inForce.has(claim.key)) run.inForce.set(claim.key, claim);
  }
}

export function claimsWithPrefix(run: Run, ...prefixes: string[]): Claim[] {
  return [...run.inForce.values()].filter((claim) =>
    prefixes.some((prefix) => claim.key.startsWith(prefix)),
  );
}

/** O que a IA sabe da empresa em toda análise (nome, praça e atividade; nada de pessoas). */
export function analysisCompany(run: Run): AnalysisCompany {
  const cnae = run.inForce.get('registry.cnae_main')?.value;
  return {
    name: run.company.displayName,
    city: run.company.city,
    uf: run.company.uf,
    activity: typeof cnae?.description === 'string' ? cnae.description : null,
  };
}

export function aiIssue(code: AnalysisErrorCode): InvestigationIssueCode {
  return code === 'invalid_output' ? 'ai_invalid_output' : 'ai_unavailable';
}

/** A etapa terminou com resultado na investigação anterior? */
export function previousOk(run: Run, key: InvestigationStepKey): boolean {
  const step = run.previous?.steps.find((item) => item.key === key);
  return step?.state === 'done' || step?.state === 'reused';
}

/** Mapa id → claim em vigor. */
export function inForceById(run: Run): Map<string, Claim> {
  return new Map([...run.inForce.values()].map((claim) => [claim.id, claim]));
}

/** Corta sem juntar as linhas (o modelo lê melhor o texto com a estrutura). */
export function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

// -----------------------------------------------------------------------------
// Uso e modelos
// -----------------------------------------------------------------------------

export function countSearch(run: Run, creditsCharged: number): void {
  run.usage.searches += 1;
  run.usage.searchCredits += creditsCharged;
}

/**
 * Conta a análise no custo da investigação e grava em `llm_calls`. O tempo de GPU é o da geração
 * no Ollama quando o adaptador o informa (a espera na fila do gateway não conta).
 */
export async function countModel(
  run: Run,
  result: AnalysisResult<AnalysisAgent>,
  agent: AnalysisAgent,
): Promise<void> {
  const gpuMs = result.usage?.totalMs ?? result.durationMs;
  run.usage.modelCalls += 1;
  run.usage.modelMs += Math.max(0, Math.round(gpuMs));
  if (result.model && !run.models.some((use) => use.agent === agent)) {
    run.models.push({ agent, model: result.model, promptVersion: result.promptVersion });
  }
  const telemetry = run.deps.telemetry;
  if (!telemetry) return;
  try {
    await telemetry.recordLlmCall({
      task: result.task ?? (agent === 'brand-visual' ? 'vision' : 'reasoning'),
      provider: 'ollama',
      model: (result.model ?? 'desconhecido').slice(0, 120),
      promptVersion: result.promptVersion,
      traceId: run.ctx.traceId,
      threadId: null,
      jobId: null,
      status: result.ok ? 'ok' : result.code === 'cancelled' ? 'cancelled' : 'error',
      errorCode: result.ok ? null : result.code,
      doneReason: result.doneReason?.slice(0, 40) ?? null,
      inputTokens: result.usage?.inputTokens ?? null,
      outputTokens: result.usage?.outputTokens ?? null,
      totalMs: result.usage?.totalMs ?? null,
      loadMs: result.usage?.loadMs ?? null,
    });
  } catch (error) {
    run.deps.log(
      `[investigação] uso da IA não registrado: ${error instanceof Error ? error.name : 'erro'}`,
    );
  }
}

/** Página em memória a partir do leitor (o texto inteiro nunca vai para o ledger). */
export function pageMemo(page: WebPage, ref: string, category: string): PageMemo {
  return {
    ref,
    url: page.url,
    category,
    title: page.title,
    text: page.noArchive ? '' : page.text,
    contentHash: page.contentHash,
    fetchedAt: page.fetchedAt,
    noArchive: page.noArchive,
  };
}

export type StepImpl = (run: Run) => Promise<StepOutcome>;
export type StepTable = Record<InvestigationStepKey, StepImpl>;
