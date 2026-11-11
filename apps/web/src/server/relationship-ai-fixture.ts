import 'server-only';
import type {
  AiOutcome,
  ApproachAiRequest,
  MessageAiRequest,
  RelationshipAi,
  ReplyAiRequest,
} from '@prospector/application';

/**
 * IA do Relacionamento SINTÉTICA para os testes de ponta a ponta
 * (`PROSPECTOR_RELATIONSHIP_AI=fixture`). Só funciona no modo memória (o container recusa com
 * banco) e não chama modelo nenhum: devolve textos fixos, que dizem ser de teste, montados com os
 * dados do pedido (nome da agência e ids de claims reais do dossiê). O serviço valida a saída com
 * os mesmos contratos da IA real e grava tudo com a marca de demonstração (`syntheticAi`).
 */

const MODEL = 'fixture-sintetica';
const USAGE = { inputTokens: null, outputTokens: null, totalMs: 0, loadMs: 0 };

function ok(promptId: string, data: unknown): AiOutcome {
  return { ok: true, data, promptId, model: MODEL, doneReason: 'stop', usage: USAGE };
}

function signature(agencyName: string | null): string {
  return agencyName ? `Abraços,\n${agencyName}` : 'Abraços.';
}

function opening(agencyName: string | null): string {
  return agencyName
    ? `Olá! Aqui é da ${agencyName}, agência de branding e identidade visual.`
    : 'Olá! Escrevo de uma agência de branding e identidade visual.';
}

function approach(request: ApproachAiRequest): AiOutcome {
  const claims = request.claims.slice(0, 2);
  return ok('relationship-approach/fixture', {
    strategy: {
      opportunity: `Texto SINTÉTICO de teste: ${request.company.displayName} pode se beneficiar de ${request.offer.name}.`,
      objective: 'conversation',
      counterpartRole: 'Sócios ou direção',
      channel: 'email',
      channelReason: 'Primeiro contato por e-mail, canal padrão (teste).',
      argument: 'Argumento SINTÉTICO de teste ligado ao problema que a oferta resolve.',
      evidence: claims.map((claim) => ({
        statement: `Ponto de teste baseado em: ${claim.statement.slice(0, 200)}`,
        claimIds: [claim.id],
      })),
      nextStep: 'Propor uma conversa de 20 minutos (teste).',
      gaps: request.gaps.slice(0, 3),
      risks: ['Texto gerado por fixture de teste, não por um modelo.'],
      caseIds: [],
    },
    message: {
      subject: `Uma ideia para a ${request.company.displayName}`.slice(0, 60),
      body: [
        opening(request.agencyName),
        `Este é um rascunho SINTÉTICO de teste sobre ${request.offer.name}.`,
        'Faz sentido conversarmos 20 minutos nas próximas semanas?',
        signature(request.agencyName),
      ].join('\n\n'),
    },
  });
}

function message(request: MessageAiRequest): AiOutcome {
  const lines = request.previous
    ? [request.previous.body, 'Versão reescrita (teste SINTÉTICO).']
    : [
        opening(request.agencyName),
        `Mensagem SINTÉTICA de teste (${request.kind}) sobre ${request.offer.name}.`,
        signature(request.agencyName),
      ];
  return ok('relationship-message/fixture', {
    subject: request.channel === 'email' ? `Retomando nossa conversa (teste)` : null,
    body: lines.join('\n\n'),
  });
}

function analyzeReply(request: ReplyAiRequest): AiOutcome {
  const text = request.replyBody.toLowerCase();
  const classification = /proposta|orçamento/.test(text)
    ? 'proposal_request'
    : /reuni|conversar|ligação/.test(text)
      ? 'meeting_request'
      : /não temos interesse|sem interesse/.test(text)
        ? 'refusal'
        : 'interest';
  const closing = classification === 'refusal';
  return ok('relationship-reply/fixture', {
    classification,
    confidence: 'high',
    alternatives: [],
    uncertainty: null,
    summary: 'Resumo SINTÉTICO de teste da resposta do prospect.',
    objections: [],
    mentionedDeadline: null,
    qualifyingQuestions: closing ? [] : ['Qual é o principal objetivo para os próximos meses?'],
    nextStep: closing
      ? 'Agradecer e encerrar a oportunidade (teste).'
      : 'Responder e propor uma data (teste).',
    followUpInDays: closing ? null : 3,
    suggestedReply: {
      subject: null,
      body: `Obrigado pelo retorno! Resposta SINTÉTICA de teste.\n\n${signature(request.agencyName)}`,
    },
    caseIds: [],
  });
}

export const syntheticRelationshipAi: RelationshipAi = {
  approach: async (request) => approach(request),
  message: async (request) => message(request),
  analyzeReply: async (request) => analyzeReply(request),
};
