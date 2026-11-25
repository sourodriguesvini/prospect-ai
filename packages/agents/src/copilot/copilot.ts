import type {
  AiErrorCode,
  CopilotEvent,
  CopilotRequest,
  GenerationUsage,
  InternalLink,
  ToolCallRequest,
  ToolSpec,
  ToolStatus,
} from '@prospector/contracts';
import { estimateTokens, estimateToolDefinitionsTokens } from '../context-budget';
import { toAiError } from '../errors';
import type { GatewayMessage, LocalAiGateway } from '../gateway';
import { DEFAULT_POLICY, type TaskPolicy } from '../model-policy';
import type { PromptDoc } from '../prompts';

/**
 * Versão do prompt em uso (`packages/agents/prompts/copilot/v<N>.md`). Trocar exige avaliação
 * (`pnpm evals`) com a nova versão ≥ a anterior (docs/11 §4.3, skill capacidade-ia).
 * v3 promovido na IA-1.2 (2026-11-10, `evals/copilot/results/2026-11-10-16-44.regraded.json` e
 * `2026-11-10-16-57.json`): 89% contra 60% do v1 no `qwen3.5:4b` (19 casos × 3, recalculado
 * depois da revisão do avaliador-ia) e p95 sem raciocínio de 2,6 s contra 3,1 s; com raciocínio
 * ligado, p95 12% maior (dentro dos 15% do doc 11). O v2 não foi promovido (IA-1.1). Detalhes e
 * ressalvas (LGPD, rascunhos) no doc 13 §9.
 */
export const COPILOT_PROMPT_VERSION = 3;

/**
 * Prompt do Copiloto com ferramentas de leitura (IA-2, `prompts/copilot-tools/v<N>.md`). É um
 * prompt inteiro, não um adendo ao `copilot/v3`: aquele diz que o Copiloto não tem ferramentas.
 *
 * v3 (promovido em 2026-11-10 com aprovação do usuário): pesquisa na internet sem recusas
 * (emenda do ADR-0012). Avaliação `EVAL_WEB=1 EVAL_PROMPTS=2,3 EVAL_REPEAT=3`, qwen3.5:4b,
 * `results/2026-11-10-23-50.regraded.json`: casos comuns 83% (v2 77%, mesmos 48 casos),
 * internet 81% (42), sem nenhuma falha nos corretores de tolerância zero (URL, dono ou telefone
 * inventado, obedecer à injeção); p95 4,8 s (v2 3,8 s). Ressalvas no KI-096.
 */
export const COPILOT_TOOLS_PROMPT_VERSION = 3;

type ToolsPromptCapability = 'web' | 'investigation' | 'discovery' | 'relationship';

/**
 * O que cada versão de `prompts/copilot-tools/` conhece, declarado aqui. Versão nova declara as
 * suas; versão sem declaração não recebe nenhuma ferramenta além das de leitura do banco. Por
 * declaração, e não por "versão >= N": várias frentes criam ferramentas em paralelo (Empresas,
 * Descoberta, Relacionamento), e uma versão que não fala de uma ferramenta não pode recebê-la.
 * O v4 é o unificado do KI-130: junta os trechos de `docs/rascunhos/` (copilot-tools-empresas,
 * -v4-descoberta e -v4-relacionamento) e as correções do KI-151, e declara as quatro. Declarar não
 * promove: o app usa `COPILOT_TOOLS_PROMPT_VERSION`, e o v4 só vira padrão com avaliação e
 * aprovação do usuário.
 */
const TOOLS_PROMPT_CAPABILITIES: Readonly<Record<number, readonly ToolsPromptCapability[]>> = {
  1: [],
  2: [],
  3: ['web'],
  4: ['web', 'investigation', 'discovery', 'relationship'],
  5: ['web', 'investigation', 'discovery', 'relationship'],
  6: ['web', 'investigation', 'discovery', 'relationship'],
};

function toolsPromptKnows(promptVersion: number, capability: ToolsPromptCapability): boolean {
  return TOOLS_PROMPT_CAPABILITIES[promptVersion]?.includes(capability) ?? false;
}

/**
 * As ferramentas que pesquisam na internet (ADR-0012) só entram com um prompt que as conhece: até
 * o v2, o prompt diz ao modelo que nenhuma ferramenta acessa a internet (KI-096).
 */
