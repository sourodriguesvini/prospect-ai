import type { ExtractInput, InterpretInput } from '@prospector/application';
import {
  ExtractorOutput,
  InterpreterOutput,
  RegionScope,
  ResultKind,
  ServiceHint,
  SIGNAL_TYPE_HINTS,
  SignalRelevance,
  SignalType,
} from '@prospector/contracts';
import { AiError } from '../errors';
import type { LocalAiGateway } from '../gateway';
import { loadPrompt, type PromptDoc } from '../prompts';

/**
 * IA local da Descoberta (ADR-0013): o intérprete transforma o pedido em intenção e plano de
 * buscas; o extrator lê lotes de resultados e aponta empresas e sinais com o trecho que os
 * sustenta. Os dois devolvem JSON restrito por esquema (`format` do Ollama) e o servidor confere
 * tudo de novo (contrato tolerante + conferência do trecho e do nome na fonte, no motor).
 *
 * Versões em uso. Trocar exige `pnpm evals` (evals/discovery) e aprovação (skill capacidade-ia).
 */
export const DISCOVERY_INTERPRETER_PROMPT_VERSION = 1;
/**
 * Extrator v2 (2026-11-11): título e trecho em linhas separadas e citação de um campo só (o v1
 * colava os dois na citação, que o servidor recusava) e resultado com ordens ao modelo não é
 * fonte (o v1 listou a empresa citada pela injeção em 2 de 3 rodadas). Avaliação em
 * `evals/discovery/results/`.
 */
export const DISCOVERY_EXTRACTOR_PROMPT_VERSION = 2;

/** Tarefa do gateway: modelo de raciocínio, mas sem pensar (resposta curta e estruturada). */
const TASK = 'reasoning' as const;

/** Tokens da resposta: plano de buscas é curto; o lote do extrator pode listar muitas empresas. */
const INTERPRETER_MAX_TOKENS = 1024;
const EXTRACTOR_MAX_TOKENS = 2048;

const nullable = (schema: Record<string, unknown>) => ({ anyOf: [schema, { type: 'null' }] });
const text = (maxLength: number) => ({ type: 'string', maxLength });
const list = (items: Record<string, unknown>, maxItems: number) => ({
  type: 'array',
  items,
  maxItems,
});
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});

/** Esquema do intérprete (espelha `InterpreterOutput`, que é a validação de verdade). */
export const INTERPRETER_SCHEMA = object({
  summary: nullable(text(300)),
  segment: nullable(text(120)),
  segmentTerms: list(text(60), 8),
  cities: list(text(80), 10),
  ufs: list({ type: 'string', pattern: '^[A-Z]{2}$' }, 5),
  regionScope: { enum: RegionScope.options },
  sizeHint: nullable(text(80)),
  services: list({ enum: ServiceHint.options }, 3),
  signals: list({ enum: SignalType.options }, 6),
  quantity: nullable({ type: 'integer', minimum: 1, maximum: 50 }),
  constraints: list(text(160), 6),
  queries: list(
    object({
      text: text(300),
      purpose: { enum: ['companies', 'signals'] },
      signal: nullable({ enum: SignalType.options }),
      recent: { type: 'boolean' },
    }),
    6,
  ),
});

/** Esquema do extrator (espelha `ExtractorOutput`). */
export const EXTRACTOR_SCHEMA = object({
  results: list(
    object({ result: { type: 'integer', minimum: 1 }, kind: { enum: ResultKind.options } }),
    50,
  ),
  companies: list(
    object({
      result: { type: 'integer', minimum: 1 },
      name: text(160),
      officialSite: { type: 'boolean' },
      city: nullable(text(80)),
      uf: nullable({ type: 'string', pattern: '^[A-Z]{2}$' }),
      segment: nullable(text(120)),
      description: nullable(text(400)),
    }),
    40,
  ),
  signals: list(
    object({
      result: { type: 'integer', minimum: 1 },
      company: text(160),
      type: { enum: SignalType.options },
      summary: text(300),
      quote: text(300),
      eventDate: nullable({ type: 'string', pattern: '^\\d{4}(-\\d{2}(-\\d{2})?)?$' }),
      explicit: { type: 'boolean' },
      relevance: { enum: SignalRelevance.options },
      service: nullable({ enum: ServiceHint.options }),
      rationale: text(400),
    }),
    40,
  ),
});

const HOST_KIND_LABELS: Record<string, string> = {
  social: 'rede social',
  directory: 'guia ou diretório',
  news: 'site de notícias',
  job_board: 'site de vagas',
  government: 'órgão público',
  marketplace: 'marketplace',
  reference: 'enciclopédia ou referência',
};

