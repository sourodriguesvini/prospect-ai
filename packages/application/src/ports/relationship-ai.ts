import type {
  AiErrorCode,
  ApproachBasis,
  ApproachInsights,
  ApproachStrategyContent,
  ConfidenceBand,
  MessageChannel,
  MessageKind,
  MessageTone,
  ReplyAnalysis,
  VoiceGuideContent,
} from '@prospector/contracts';
import type { RequestContext } from '../context';

/**
 * IA local do Relacionamento (ADR-0008, ADR-0014). Implementada em packages/agents (gateway único);
 * aqui só o formato. Tudo que entra no pedido é DADO (dossiê, resposta do prospect, pedido livre do
 * usuário), nunca instrução de sistema. A saída volta crua e é validada pelo serviço com Zod.
 */

/** Claim do dossiê como a IA vê: id para citar, frase e tipo epistêmico. */
export interface AiClaim {
  id: string;
  domain: string;
  statement: string;
  epistemicType: 'fact' | 'inference' | 'hypothesis';
  band: ConfidenceBand;
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

export type AiOutcome =
  | {
      ok: true;
      /** JSON devolvido pelo modelo, ainda não validado. */
      data: unknown;
      promptId: string;
      model: string;
      doneReason: string | null;
      usage: AiUsage | null;
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
