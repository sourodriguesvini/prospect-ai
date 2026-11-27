import type {
  CopilotResearch,
  EntityRef,
  ResearchQuery,
  ToolCallRequest,
  ToolStatus,
} from '@prospector/contracts';
import type { RequestContext } from '../context';
import { isAppError } from '../errors';
import type { ResearchService } from './research-service';

/**
 * Turno do Copiloto que opera a pesquisa extensa (diretriz de 2026-11-26, Parte 6.2: o Copiloto
 * age pelos serviços, não só conversa). Decidido por regra, antes do modelo:
 * - pedido de pesquisa ("100 terapeutas ocupacionais no Brasil para apresentar a Blummy") cria;
 * - pedido seguinte na mesma conversa ("agora priorize SP e MG", "mais 50", "pare") muda a
 *   pesquisa mais recente dela (contexto persistente, Parte 6.3).
 * A resposta diz o que foi entendido, as premissas e o plano, e aponta a tela de revisão. Não
 * lista nomes de pessoas no chat (KI-217): os resultados ficam na tela da pesquisa, com a origem.
 */

export const RESEARCH_TOOL_NAME = 'pesquisa_extensa';

export interface ResearchTurn {
  call: ToolCallRequest;
  title: string;
  status: ToolStatus;
  /** Resumo curto (vai para o histórico e para a próxima pergunta ao modelo). */
  summary: string;
  refs: EntityRef[];
  /** Resposta mostrada na conversa. */
  answer: string;
  research: CopilotResearch | null;
}

function place(query: Pick<ResearchQuery, 'city' | 'uf'>): string {
  if (query.city && query.uf) return `${query.city} (${query.uf})`;
  return query.city ?? query.uf ?? 'Brasil';
}

