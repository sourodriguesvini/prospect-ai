import type {
  AiErrorCode,
  AiTask,
  AnalysisAgent,
  BrandCapture,
  BrandCaptureFailure,
  BusinessAnalysisOutput,
  CaptureImage,
  CaptureViewport,
  Company,
  CompanyInvestigationSummary,
  CompetitiveAnalysisOutput,
  CompetitorKind,
  CompetitorTriageOutput,
  DiagnosisOutput,
  Diagnosis,
  EpistemicType,
  Investigation,
  InvestigationChange,
  InvestigationIssueCode,
  InvestigationModelUse,
  InvestigationSnapshot,
  InvestigationStatus,
  InvestigationStep,
  InvestigationTrigger,
  InvestigationUsage,
  StoredCapture,
  VisualAuditOutput,
} from '@prospector/contracts';
import type { PendingAudit } from './audit-repository';

// -----------------------------------------------------------------------------
// Registro das investigações (`company_investigations`, ADR-0015)
// -----------------------------------------------------------------------------

export interface NewInvestigation {
  id: string;
  companyId: string;
  trigger: InvestigationTrigger;
  pipelineVersion: number;
  steps: InvestigationStep[];
  previousId: string | null;
  isDemo: boolean;
}

/** Campos que a execução atualiza (ausente = não muda). */
export interface InvestigationPatch {
  status?: InvestigationStatus;
  steps?: InvestigationStep[];
  usage?: InvestigationUsage;
  models?: InvestigationModelUse[];
  diagnosis?: Diagnosis | null;
  snapshot?: InvestigationSnapshot | null;
  changes?: InvestigationChange[];
  issue?: InvestigationIssueCode | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  jobId?: string | null;
  /** Dono da execução (processo) e batimento: base da recuperação depois de reinício. */
  runner?: string | null;
  heartbeatAt?: string | null;
}

/**
 * Persistência das investigações. Início, cancelamento e conclusão gravam a auditoria junto
 * (ADR-0010); o progresso das etapas não é auditado (muda a cada poucos segundos).
 * Erros: AppError('not_found') para empresa inexistente; AppError('conflict',
 * 'investigation_running') quando já há investigação ativa da empresa.
 */
export interface InvestigationRepository {
  create(row: NewInvestigation, audit: PendingAudit): Promise<Investigation>;
  get(id: string): Promise<Investigation | null>;
  /** Mais recentes primeiro. */
  listForCompany(companyId: string, limit: number): Promise<Investigation[]>;
  /** null quando a investigação não existe. */
  update(id: string, patch: InvestigationPatch): Promise<Investigation | null>;
  /**
   * Atualiza e audita (conclusão, retomada). Ao concluir (`succeeded` ou `partial`) atualiza também
   * `companies.last_investigated_at`, na mesma transação. Voltar para `queued` com outra ativa da
   * mesma empresa: AppError('conflict','investigation_running').
   */
  updateAudited(
    id: string,
    patch: InvestigationPatch,
    audit: PendingAudit,
  ): Promise<Investigation | null>;
  /** Marca o pedido de cancelamento; false se ela já terminou (nada gravado nem auditado). */
  requestCancel(id: string, at: string, audit: PendingAudit): Promise<boolean>;
  /**
   * Batimento: marca dono e hora nas investigações ativas (`queued`/`running`) da lista, sem
   * auditoria. Devolve as que têm pedido de cancelamento.
   */
  touch(ids: readonly string[], runner: string, at: string): Promise<string[]>;
  /**
   * Investigações ativas cujo batimento parou antes de `staleBefore` (processo encerrado no
   * meio; sem batimento, conta a última atualização): passam a `interrupted`. Devolve quantas.
   */
  interruptStale(staleBefore: string, at: string): Promise<number>;
  /** Última investigação de cada empresa pedida (lista de empresas). */
  summaries(companyIds: readonly string[]): Promise<CompanyInvestigationSummary[]>;
  /**
   * Grava o domínio confirmado como site oficial da empresa (e a chave `domain`), com auditoria.
   * null se a empresa não existe; AppError('conflict','company_duplicate') se outra já usa o domínio.
   */
  confirmSite(companyId: string, domain: string, audit: PendingAudit): Promise<Company | null>;
}

// -----------------------------------------------------------------------------
// Captura da marca (Playwright em @prospector/integrations) e armazenamento das imagens
// -----------------------------------------------------------------------------

export type BrandCaptureResult =
  { ok: true; capture: BrandCapture } | { ok: false; failure: BrandCaptureFailure };

/**
 * Captura da página inicial numa janela de computador ou celular: imagem comprimida (JPEG, altura
 * limitada) e medições calculadas pelo navegador. Mesmas proteções do leitor de páginas (SSRF,
 * robots.txt, sites com termos restritivos, sandbox, prazo total). Nunca lança por falha do site.
 */
export interface BrandCapturer {
  capture(
    url: string,
    viewport: CaptureViewport,
    options?: { signal?: AbortSignal },
  ): Promise<BrandCaptureResult>;
}

