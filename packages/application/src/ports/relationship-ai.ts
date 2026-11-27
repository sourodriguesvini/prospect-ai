import type {
  AiErrorCode,
  AiReviewKind,
  ApproachBasis,
  ApproachInsights,
  ApproachStrategyContent,
  CompanyLanguage,
  ConfidenceBand,
  MessageChannel,
  MessageKind,
  MessageTone,
  ReplyAnalysis,
  SelectedThesis,
  SourceKind,
  SourceReliabilityTier,
  VoiceGuideContent,
} from '@prospector/contracts';
import type { RequestContext } from '../context';

/**
 * IA local do Relacionamento (ADR-0008, ADR-0014). Implementada em packages/agents (gateway único);
 * aqui só o formato. Tudo que entra no pedido é DADO (dossiê, resposta do prospect, pedido livre do
 * usuário), nunca instrução de sistema. A partir da v2 dos prompts, o adaptador confere a resposta
 * com regras fixas (fonte, tom, pedido, proporção, agência), pede no máximo uma correção ao modelo
 * e conserta a menção de fonte sem chamar de novo (KI-150); o que sobra volta em `review`, só como
 * aviso: aprovar continua sendo decisão humana. O formato (`data`) ainda é validado pelo serviço
 * com Zod.
 */

/**
 * De onde veio uma evidência do claim (KI-150): tipo da fonte, categoria de confiabilidade e host
 * da URL. A IA usa para não atribuir um achado a uma fonte que não é a dele ("o site destaca…"
 * quando veio de um post).
 */
export interface AiClaimSource {
  kind: SourceKind;
  tier: SourceReliabilityTier;
  /** Host da URL, sem `www.`; null quando a fonte não tem URL (cadastro, anotação). */
  host: string | null;
}

/** Claim do dossiê como a IA vê: id para citar, frase, tipo epistêmico e fontes. */
export interface AiClaim {
  id: string;
  domain: string;
  statement: string;
  epistemicType: 'fact' | 'inference' | 'hypothesis';
  band: ConfidenceBand;
  /** Fontes das evidências; vazio quando o claim é derivado de outros (leitura do Prospector). */
  sources?: AiClaimSource[];
}

export interface AiCase {
  id: string;
  title: string;
  segment: string | null;
  summary: string;
  results: string | null;
}

export interface AiCompany {
  displayName: string;
  city: string | null;
  uf: string | null;
  cnaeMain: string | null;
  sizeBand: string | null;
  primaryDomain: string | null;
  /** MEI ou empresa de uma pessoa só: tratar com cuidado (o nome é de uma pessoa). */
  individual: boolean;
}

export interface AiOffer {
  name: string;
  description: string | null;
  problems: string[];
  needSignals: string[];
  deliverables: string[];
  valueProps: string[];
}

export interface AiContext {
  company: AiCompany;
  claims: AiClaim[];
  insights: ApproachInsights;
  /** Ângulo da tese aprovado (Parte 5.1); null/ausente = abordagem só pelo dossiê. */
  thesis?: SelectedThesis | null;
  /** Medida da linguagem pública da empresa (Parte 5.2); null quando há pouco texto dela. */
  language?: CompanyLanguage | null;
  offer: AiOffer;
  voice: VoiceGuideContent | null;
  agencyName: string | null;
  optOutText: string | null;
  cases: AiCase[];
}

export interface ApproachAiRequest extends AiContext {
  basis: ApproachBasis;
  gaps: string[];
  /** Ninguém da agência falou com a empresa ainda (estado das interações registradas). */
  firstContact: boolean;
  kind: MessageKind;
  tone: MessageTone;
  instruction: string | null;
}

export interface MessageAiRequest extends AiContext {
  kind: MessageKind;
  tone: MessageTone;
  channel: MessageChannel;
  firstContact: boolean;
  strategy: ApproachStrategyContent | null;
  /** Versão de partida (nova versão da mesma mensagem). */
  previous: { subject: string | null; body: string } | null;
  /** Resposta do prospect que esta mensagem responde, com a interpretação salva. */
  replyTo: { body: string; analysis: ReplyAnalysis | null } | null;
  instruction: string | null;
}

export interface ReplyAiRequest {
  companyName: string;
  /** Empresa de uma pessoa só (MEI ou empresário individual): o nome é o de uma pessoa. */
  companyIndividual: boolean;
  offerName: string | null;
  agencyName: string | null;
  /** O último texto que o usuário usou com esta empresa (contexto da resposta). */
  lastOutbound: { subject: string | null; body: string } | null;
  replyBody: string;
  cases: AiCase[];
}

export interface AiUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalMs: number | null;
  loadMs: number | null;
}

/**
 * Conferência automática da resposta (prompts v2+ do Relacionamento, KI-150): a correção pedida
 * ao modelo numa segunda chamada e o que ainda ficou. Ausente quando a conferência não achou nada.
 */
export interface AiReview {
  /** Correções pedidas ao modelo (uma segunda chamada, no máximo). */
  corrections: string[];
  /** Avisos para quem revisa: o que a conferência ainda encontra no texto devolvido. */
  unresolved: string[];
  /** Tipos dos avisos em `unresolved`, sem o texto: é o que fica gravado (ADR-0014 item 11). */
  unresolvedKinds?: AiReviewKind[];
  /** Ajustes feitos pelo sistema depois da correção (menção de fonte errada tirada, KI-150). */
  adjusted?: string[];
  /** A primeira resposta (já traduzida), para a avaliação comparar; não vai para o banco. */
  first: unknown;
}

export type AiOutcome =
  | {
      ok: true;
      /** JSON devolvido pelo modelo, ainda não validado. */
      data: unknown;
      promptId: string;
      model: string;
      doneReason: string | null;
      usage: AiUsage | null;
      review?: AiReview;
    }
  | {
      ok: false;
      /** `context_too_large`: nem os DADOS mais enxutos cabem na janela; o modelo não foi chamado. */
      code: AiErrorCode | 'invalid_output' | 'context_too_large';
      promptId: string;
      model: string | null;
      usage: AiUsage | null;
    };

export interface RelationshipAi {
  /**
   * O prompt de estratégia em uso lê a tese aprovada (Parte 5.1; `relationship-approach/v5` em
   * diante). Sem isso, o serviço não grava ângulo nenhum e a tela não oferece a escolha.
   */
  readonly thesisAware?: boolean;
  /** Estratégia + primeira mensagem: `{ strategy, message: { subject, body } }`. */
  approach(request: ApproachAiRequest, signal?: AbortSignal): Promise<AiOutcome>;
  /** Uma mensagem: `{ subject, body }`. */
  message(request: MessageAiRequest, signal?: AbortSignal): Promise<AiOutcome>;
  /** Interpretação da resposta (ReplyAnalysis). */
  analyzeReply(request: ReplyAiRequest, signal?: AbortSignal): Promise<AiOutcome>;
}

/**
 * Insumos de Empresas para a abordagem (diagnóstico, serviço recomendado, qualificação), lidos da
 * investigação mais recente (`createInvestigationInsightsSource`, KI-129). Sem fonte ligada, o
 * serviço usa EMPTY_APPROACH_INSIGHTS.
 */
export interface ApproachInsightsSource {
  forCompany(ctx: RequestContext, companyId: string): Promise<ApproachInsights>;
}