function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items.at(-1)}`;
}

function nextPlaces(research: CopilotResearch, count = 3): string {
  const pending = research.plan.queries.filter((query) => query.status === 'pending');
  const places = [...new Set(pending.map(place))].slice(0, count);
  return places.length > 0 ? listJoin(places) : 'nenhuma busca pendente';
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function researchRef(research: CopilotResearch): EntityRef {
  return { kind: 'research', id: research.id, label: 'Ver a pesquisa' };
}

const HOW_TO_CHANGE =
  'Para mudar no meio, é só pedir aqui: "agora priorize SP e MG", "mais 50", "só no Paraná" ou "pare a pesquisa".';
const NOTHING_SENT = 'Nada é enviado a ninguém: qualquer contato passa pela sua aprovação.';

export function describeResearchStart(
  research: CopilotResearch,
  assumptions: readonly string[],
): string {
  const lines = [
    `Vou pesquisar ${research.requestedCount} ${research.audience} para ${research.profileName}. Objetivo: ${research.objective}.`,
  ];
  if (assumptions.length > 0) {
    lines.push(
      '',
      'Premissas que adotei sem perguntar:',
      ...assumptions.map((item) => `- ${item}`),
    );
  }
  lines.push(
    '',
    `Como vou buscar: até ${research.creditCap} buscas na internet, por profissão e região (nunca pelo nome de alguém), começando por ${nextPlaces(research)}. Cada resultado entra com a fonte, o trecho em que aparece e o papel para ${research.profileName} (usuário, comprador ou influenciador).`,
    'Profissionais só ficam abordáveis se a LIA aprovada cobrir a fonte e os dados; os demais ficam guardados por até 90 dias, só para revisão.',
    '',
    `A pesquisa roda em segundo plano, em lotes. Se o app fechar, ela continua de onde parou quando você abrir o Prospector de novo. Acompanhe e revise os resultados em "Ver a pesquisa". ${HOW_TO_CHANGE}`,
    '',
    NOTHING_SENT,
  );
  return lines.join('\n');
}

export function describeResearchRevision(
  research: CopilotResearch,
  change: string,
  reopened: boolean,
): string {
  const done = research.progress.queriesDone;
  const open = research.status === 'queued' || research.status === 'running';
  const lines = [
    `Pesquisa atualizada: ${change}`,
    '',
    `Até agora: ${research.foundCount} de ${research.requestedCount} achados, ${plural(done, 'busca feita', 'buscas feitas')}; ${research.progress.creditsUsed} de até ${plural(research.creditCap, 'crédito', 'créditos')} de busca usados.${open ? ` Próximas buscas: ${nextPlaces(research)}.` : ''}`,
  ];
  if (reopened) lines.push('A pesquisa tinha terminado e foi retomada de onde parou.');
  lines.push('', HOW_TO_CHANGE);
  return lines.join('\n');
}

export function describeResearchCancel(research: CopilotResearch): string {
  const kept =
    research.foundCount === 0
      ? 'Nenhum resultado tinha sido achado até aqui'
      : research.foundCount === 1
        ? 'O resultado achado até aqui continua guardado para revisão em "Ver a pesquisa"'
        : `Os ${research.foundCount} resultados achados até aqui continuam guardados para revisão em "Ver a pesquisa"`;
  return `Pesquisa cancelada. ${kept}; nenhuma busca nova será feita.`;
}

/**
 * O texto opera uma pesquisa? null = não (a pergunta segue para o modelo). Erros de regra
 * (busca desligada, orçamento, fila cheia, mudança não entendida) voltam como turno com status
 * `error` e a mensagem em pt-BR; erro inesperado é lançado.
 */
export async function runResearchTurn(
  ctx: RequestContext,
  service: ResearchService,
  input: { threadId: string; message: string; callId?: string },
): Promise<ResearchTurn | null> {
  const message = input.message.trim();
  const interpretation = service.interpret(message);
  let latest: CopilotResearch | null = null;
  if (!interpretation) {
    // Sem as tabelas da pesquisa (migração pendente) ou banco fora do ar: a conversa segue com o
    // modelo em vez de falhar.
    try {
      latest = await service.latestForThread(ctx, input.threadId);
    } catch (error) {
      console.warn('[pesquisa] não deu para ler a pesquisa da conversa', error);
      latest = null;
    }
  }
  const revising = latest !== null && service.isRevision(message, latest);
  if (!interpretation && !revising) return null;

  const call: ToolCallRequest = {
    id: input.callId ?? `pesquisa-${ctx.traceId.slice(0, 8)}`,
    name: RESEARCH_TOOL_NAME,
    arguments: { acao: interpretation ? 'iniciar' : 'mudar' },
  };
  const title = interpretation ? 'Criando a pesquisa' : 'Mudando a pesquisa';
  try {
    if (interpretation) {
      const { research, assumptions } = await service.start(ctx, {
        threadId: input.threadId,
        request: message,
      });
      return {
        call,
        title,
        status: 'ok',
        summary:
          `Pesquisa criada: ${research.requestedCount} ${research.audience} para ${research.profileName}; até ${research.creditCap} buscas; na fila.`.slice(
            0,
            500,
          ),
        refs: [researchRef(research)],
        answer: describeResearchStart(research, assumptions),
        research,
      };
    }
    const before = latest!;
    const { research, change, cancelled } = await service.revise(ctx, {
      researchId: before.id,
      request: message,
    });
    const reopened = ['done', 'failed'].includes(before.status) && research.status === 'queued';
    if (!cancelled && research.version === before.version) {
      // Nada mudou ("continue" com a pesquisa rodando, "pare" com ela já encerrada).
      return {
        call,
        title,
        status: 'ok',
        summary: `${change} ${research.foundCount} de ${research.requestedCount} achados.`.slice(
          0,
          500,
        ),
        refs: [researchRef(research)],
        answer: `${change} Até agora: ${research.foundCount} de ${research.requestedCount} achados. Os resultados estão em "Ver a pesquisa".`,
        research,
      };
    }
    return {
      call,
      title,
      status: 'ok',
      summary: (cancelled
        ? `Pesquisa cancelada com ${research.foundCount} achados.`
        : `Pesquisa atualizada: ${change} ${research.foundCount} de ${research.requestedCount} achados.`
      ).slice(0, 500),
      refs: [researchRef(research)],
      answer: cancelled
        ? describeResearchCancel(research)
        : describeResearchRevision(research, change, reopened),
      research,
    };
  } catch (error) {
    if (!isAppError(error) || error.code === 'unexpected') throw error;
    return {
      call,
      title,
      status: 'error',
      summary: error.message.slice(0, 500),
      refs: latest ? [researchRef(latest)] : [],
      answer: error.message,
      research: latest,
    };
  }
}