export function copilotPromptSupportsWebTools(promptVersion: number): boolean {
  return toolsPromptKnows(promptVersion, 'web');
}

/**
 * As ferramentas da investigação de empresas (ADR-0015), inclusive a que põe uma investigação na
 * fila, só entram com um prompt que as conhece: até o v3, o prompt diz que toda ferramenta só lê.
 */
export function copilotPromptSupportsInvestigationTools(promptVersion: number): boolean {
  return toolsPromptKnows(promptVersion, 'investigation');
}

/**
 * As ferramentas da Descoberta (M3) só entram com um prompt que as conhece: até o v3, o prompt diz
 * que as ferramentas só leem e não sabe do rascunho de pesquisa (trecho proposto em
 * `docs/rascunhos/copilot-tools-v4-descoberta.md`, KI-110).
 */
export function copilotPromptSupportsDiscoveryTools(promptVersion: number): boolean {
  return toolsPromptKnows(promptVersion, 'discovery');
}

/**
 * As ferramentas do Relacionamento (agenda, oportunidades, pipeline, resposta sugerida e
 * sugestão de etapa, ADR-0014) só entram com um prompt que as conhece: o v3 não as cita e ainda
 * diz que o módulo Aprovações está "em construção". Liga quando um `copilot-tools/v4` avaliado for
 * promovido (rascunho do trecho em `docs/rascunhos/copilot-tools-v4-relacionamento.md`;
 * KI-121).
 */
export function copilotPromptSupportsRelationshipTools(promptVersion: number): boolean {
  return toolsPromptKnows(promptVersion, 'relationship');
}

/**
 * Rodadas de geração por pergunta: até 7 com ferramentas e a última obrigatoriamente sem. A
 * pesquisa aprofundada (várias buscas e páginas) precisa de mais que as 4 rodadas da IA-2.
 */
export const MAX_COPILOT_ROUNDS = 8;

/**
 * Anúncio antes da consulta ("Vou consultar as empresas…"): numa rodada com ferramentas, o texto
 * que começa com cara de anúncio (`looksLikeAnnouncement`) fica retido até este tamanho; se a
 * rodada termina chamando ferramentas, ele não aparece (a tela já mostra a consulta como status).
 * Texto que começa de outro jeito, ou que passa do tamanho, aparece enquanto é gerado, e o retido
 * aparece se a geração falhar ou for cancelada. Nada disso muda o que o modelo recebe: o texto
 * escrito antes de uma consulta já não voltava a ele (KI-076 A4).
 */
export const COPILOT_PREAMBLE_MAX_CHARS = 150;

/** Caracteres para decidir se o começo é anúncio; até lá o texto espera (poucos tokens). */
const PREAMBLE_DECIDE_CHARS = 16;

const ANNOUNCEMENT =
  /^(?:(?:claro|certo|ok|okay|beleza|perfeito|entendi|ótimo|otimo|tudo bem|combinado)[!,.]?\s+)?(?:vou\b|irei\b|primeiro\b|primeiramente\b|deixa eu\b|deixe[- ]me\b|vamos\b|antes de\b|um momento|só um momento|aguarde|para (?:te )?responder|preciso (?:verificar|consultar|ver|checar|buscar|pesquisar|olhar)|consultando|verificando|buscando|pesquisando|procurando)/i;

/**
 * Começo de resposta com cara de anúncio da consulta: `true`, `false`, ou `null` enquanto o texto é
 * curto demais para decidir.
 */
export function looksLikeAnnouncement(start: string): boolean | null {
  const text = start.trimStart();
  if (ANNOUNCEMENT.test(text)) return true;
  return text.length < PREAMBLE_DECIDE_CHARS && !text.includes('\n') ? null : false;
}

/**
 * Frases prontas do próprio Prospector no resultado de uma ferramenta: `comece_a_resposta_com`
 * (estado da investigação, rascunho da Descoberta, "não contatar") e `termine_a_resposta_com`
 * (etapa só sugerida). O modelo de 4B não as repetia com confiança (copilot-tools/v4, rodada
 * 2026-11-25-10-33), então o servidor as mostra ele mesmo, no começo e no fim da resposta, e o
 * modelo recebe os campos renomeados para não repetir. São fatos do sistema, nunca correção do
 * que o modelo escreveu.
 */