/** Dado de terceiros não abre nem fecha as marcas do pedido (`<resultados>` etc.). */
function data(value: string): string {
  return value.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

export function interpreterMessage(input: InterpretInput): string {
  const options = input.options;
  const filters = [
    options.city ? `Cidade: ${data(options.city)}` : null,
    options.uf ? `Estado: ${options.uf}` : null,
    options.signals?.length ? `Sinais: ${options.signals.join(', ')}` : null,
    options.quantity ? `Quantidade: ${options.quantity}` : null,
  ].filter((line): line is string => line !== null);
  const context = [
    input.context.offer ? `Oferta ativa da agência: ${data(input.context.offer)}` : null,
    input.context.services.length
      ? `Serviços da agência: ${input.context.services.map(data).join(', ')}`
      : null,
    input.context.icpRegions.length
      ? `Regiões do perfil de cliente (ICP): ${input.context.icpRegions.map(data).join(', ')}`
      : null,
  ].filter((line): line is string => line !== null);
  return [
    `<hoje>${input.today}</hoje>`,
    `<contexto>\n${context.length ? context.join('\n') : 'Sem contexto cadastrado.'}\n</contexto>`,
    filters.length ? `<filtros>\n${filters.join('\n')}\n</filtros>` : null,
    `<pedido>${data(input.request)}</pedido>`,
  ]
    .filter((part): part is string => part !== null)
    .join('\n');
}

export function extractorMessage(input: ExtractInput): string {
  const intent = input.intent;
  const wanted = intent.signals.length
    ? intent.signals.map((type) => `${type} (${SIGNAL_TYPE_HINTS[type]})`).join('; ')
    : 'qualquer sinal comercial';
  // Um campo por linha: a citação do sinal sai de um campo só (o servidor confere no texto).
  const lines = input.results.map((result) => {
    const kind = result.hostKind
      ? ` [${HOST_KIND_LABELS[result.hostKind] ?? result.hostKind}]`
      : '';
    return [
      `[${result.n}] ${data(result.url)}${kind}`,
      `Título: ${data(result.title)}`,
      result.publishedAt ? `Publicado em: ${result.publishedAt}` : null,
      `Trecho: ${data(result.snippet)}`,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  });
  return [
    `<hoje>${input.today}</hoje>`,
    `<pesquisa>\nSetor: ${intent.segment ? data(intent.segment) : 'não informado'}\nRegião: ${data(intent.region.label ?? 'Brasil')}\nSinais procurados: ${wanted}\n</pesquisa>`,
    `<resultados>\n${lines.join('\n\n')}\n</resultados>`,
  ].join('\n');
}

/** JSON da resposta; tolera cerca de código e texto em volta. null = não é um objeto JSON. */
export function parseDiscoveryModelJson(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(raw.slice(start, end + 1));
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export interface LocalDiscoveryAi {
  readonly promptIds: { interpreter: string; extractor: string };
  /** Lança AiError (código do gateway). */
  interpret(input: InterpretInput, signal?: AbortSignal): Promise<InterpreterOutput>;
  extract(input: ExtractInput, signal?: AbortSignal): Promise<ExtractorOutput>;
}

export function createLocalDiscoveryAi(deps: {
  gateway: Pick<LocalAiGateway, 'chat'>;
  prompts?: { interpreter: PromptDoc; extractor: PromptDoc };
}): LocalDiscoveryAi {
  const interpreter =
    deps.prompts?.interpreter ??
    loadPrompt('discovery-interpreter', DISCOVERY_INTERPRETER_PROMPT_VERSION);
  const extractor =
    deps.prompts?.extractor ??
    loadPrompt('discovery-extractor', DISCOVERY_EXTRACTOR_PROMPT_VERSION);

  async function generate(
    system: string,
    user: string,
    schema: Record<string, unknown>,
    maxOutputTokens: number,
    signal: AbortSignal | undefined,
  ): Promise<{ json: Record<string, unknown> | null; truncated: boolean }> {
    let answer = '';
    let truncated = false;
    for await (const event of deps.gateway.chat(
      TASK,
      {
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        think: false,
        format: schema,
        maxOutputTokens,
      },
      signal,
    )) {
      if (event.type === 'delta') answer += event.text;
      else if (event.type === 'done') truncated = event.doneReason === 'length';
    }
    return { json: truncated ? null : parseDiscoveryModelJson(answer), truncated };
  }

  /**
   * Lote que não coube na resposta (ou voltou fora do formato) é dividido ao meio. Um resultado
   * sozinho que falha duas vezes é deixado de lado (`skipped`), sem derrubar o lote inteiro.
   */
  async function extractBatch(
    input: ExtractInput,
    signal: AbortSignal | undefined,
    retried: boolean,
    skipped: { count: number; truncated: boolean },
  ): Promise<ExtractorOutput> {
    const out = await generate(
      extractor.text,
      extractorMessage(input),
      EXTRACTOR_SCHEMA,
      EXTRACTOR_MAX_TOKENS,
      signal,
    );
    if (out.json) return ExtractorOutput.parse(out.json);
    if (input.results.length > 1) {
      const middle = Math.ceil(input.results.length / 2);
      const halves = [input.results.slice(0, middle), input.results.slice(middle)];
      const parts: ExtractorOutput[] = [];
      for (const results of halves) {
        // Os números (`n`) continuam os do lote inteiro: o motor casa pela posição original.
        parts.push(await extractBatch({ ...input, results }, signal, false, skipped));
      }
      return {
        results: parts.flatMap((part) => part.results),
        companies: parts.flatMap((part) => part.companies),
        signals: parts.flatMap((part) => part.signals),
      };
    }
    if (!retried) return extractBatch(input, signal, true, skipped);
    skipped.count += 1;
    skipped.truncated ||= out.truncated;
    return { results: [], companies: [], signals: [] };
  }

  return {
    promptIds: { interpreter: interpreter.id, extractor: extractor.id },

    async interpret(input, signal) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const out = await generate(
          interpreter.text,
          interpreterMessage(input),
          INTERPRETER_SCHEMA,
          INTERPRETER_MAX_TOKENS,
          signal,
        );
        if (out.json) return InterpreterOutput.parse(out.json);
      }
      throw new AiError('provider_error', { detail: 'intérprete: resposta fora do formato' });
    },

    async extract(input, signal) {
      if (input.results.length === 0) return { results: [], companies: [], signals: [] };
      const skipped = { count: 0, truncated: false };
      const output = await extractBatch(input, signal, false, skipped);
      // Nenhum resultado aproveitado: é falha da IA, não "nada encontrado".
      if (skipped.count === input.results.length) {
        throw new AiError('provider_error', {
          detail: skipped.truncated
            ? 'extrator: resposta cortada'
            : 'extrator: resposta fora do formato',
        });
      }
      return output;
    },
  };
}
