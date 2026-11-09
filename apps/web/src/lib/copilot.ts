import {
  AI_ERROR_MESSAGES,
  COPILOT_HISTORY_LIMIT,
  CopilotEvent,
  type AiErrorCode,
  type ChatMessage,
  type GenerationUsage,
  type LocalModel,
} from '@prospector/contracts';

/** Uma fala da conversa como a tela guarda (só no navegador; nada é salvo). */
export interface Turn {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  model?: string;
  usage?: GenerationUsage;
  doneReason?: string | null;
  notices?: string[];
  error?: { code: AiErrorCode; message: string };
}

/**
 * Orçamento de histórico em caracteres. A política usa 8.192 tokens de contexto; ~16 mil
 * caracteres em português (~4,5 mil tokens) deixam espaço para o prompt do sistema e a resposta.
 */
export const HISTORY_CHAR_BUDGET = 16_000;
const MESSAGE_MAX_CHARS = 8000;

/**
 * Monta o histórico enviado ao servidor: só falas com conteúdo, das mais recentes para trás,
 * até o limite de mensagens e de caracteres. A última fala (do usuário) sempre entra.
 */
export function buildHistory(turns: readonly Turn[]): ChatMessage[] {
  const usable = turns.filter((turn) => turn.content.trim().length > 0);
  const picked: ChatMessage[] = [];
  let used = 0;
  for (let index = usable.length - 1; index >= 0; index -= 1) {
    const turn = usable[index];
    if (!turn) continue;
    let content = turn.content.trim();
    if (content.length > MESSAGE_MAX_CHARS)
      content = `${content.slice(0, MESSAGE_MAX_CHARS - 4)} […]`;
    if (picked.length > 0 && used + content.length > HISTORY_CHAR_BUDGET) break;
    picked.unshift({ role: turn.role, content });
    used += content.length;
    if (picked.length === COPILOT_HISTORY_LIMIT) break;
  }
  return picked;
}

/** A conversa tem falas que já não entram no histórico enviado ao modelo. */
export function historyIsTrimmed(turns: readonly Turn[]): boolean {
  const usable = turns.filter((turn) => turn.content.trim().length > 0).length;
  return usable > 0 && buildHistory(turns).length < usable;
}

/**
 * Lê o fluxo NDJSON da rota `/api/copiloto` pedaço a pedaço. Guarda a linha incompleta até o
 * próximo pedaço; linha que não é um evento válido vira erro visível, nunca é ignorada.
 */
export function createEventDecoder() {
  let buffer = '';
  return {
    push(text: string): CopilotEvent[] {
      buffer += text;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      return lines.flatMap(parseLine);
    },
    flush(): CopilotEvent[] {
      const rest = buffer;
      buffer = '';
      return parseLine(rest);
    },
  };
}

function parseLine(line: string): CopilotEvent[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  try {
    const parsed = CopilotEvent.safeParse(JSON.parse(trimmed));
    if (parsed.success) return [parsed.data];
  } catch {
    // cai no erro abaixo
  }
  return [
    {
      type: 'error',
      code: 'provider_error',
      message: 'O servidor enviou uma resposta inesperada.',
    },
  ];
}

/** Aplica um evento do servidor à fala do Copiloto em andamento. */
export function applyEvent(turn: Turn, event: CopilotEvent): Turn {
  switch (event.type) {
    case 'start':
      return { ...turn, model: event.model };
    case 'queued':
      return turn;
    case 'notice':
      return { ...turn, notices: [...(turn.notices ?? []), event.message] };
    case 'thinking':
      return { ...turn, thinking: (turn.thinking ?? '') + event.text };
    case 'delta':
      return { ...turn, content: turn.content + event.text };
    case 'done':
      return { ...turn, model: event.model, usage: event.usage, doneReason: event.doneReason };
    case 'error':
      return { ...turn, error: { code: event.code, message: event.message } };
  }
}

/** Erro mostrado quando a própria rota recusa o pedido (antes de começar o streaming). */
export function httpFailure(status: number, message: string | undefined): Turn['error'] {
  const code: AiErrorCode = [400, 413, 415].includes(status) ? 'invalid_request' : 'provider_error';
  return { code, message: message ?? `${AI_ERROR_MESSAGES[code]} (HTTP ${status})` };
}

const decimal = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

export function formatGigabytes(bytes: number): string {
  return `${decimal.format(bytes / 1024 ** 3)} GB`;
}

export function formatMebibytesAsGigabytes(mib: number): string {
  return `${decimal.format(mib / 1024)} GB`;
}

function seconds(ms: number): string {
  return `${decimal.format(ms / 1000)} s`;
}

/** Linha de métricas reais da geração: modelo, tokens, velocidade e tempo. */
export function describeUsage(model: string, usage: GenerationUsage): string {
  const parts = [model];
  if (usage.outputTokens !== null) parts.push(`${integer.format(usage.outputTokens)} tokens`);
  if (usage.outputTokensPerSecond !== null) {
    parts.push(`${integer.format(usage.outputTokensPerSecond)} tokens/s`);
  }
  if (usage.totalMs !== null) {
    const load = usage.loadMs !== null && usage.loadMs >= 1000;
    parts.push(
      load
        ? `${seconds(usage.totalMs)} (${seconds(usage.loadMs ?? 0)} carregando o modelo)`
        : seconds(usage.totalMs),
    );
  }
  return parts.join(' · ');
}

/** Quando o Ollama tira o modelo da memória sozinho (`keep_alive`). */
export function describeExpiry(expiresAt: string | null, now: Date): string | null {
  if (!expiresAt) return null;
  const at = new Date(expiresAt).getTime();
  if (Number.isNaN(at)) return null;
  const diff = at - now.getTime();
  if (diff > 24 * 60 * 60 * 1000) return 'Fica na memória até ser descarregado';
  if (diff <= 0) return 'Saindo da memória';
  return `Sai da memória em ${Math.max(1, Math.round(diff / 60_000))} min se ficar ocioso`;
}

/** Modelos de embedding não conversam; ficam fora da escolha do Copiloto. */
const EMBEDDING = /embed|bge|nomic|minilm/i;

export function chatModelOptions(installed: readonly LocalModel[]): string[] {
  return installed
    .map((model) => model.name)
    .filter((name) => !EMBEDDING.test(name))
    .sort((a, b) => a.localeCompare(b));
}