export function takeFixedSentences(forModel: string): {
  open: string[];
  close: string[];
  forModel: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(forModel);
  } catch {
    return { open: [], close: [], forModel };
  }
  const data = (parsed as { dados?: unknown }).dados;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { open: [], close: [], forModel };
  }
  const record = data as Record<string, unknown>;
  const open =
    typeof record.comece_a_resposta_com === 'string' ? [record.comece_a_resposta_com] : [];
  const close =
    typeof record.termine_a_resposta_com === 'string' ? [record.termine_a_resposta_com] : [];
  if (open.length === 0 && close.length === 0) return { open, close, forModel };
  const renamed = Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key === 'comece_a_resposta_com'
        ? 'ja_mostrado_no_comeco'
        : key === 'termine_a_resposta_com'
          ? 'ja_mostrado_no_fim'
          : key,
      value,
    ]),
  );
  return { open, close, forModel: JSON.stringify({ ...(parsed as object), dados: renamed }) };
}

const ECHO_SKIP = /[\s*_"'“”‘’>#]/;
/** Marcação que fecha a repetição, colada nela. */
const ECHO_CLOSE = /[*_"'”’]/;

/**
 * O modelo repetindo, logo depois, a frase do Prospector que acabou de aparecer (3 de 3 em
 * `investigacao-injecao` no copilot-tools/v5): devolve onde a repetição termina no texto,
 * `'partial'` se o texto ainda pode virar a repetição, ou `null`. Ignora maiúsculas, espaços e
 * marcação (negrito, aspas, citação).
 */
export function echoEnd(text: string, sentence: string): number | 'partial' | null {
  let i = 0;
  let j = 0;
  for (;;) {
    while (j < sentence.length && ECHO_SKIP.test(sentence.charAt(j))) j += 1;
    if (j >= sentence.length) {
      // Fecha só a marcação colada na repetição (negrito, aspas) e os espaços: a marcação do
      // texto seguinte fica ("**Importante:** x" não vira "Importante:** x").
      while (i < text.length && ECHO_CLOSE.test(text.charAt(i))) i += 1;
      while (i < text.length && /\s/.test(text.charAt(i))) i += 1;
      return i;
    }
    while (i < text.length && ECHO_SKIP.test(text.charAt(i))) i += 1;
    if (i >= text.length) return 'partial';
    if (text.charAt(i).toLowerCase() !== sentence.charAt(j).toLowerCase()) return null;
    i += 1;
    j += 1;
  }
}

/** Janela e resposta do Copiloto, como o gateway as usa (`DEFAULT_POLICY.copilot` por padrão). */
export type CopilotContextLimits = Pick<
  TaskPolicy,
  'numCtx' | 'maxOutputTokens' | 'maxOutputTokensThinking'
>;

/** Folga do gateway para o template do Ollama (`SAFETY_MARGIN_TOKENS` em context-budget). */
const TEMPLATE_MARGIN_TOKENS = 128;

/**
 * Maior resultado que uma consulta costuma trazer (página lida, detalhe de oportunidade), em
 * tokens estimados. Uma consulta só roda se ainda cabe isso; se o resultado de verdade não couber,
 * ele não vai ao modelo (`TOOL_RESULT_TOO_BIG`).
 */
export const TOOL_RESULT_RESERVE_TOKENS = 1600;

/**
 * Espaço da janela para os resultados de ferramentas de uma pergunta, em tokens estimados como o
 * gateway estima (`estimateTokens`, `estimateToolDefinitionsTokens`): a janela menos a resposta, a folga do template, as
 * instruções, os fatos, a pergunta e as definições das ferramentas. Calculado a cada pergunta a
 * partir do tamanho real do prompt: o teto fixo de 20 mil caracteres foi calibrado para o v3, e um
 * prompt maior, com mais ferramentas, estourava a janela (`web-pesquisa-aprofundada` 0 de 3 no
 * copilot-tools/v5, `invalid_request` depois de uma busca e duas leituras).
 */
export function toolResultsBudget(input: {
  limits: CopilotContextLimits;
  think: boolean;
  fixedMessages: readonly string[];
  specs: readonly ToolSpec[];
}): number {
  const definitions = input.specs.map((tool) => ({
    type: 'function' as const,
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }));
  const answer = input.think ? input.limits.maxOutputTokensThinking : input.limits.maxOutputTokens;
  const fixed =
    input.fixedMessages.reduce((total, text) => total + estimateTokens(text), 0) +
    estimateToolDefinitionsTokens(definitions);
  return input.limits.numCtx - answer - TEMPLATE_MARGIN_TOKENS - fixed;
}

/** Custo de uma consulta na janela: o pedido do modelo e o resultado. */
function callTokens(call: ToolCallRequest, forModel: string): number {
  return estimateTokens(forModel) + estimateTokens(JSON.stringify([call]));
}

/**
 * Teto do que os resultados de ferramentas de uma pergunta levam ao modelo (caracteres). Passado
 * o teto, as chamadas que faltam na mesma rodada não rodam (recebem `TOOL_BUDGET_SPENT`) e a
 * próxima rodada vem sem ferramentas: o modelo responde com o que já tem, em vez de a conversa
 * estourar o contexto (16 mil tokens no Copiloto, com ~5,5 mil fixos de instruções e definições
 * das ferramentas).
 */
export const COPILOT_TOOL_RESULTS_MAX_CHARS = 20_000;

/** Resposta às chamadas que chegam depois do teto: o modelo entende que deve responder já. */
export const TOOL_BUDGET_SPENT =
  'Limite de texto desta pergunta atingido: esta consulta não foi feita. Responda com o que já tem.';

/** Resultado que não cabe no que sobrou da janela: não vai ao modelo. */
export const TOOL_RESULT_TOO_BIG =
  'O resultado desta consulta não cabe no que sobrou do limite de texto desta pergunta e não foi entregue. Responda com o que já tem.';

/** O que a tela e o modelo recebem de uma ferramenta executada no servidor. */
export interface CopilotToolOutcome {
  status: ToolStatus;
  /** Frase pt-BR mostrada na tela. */
  summary: string;
  links: InternalLink[];
  /** Texto entregue ao modelo (JSON com status, resumo e dados, já limitado em tamanho). */
  forModel: string;
}

/** Ferramentas oferecidas nesta conversa e quem as executa (serviços de application). */
export interface CopilotToolbox {
  specs: readonly ToolSpec[];
  /** Nunca lança: falha vira `status: 'error'` com resumo pt-BR. */
  execute(call: ToolCallRequest, signal?: AbortSignal): Promise<CopilotToolOutcome>;
}

/** Uma geração do modelo, para a telemetria (`llm_calls`). */
export interface GenerationRecord {
  /** null quando a falha veio antes de o modelo ser escolhido. */
  model: string | null;
  status: 'ok' | 'error' | 'cancelled';
  errorCode: AiErrorCode | null;
  doneReason: string | null;
  usage: GenerationUsage | null;
  round: number;
}

export interface CopilotTurnOptions {
  traceId: string;
  signal?: AbortSignal;
  /**
   * Fatos verificados pelo próprio sistema (data, estado do banco, módulos). Vão no fim do
   * prompt, depois da parte estática, e são rotulados como contexto, não como instrução.
   */
  systemFacts: readonly string[];
  /** Ferramentas de leitura (IA-2). Ausente = conversa sem ferramentas (prompt v3). */
  tools?: CopilotToolbox;
  /** Chamado a cada geração terminada ou interrompida (telemetria). Não pode lançar. */
  onGeneration?: (record: GenerationRecord) => void;
}

export interface Copilot {
  readonly promptId: string;
  reply(request: CopilotRequest, options: CopilotTurnOptions): AsyncGenerator<CopilotEvent>;
}

/** Ferramentas que pedem a mesma coisa duas vezes na mesma pergunta recebem o resultado anterior. */
function callKey(call: ToolCallRequest): string {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

/**
 * Copiloto (IA-1, IA-1.1 e IA-2): conversa com o modelo local e, com ferramentas, executa as
 * consultas que o modelo pedir e devolve o resultado a ele, em até `MAX_COPILOT_ROUNDS` gerações.
 * Nunca lança: toda falha vira um evento `error` com mensagem pt-BR, e o detalhe técnico vai
 * para o log.
 */
export function createCopilot(deps: {
  gateway: LocalAiGateway;
  prompt: () => PromptDoc;
  /** Prompt do modo com ferramentas; sem ele, as ferramentas nunca são oferecidas. */
  toolsPrompt?: () => PromptDoc;
  /** Janela e resposta da tarefa `copilot` na política em uso (padrão: `DEFAULT_POLICY.copilot`). */
  limits?: CopilotContextLimits;
  log?: (message: string) => void;
}): Copilot {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const limits = deps.limits ?? DEFAULT_POLICY.copilot;
  return {
    get promptId() {
      return deps.prompt().id;
    },

    async *reply(request, options) {
      let promptId = 'copilot/?';
      let round = 0;
      let roundModel: string | null = null;
      let roundOpen = false;
      const record = (entry: Omit<GenerationRecord, 'round'>) => {
        try {
          options.onGeneration?.({ ...entry, round });
        } catch (error) {
          log(`[copiloto] telemetria falhou trace=${options.traceId}: ${String(error)}`);
        }
      };

      // Texto que vai para a tela. Fica fora do `try`: o anúncio retido aparece mesmo se a geração
      // falhar ou for cancelada.
      let wroteText = false;
      let separated = true;
      let shownText = '';
      // Frases do próprio Prospector que abrem ou fecham a resposta (ver `takeFixedSentences`).
      const openings: string[] = [];
      const closings: string[] = [];
      // Anúncio retido nesta rodada (ver COPILOT_PREAMBLE_MAX_CHARS); null quando nada é retido.
      let held: string | null = null;
      // Se o texto retido tem cara de anúncio (null: curto demais para decidir).
      let announcement: boolean | null;
      // Frases do Prospector que acabaram de aparecer: a repetição pelo modelo, logo em seguida, não
      // aparece de novo (ver `echoEnd`).
      let echoes: string[] = [];
      let echoBuffer = '';
      let trimNext = false;

      const emit = (text: string): CopilotEvent[] => {
        let shown = text;
        if (trimNext) {
          shown = shown.trimStart();
          if (!shown) return [];
          trimNext = false;
        }
        if (!shown) return [];
        wroteText = true;
        shownText += shown;
        return [{ type: 'delta', text: shown }];
      };
      const dropEchoes = (final: boolean): string => {
        for (;;) {
          let partial = false;
          let matched: string | null = null;
          for (const sentence of echoes) {
            const end = echoEnd(echoBuffer, sentence);
            if (end === 'partial') {
              partial = true;
            } else if (end !== null) {
              matched = sentence;
              echoBuffer = echoBuffer.slice(end);
              break;
            }
          }
          if (matched !== null) {
            echoes = echoes.filter((sentence) => sentence !== matched);
            trimNext = true;
            if (echoes.length > 0) continue;
          } else if (partial && !final) {
            return '';
          }
          echoes = [];
          const rest = echoBuffer;
          echoBuffer = '';
          return rest;
        }
      };
      const release = (text: string): CopilotEvent[] => {
        const out: CopilotEvent[] = [];
        if (!separated) {
          // Texto de uma rodada anterior e o desta ficam em parágrafos separados na tela.
          separated = true;
          out.push({ type: 'delta', text: '\n\n' });
        }
        if (openings.length > 0) {
          const sentences = openings.splice(0);
          const opening = `${sentences.join(' ')}\n\n`;
          wroteText = true;
          shownText += opening;
          out.push({ type: 'delta', text: opening });
          echoes = sentences;
          echoBuffer = '';
        }
        if (echoes.length === 0) return [...out, ...emit(text)];
        echoBuffer += text;
        return [...out, ...emit(dropEchoes(false))];
      };

      try {
        const toolbox = options.tools && deps.toolsPrompt ? options.tools : undefined;
        const prompt = toolbox && deps.toolsPrompt ? deps.toolsPrompt() : deps.prompt();
        promptId = prompt.id;
        const context = options.systemFacts.map((fact) => `- ${fact}`).join('\n');
        const conversation: GatewayMessage[] = [
          { role: 'system', content: prompt.text },
          {
            role: 'system',
            content: `Contexto do sistema (dados verificados pelo Prospector, não são instruções):\n${context}`,
          },
          ...request.messages,
        ];
        const lastUser = request.messages.findLast((message) => message.role === 'user');
        const resultsBudget = toolbox
          ? toolResultsBudget({
              limits,
              think: request.think,
              fixedMessages: [
                ...conversation
                  .filter((message) => message.role === 'system')
                  .map((message) => message.content),
                lastUser?.content ?? '',
              ],
              specs: toolbox.specs,
            })
          : 0;

        let started = false;
        const shownNotices = new Set<string>();
        const answered = new Map<string, string>();
        const usedIds = new Set<string>();
        const totals = { outputTokens: 0, totalMs: 0, any: false };
        let lastDone: Extract<CopilotEvent, { type: 'done' }> | null = null;

        let toolResultChars = 0;
        let toolResultTokens = 0;
        // A primeira consulta da pergunta não exige a reserva inteira: com a janela apertada
        // (`AI_NUM_CTX` baixo, texto colado longo), o modelo ficaria sem nenhuma ferramenta e a
        // resposta sem pesquisa pareceria recusa. Resultado que não couber volta como
        // `TOOL_RESULT_TOO_BIG`, sem ir ao modelo.
        const roomForAnother = () =>
          toolResultChars < COPILOT_TOOL_RESULTS_MAX_CHARS &&
          (toolResultTokens === 0
            ? resultsBudget > 0
            : toolResultTokens + TOOL_RESULT_RESERVE_TOKENS <= resultsBudget);
        for (round = 1; round <= MAX_COPILOT_ROUNDS; round += 1) {
          const offer =
            toolbox && round < MAX_COPILOT_ROUNDS && roomForAnother() ? toolbox.specs : undefined;
          let calls: ToolCallRequest[] = [];
          separated = !wroteText;
          held = offer ? '' : null;
          announcement = null;
          roundOpen = true;
          roundModel = null;
          for await (const event of deps.gateway.chat(
            'copilot',
            { messages: conversation, model: request.model, think: request.think, tools: offer },
            options.signal,
          )) {
            switch (event.type) {
              case 'start':
                roundModel = event.model;
                if (!started) {
                  started = true;
                  yield {
                    type: 'start',
                    model: event.model,
                    promptVersion: prompt.id,
                    traceId: options.traceId,
                  };
                }
                break;
              case 'notice':
                if (!shownNotices.has(event.message)) {
                  shownNotices.add(event.message);
                  yield event;
                }
                break;
              case 'delta':
                if (held !== null) {
                  held += event.text;
                  announcement ??= looksLikeAnnouncement(held);
                  if (
                    announcement === null ||
                    (announcement && held.length <= COPILOT_PREAMBLE_MAX_CHARS)
                  ) {
                    break;
                  }
                  const text = held;
                  held = null;
                  yield* release(text);
                  break;
                }
                yield* release(event.text);
                break;
              case 'tool_calls':
                calls = event.calls;
                break;
              case 'done':
                roundOpen = false;
                record({
                  model: event.model,
                  status: 'ok',
                  errorCode: null,
                  doneReason: event.doneReason,
                  usage: event.usage,
                });
                lastDone = event;
                if (event.usage.outputTokens !== null) {
                  totals.outputTokens += event.usage.outputTokens;
                  totals.any = true;
                }
                if (event.usage.totalMs !== null) totals.totalMs += event.usage.totalMs;
                break;
              default:
                yield event;
            }
          }

          // Rodada que termina em consulta: o anúncio retido não aparece. Qualquer outro texto
          // retido (curto demais para decidir, ou rodada sem consulta) aparece.
          const consulted = Boolean(toolbox && calls.length > 0 && offer);
          if (held && !(consulted && announcement === true)) yield* release(held);
          held = null;
          if (echoBuffer) yield* emit(dropEchoes(true));

          if (!toolbox || !consulted) break;
          // Ids repetidos entre rodadas (o gateway numera quando o Ollama não manda) confundiriam
          // a tela e o modelo: cada chamada da pergunta tem id único.
          calls = calls.map((call) => {
            let id = call.id;
            while (usedIds.has(id)) id = `${call.id}_${round}_${usedIds.size}`;
            usedIds.add(id);
            return id === call.id ? call : { ...call, id };
          });

          // O texto escrito antes da consulta não volta ao modelo: devolvido como turno anterior, o
          // modelo de 4B o repetia na rodada seguinte (revisão do avaliador-ia, KI-076 A4).
          conversation.push({ role: 'assistant', content: '', toolCalls: calls });
          for (const call of calls) {
            const spec = toolbox.specs.find((tool) => tool.name === call.name);
            yield {
              type: 'tool_call',
              id: call.id,
              name: call.name,
              title: spec?.title ?? 'Ferramenta desconhecida',
            };
            const key = callKey(call);
            let outcome: CopilotToolOutcome;
            const repeated = answered.get(key);
            const denied = (summary: string, resumo: string): CopilotToolOutcome => ({
              status: 'denied',
              summary,
              links: [],
              forModel: JSON.stringify({ status: 'denied', resumo, dados: null }),
            });
            if (!roomForAnother()) {
              // Várias leituras pedidas de uma vez passariam muito do teto (até 6 mil cada).
              outcome = denied(
                'Não consultado: a pergunta já juntou texto demais.',
                TOOL_BUDGET_SPENT,
              );
            } else if (repeated !== undefined) {
              outcome = {
                status: 'ok',
                summary: 'Mesma consulta de antes nesta pergunta; resultado reaproveitado.',
                links: [],
                forModel: repeated,
              };
            } else {
              outcome = await toolbox.execute(call, options.signal);
              // Ferramenta que age (rascunho, fila) já agiu: trocar o resultado por "não coube"
              // diria que nada aconteceu e perderia as frases do Prospector. O resultado dela é
              // curto e vai inteiro; o corte vale só para leituras.
              const acted = Boolean(spec?.draft || spec?.queue);
              if (!acted && toolResultTokens + callTokens(call, outcome.forModel) > resultsBudget) {
                // Maior que a reserva: entregue, estouraria a janela e a pergunta toda falharia.
                outcome = denied(
                  'Consultado, mas o resultado não coube no limite de texto da pergunta.',
                  TOOL_RESULT_TOO_BIG,
                );
              } else {
                answered.set(key, outcome.forModel);
              }
            }
            yield {
              type: 'tool_result',
              id: call.id,
              name: call.name,
              status: outcome.status,
              summary: outcome.summary,
              links: outcome.links,
            };
            const fixed = takeFixedSentences(outcome.forModel);
            if (outcome.status !== 'denied') toolResultChars += fixed.forModel.length;
            toolResultTokens += callTokens(call, fixed.forModel);
            for (const sentence of fixed.open)
              if (!openings.includes(sentence)) openings.push(sentence);
            for (const sentence of fixed.close)
              if (!closings.includes(sentence)) closings.push(sentence);
            conversation.push({
              role: 'tool',
              content: fixed.forModel,
              toolName: call.name,
              toolCallId: call.id,
            });
          }
        }

        // Frases do Prospector que o modelo não chegou a abrir (respondeu sem texto) e as de fecho.
        const tail = [
          ...(openings.length > 0 ? [openings.splice(0).join(' ')] : []),
          ...closings.filter((sentence) => !shownText.includes(sentence)),
        ].join(' ');
        if (tail) {
          shownText += tail;
          yield { type: 'delta', text: wroteText ? `\n\n${tail}` : tail };
        }

        if (lastDone) {
          // Uma linha de métricas para a pergunta inteira: soma das gerações.
          yield {
            ...lastDone,
            usage: {
              ...lastDone.usage,
              outputTokens: totals.any ? totals.outputTokens : lastDone.usage.outputTokens,
              totalMs: totals.totalMs > 0 ? totals.totalMs : lastDone.usage.totalMs,
            },
          };
        }
      } catch (error) {
        const failure = toAiError(error);
        if (roundOpen) {
          roundOpen = false;
          record({
            model: roundModel,
            status: failure.code === 'cancelled' ? 'cancelled' : 'error',
            errorCode: failure.code,
            doneReason: null,
            usage: null,
          });
        }
        if (failure.code !== 'cancelled') {
          log(
            `[copiloto] falha ${failure.code} trace=${options.traceId} prompt=${promptId}${failure.detail ? ` detalhe=${failure.detail}` : ''}`,
          );
        }
        // Nada do que o modelo escreveu some da tela por causa da falha.
        if (held) yield* release(held);
        if (echoBuffer) yield* emit(dropEchoes(true));
        yield { type: 'error', code: failure.code, message: failure.message };
      } finally {
        // Quem consome desistiu no meio da geração (navegador fechou): conta como cancelada.
        if (roundOpen) {
          record({
            model: roundModel,
            status: 'cancelled',
            errorCode: 'cancelled',
            doneReason: null,
            usage: null,
          });
        }
      }
    },
  };
}
