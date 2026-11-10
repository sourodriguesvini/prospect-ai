import { AiError } from './errors';

/**
 * Orçamento de contexto no servidor (KI-032). O navegador já corta o histórico (24 mensagens,
 * ~16 mil caracteres), mas quem conhece a janela do modelo (`num_ctx`) e o limite da resposta é o
 * gateway. Sem este corte, o Ollama descartaria o começo da conversa sozinho e sem avisar, ou a
 * resposta ficaria sem espaço para ser escrita.
 */

export interface BudgetMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Pedidos de ferramenta feitos pelo assistente nesta mensagem (IA-2). */
  toolCalls?: ReadonlyArray<{ id: string; name: string; arguments: Record<string, unknown> }>;
  /** Mensagem `tool`: qual ferramenta e qual chamada ela responde. */
  toolName?: string;
  toolCallId?: string;
}

/** Custo de uma mensagem: o texto e, se houver, os pedidos de ferramenta em JSON. */
export function estimateMessageTokens(message: BudgetMessage): number {
  const calls = message.toolCalls?.length ? estimateTokens(JSON.stringify(message.toolCalls)) : 0;
  return estimateTokens(message.content) + calls;
}

/**
 * Prosa (letras latinas, com ou sem acento, e espaços): 3 caracteres por token. Em português os
 * tokenizadores do Qwen e do Nemotron ficam perto de 3,5 a 4; errar para cima corta um pouco
 * antes do necessário, nunca depois.
 */
export const CHARS_PER_TOKEN = 3;
/** Marcas de papel e separadores que o modelo acrescenta a cada mensagem. */
const MESSAGE_OVERHEAD_TOKENS = 8;
/** Folga para o modelo de conversa do Ollama (cabeçalhos do template). */
const SAFETY_MARGIN_TOKENS = 128;
/** Abaixo disso a resposta não cabe de jeito útil: melhor pedir um texto menor. */
export const MIN_OUTPUT_TOKENS = 256;

const PROSE = /[\p{Script=Latin}\s]/u;

/**
 * Teto, não média: texto colado pode ser só dígitos ou símbolos, que o tokenizador separa um a
 * um, ou caracteres fora do latim, que viram vários tokens de byte. Se a conta valesse só para
 * prosa, um texto assim passaria de `num_ctx` e o Ollama descartaria o começo do prompt (as
 * instruções), deixando o modelo só com o fim do texto colado.
 */
export function estimateTokens(text: string): number {
  let prose = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (PROSE.test(char)) {
      prose += 1;
    } else if (code < 0x80) {
      other += 1; // dígito, pontuação, símbolo
    } else {
      other += code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; // um token por byte UTF-8
    }
  }
  return Math.ceil(prose / CHARS_PER_TOKEN) + other + MESSAGE_OVERHEAD_TOKENS;
}

export interface ContextPlan<M extends BudgetMessage> {
  messages: M[];
  /** Mensagens da conversa (não de sistema) que ficaram de fora, das mais antigas. */
  dropped: number;
  /** Limite de tokens da resposta (`num_predict`), já descontado o que o pedido ocupa. */
  numPredict: number;
  estimatedPromptTokens: number;
}

/**
 * Mantém as instruções de sistema e o turno atual (a última pergunta do usuário e, com
 * ferramentas, os pedidos e resultados que vieram depois dela), e acrescenta o histórico do mais
 * recente para o mais antigo enquanto couber em `numCtx` menos o espaço da resposta. A conversa
 * enviada sempre começa por uma fala do usuário. Se nem o mínimo couber com o espaço inteiro da
 * resposta, a resposta encolhe até `MIN_OUTPUT_TOKENS`; abaixo disso o pedido é recusado.
 */
export function fitToContext<M extends BudgetMessage>(
  messages: readonly M[],
  limits: { numCtx: number; maxOutputTokens: number },
): ContextPlan<M> {
  const system = messages.filter((message) => message.role === 'system');
  const conversation = messages.filter((message) => message.role !== 'system');
  if (conversation.length === 0) {
    throw new AiError('invalid_request', { detail: 'pedido sem mensagens da conversa' });
  }
  let turnStart = conversation.length - 1;
  while (turnStart > 0 && conversation[turnStart]?.role !== 'user') turnStart -= 1;
  const turn = conversation.slice(turnStart);

  const sum = (list: readonly M[]) =>
    list.reduce((total, message) => total + estimateMessageTokens(message), 0);
  const budget = limits.numCtx - limits.maxOutputTokens - SAFETY_MARGIN_TOKENS;
  let used = sum(system) + sum(turn);
  const kept: M[] = [...turn];
  for (let index = turnStart - 1; index >= 0; index -= 1) {
    const message = conversation[index];
    if (!message) continue;
    const cost = estimateMessageTokens(message);
    if (used + cost > budget) break;
    kept.unshift(message);
    used += cost;
  }
  // Uma resposta antiga do assistente (ou resultado de ferramenta) sem a pergunta que a originou
  // só confunde o modelo.
  while (kept.length > turn.length && kept[0]?.role !== 'user') {
    const removed = kept.shift();
    if (removed) used -= estimateMessageTokens(removed);
  }

  const room = limits.numCtx - used - SAFETY_MARGIN_TOKENS;
  const numPredict = Math.min(limits.maxOutputTokens, room);
  if (numPredict < MIN_OUTPUT_TOKENS) {
    throw new AiError('invalid_request', {
      message:
        'A mensagem passou do limite que o modelo consegue ler de uma vez (código, tabelas e números ocupam mais que texto corrido). Encurte o texto ou divida em partes.',
      detail: `prompt estimado em ${used} tokens para num_ctx ${limits.numCtx}`,
    });
  }
  return {
    messages: [...system, ...kept],
    dropped: conversation.length - kept.length,
    numPredict,
    estimatedPromptTokens: used,
  };
}

export function droppedNotice(dropped: number): string {
  return dropped === 1
    ? 'A conversa passou do limite que o modelo lê de uma vez: a mensagem mais antiga ficou de fora desta resposta.'
    : `A conversa passou do limite que o modelo lê de uma vez: as ${dropped} mensagens mais antigas ficaram de fora desta resposta.`;
}