/**
 * Guarda as imagens das capturas. Hoje uma pasta local fora do disco do sistema
 * (`PROSPECTOR_CAPTURES_DIR`); depois, um bucket privado do Supabase (pendente de aprovação).
 * `storagePath` é relativo e opaco: só o próprio armazenamento o resolve.
 */
export interface CaptureStore {
  put(input: {
    companyId: string;
    investigationId: string;
    viewport: CaptureViewport;
    image: CaptureImage;
    capturedAt: string;
  }): Promise<StoredCapture>;
  /** null = não existe (ou caminho inválido). */
  get(storagePath: string): Promise<{ bytes: Uint8Array; mime: 'image/jpeg' } | null>;
  /**
   * Apaga a imagem (substituída por uma captura mais nova). Caminho inválido ou arquivo que não
   * existe não é erro.
   */
  delete(storagePath: string): Promise<void>;
}

// -----------------------------------------------------------------------------
// IA local das análises (implementação em @prospector/agents, via raiz de composição)
// -----------------------------------------------------------------------------

/** O que a IA sabe da empresa em toda análise (nada de pessoas). */
export interface AnalysisCompany {
  name: string;
  city: string | null;
  uf: string | null;
  /** Descrição da atividade principal (CNAE), quando conhecida. */
  activity: string | null;
}

/** Item numerado mostrado ao modelo (`ref` curto como `P1`, `M3`, `K7`). */
export interface RefText {
  ref: string;
  text: string;
}

export interface BusinessAnalysisInput {
  company: AnalysisCompany;
  pages: Array<{ ref: string; url: string; category: string; title: string | null; text: string }>;
}

export interface VisualAnalysisInput {
  company: AnalysisCompany;
  rubric: Array<{ key: string; label: string; description: string }>;
  /** Medições das capturas, em frases do sistema. */
  metrics: RefText[];
  /** Imagens comprimidas das capturas disponíveis nesta execução. */
  images: Partial<Record<CaptureViewport, Uint8Array>>;
  /** O que o site diz de si (ofertas, público, proposta), para comparar promessa e aparência. */
  context: RefText[];
}

export interface CompetitorTriageInput {
  company: AnalysisCompany;
  offerings: string[];
  candidates: Array<{ ref: string; domain: string; title: string; snippet: string }>;
}

export interface CompetitiveAnalysisInput {
  company: AnalysisCompany;
  /** Fatos e inferências da empresa investigada. */
  facts: RefText[];
  competitors: Array<{ ref: string; domain: string; kind: CompetitorKind; text: string }>;
}

export interface DiagnosisInput {
  company: AnalysisCompany;
  facts: Array<RefText & { type: EpistemicType; confidence: number | null }>;
  offers: Array<{
    ref: string;
    name: string;
    problems: string[];
    needSignals: string[];
    disqualifiers: string[];
  }>;
  /** O que ainda não se sabe (texto do sistema). */
  gaps: string[];
}

export interface AnalysisInputs {
  'company-business': BusinessAnalysisInput;
  'brand-visual': VisualAnalysisInput;
  'competitor-triage': CompetitorTriageInput;
  competitive: CompetitiveAnalysisInput;
  diagnosis: DiagnosisInput;
}

export interface AnalysisOutputs {
  'company-business': BusinessAnalysisOutput;
  'brand-visual': VisualAuditOutput;
  'competitor-triage': CompetitorTriageOutput;
  competitive: CompetitiveAnalysisOutput;
  diagnosis: DiagnosisOutput;
}

/** `invalid_output`: o modelo respondeu, mas fora do formato (nada é aproveitado). */
export type AnalysisErrorCode = AiErrorCode | 'invalid_output';

/** Uso das gerações de uma análise (somado nas tentativas), para `llm_calls`. */
export interface AnalysisUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Tempo de geração no Ollama (sem a espera na fila do gateway). */
  totalMs: number | null;
  loadMs: number | null;
}

interface AnalysisTelemetry {
  task?: AiTask;
  usage?: AnalysisUsage | null;
  doneReason?: string | null;
}

export type AnalysisResult<A extends AnalysisAgent> =
  | ({
      ok: true;
      output: AnalysisOutputs[A];
      model: string;
      promptVersion: string;
      durationMs: number;
    } & AnalysisTelemetry)
  | ({
      ok: false;
      code: AnalysisErrorCode;
      model: string | null;
      promptVersion: string;
      durationMs: number;
    } & AnalysisTelemetry);

/**
 * Análises da investigação no modelo local, uma chamada por vez, saída em JSON restrito ao
 * contrato (`ANALYSIS_OUTPUT_SCHEMAS`) e validada de novo. Conteúdo de páginas é dado, nunca
 * instrução. Nunca lança por falha do modelo: devolve `ok: false` com o código.
 */
export interface BrandAnalysisAi {
  analyze<A extends AnalysisAgent>(
    agent: A,
    input: AnalysisInputs[A],
    options?: { signal?: AbortSignal },
  ): Promise<AnalysisResult<A>>;
}
