import type {
  AnalysisInputs,
  AnalysisResult,
  AnalysisUsage,
  BrandAnalysisAi,
  RefText,
} from '@prospector/application';
import {
  ANALYSIS_OUTPUT_SCHEMAS,
  AnalysisAgent,
  CAPTURE_MAX_HEIGHT,
  CAPTURE_VIEWPORTS,
  CAPTURE_VIEWPORT_LABELS,
  COMPETITIVE_FINDING_LABELS,
  COMPETITOR_KIND_LABELS,
  CompetitiveFindingKind,
  CompetitorKind,
  FindingNature,
  OfferRelevance,
  type AiTask,
  type CaptureViewport,
} from '@prospector/contracts';
import type { GatewayImage } from '../context-budget';
import { isAiError, toAiError } from '../errors';
import type { GatewayEvent, LocalAiGateway } from '../gateway';

type GatewayDoneUsage = NonNullable<Extract<GatewayEvent, { type: 'done' }>['usage']>;
import { loadPrompt, type PromptDoc } from '../prompts';

/**
 * IA local das análises da investigação (ADR-0015, porta `BrandAnalysisAi`). Cada agente tem um
 * prompt versionado e responde JSON restrito por esquema (`format` do Ollama); o servidor valida
 * de novo pelo contrato (`ANALYSIS_OUTPUT_SCHEMAS`) e depois pelas regras do ledger (trechos
 * conferidos, referências existentes, afirmações proibidas). Conteúdo de sites e resultados de
 * busca entra marcado como dado, nunca como instrução. Uma chamada por vez (o gateway enfileira).
 *
 * Versões em uso (v1, sem conjunto de avaliação ainda: KI-131). Trocar exige avaliação e
 * aprovação (skill capacidade-ia).
 */
export const ANALYSIS_PROMPT_VERSIONS: Record<AnalysisAgent, number> = {
  'company-business': 1,
  'brand-visual': 1,
  'competitor-triage': 1,
  competitive: 1,
  diagnosis: 1,
};

/** Texto e estrutura: modelo de raciocínio sem pensar; capturas: modelo com visão. */
const TASKS: Record<AnalysisAgent, AiTask> = {
  'company-business': 'reasoning',
  'brand-visual': 'vision',
  'competitor-triage': 'reasoning',
  competitive: 'reasoning',
  diagnosis: 'reasoning',
};

/** Tokens da resposta (o gateway limita ao dobro do teto da tarefa). */
const MAX_TOKENS: Record<AnalysisAgent, number> = {
  'company-business': 2048,
  'brand-visual': 2048,
  'competitor-triage': 768,
  competitive: 1536,
  diagnosis: 2048,
};

// -----------------------------------------------------------------------------
// Esquemas JSON (espelham os contratos Zod, que são a validação de verdade)
// -----------------------------------------------------------------------------

type Schema = Record<string, unknown>;
const nullable = (schema: Schema): Schema => ({ anyOf: [schema, { type: 'null' }] });
const text = (maxLength: number): Schema => ({ type: 'string', maxLength });
const list = (items: Schema, maxItems: number): Schema => ({ type: 'array', items, maxItems });
const object = (properties: Record<string, Schema>): Schema => ({
  type: 'object',
  properties,
  required: Object.keys(properties),
  additionalProperties: false,
});
const ref = text(12);
const factor: Schema = { type: 'number', minimum: 0, maximum: 1 };
const position: Schema = { type: 'integer', minimum: 1, maximum: 20 };

const ITEM = object({ label: text(80), page: ref, quote: text(300) });
const INFERENCE = object({
  statement: text(300),
  reasoning: text(600),
  factor,
  basedOn: list(ref, 8),
});

export const ANALYSIS_JSON_SCHEMAS: Record<AnalysisAgent, Schema> = {
  'company-business': object({
    offerings: list(ITEM, 8),
    audiences: list(ITEM, 3),
    differentiators: list(ITEM, 4),
    regions: list(ITEM, 3),
    signals: list(ITEM, 3),
    valueProposition: nullable(INFERENCE),
    toneOfVoice: nullable(INFERENCE),
    businessModel: nullable(INFERENCE),
  }),
  'brand-visual': object({
    criteria: list(
      object({
        criterion: text(40),
        score: { type: 'integer', minimum: 1, maximum: 5 },
        observation: text(300),
        nature: { enum: FindingNature.options },
        images: list({ enum: ['desktop', 'mobile'] }, 2),
        metrics: list(ref, 6),
        factor,
      }),
      12,
    ),
    positioning: nullable(INFERENCE),
  }),
  'competitor-triage': object({
    candidates: list(
      object({ ref, kind: { enum: CompetitorKind.options }, reason: text(200) }),
      10,
    ),
  }),
  competitive: object({
    findings: list(
      object({
        kind: { enum: CompetitiveFindingKind.options },
        statement: text(300),
        reasoning: text(600),
        factor,
        basedOn: list(ref, 8),
      }),
      5,
    ),
  }),
  diagnosis: object({
    summary: nullable(INFERENCE),
    hypotheses: list(
      object({ statement: text(300), reasoning: text(600), basedOn: list(ref, 6) }),
      4,
    ),
    offers: list(
      object({
        offer: ref,
        relevance: { enum: OfferRelevance.options },
        statement: text(300),
        reasoning: text(600),
        factor,
        basedOn: list(ref, 8),
        openingAngle: nullable(text(300)),
        objections: list(text(200), 3),
        toVerify: list(text(200), 3),
        problemsMatched: list(position, 20),
        signalsMatched: list(position, 20),
        disqualifiersHit: list(position, 20),
      }),
      6,
    ),
  }),
};

// -----------------------------------------------------------------------------
// Mensagens (dado de terceiros entre marcas; nunca abre nem fecha as marcas)
// -----------------------------------------------------------------------------

/** Uma linha: sem `<`/`>` e sem quebras. */
function line(value: string): string {
  return value.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Bloco de texto de página: sem `<`/`>`, quebras de linha mantidas, linhas vazias juntas. */
function block(value: string): string {
  return value
    .replace(/[<>]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function companyBlock(company: AnalysisInputs['diagnosis']['company']): string {
  const place = [company.city, company.uf]
    .filter(Boolean)
    .map((part) => line(part ?? ''))
    .join('/');
  return [
    '<empresa>',
    `Nome: ${line(company.name)}`,
    `Cidade: ${place || 'não informada'}`,
    `Atividade principal (CNAE): ${company.activity ? line(company.activity) : 'não informada'}`,
    '</empresa>',
  ].join('\n');
}

function refs(items: readonly RefText[], empty: string): string {
  return items.length
    ? items.map((item) => `[${line(item.ref)}] ${line(item.text)}`).join('\n')
    : empty;
}

const numbered = (items: readonly string[]) =>
  items.length ? items.map((item, index) => `${index + 1}. ${line(item)}`).join('\n') : '(nenhum)';

export const analysisMessages = {
  'company-business'(input: AnalysisInputs['company-business']): string {
    const pages = input.pages.map((page) =>
      [
        `[${line(page.ref)}] ${line(page.url)} (página: ${line(page.category)})`,
        `Título: ${page.title ? line(page.title) : 'sem título'}`,
        'Texto:',
        block(page.text),
      ].join('\n'),
    );
    return [companyBlock(input.company), `<paginas>\n${pages.join('\n\n')}\n</paginas>`].join('\n');
  },

  'brand-visual'(input: AnalysisInputs['brand-visual']): string {
    const shown = imageOrder(input.images);
    const images = shown.map(
      (viewport, index) =>
        `Imagem ${index + 1} = ${viewport}: captura no ${CAPTURE_VIEWPORT_LABELS[viewport]} (${CAPTURE_VIEWPORTS[viewport].width} px de largura, primeiras telas da página inicial).`,
    );
    const rubric = input.rubric.map(
      (criterion) =>
        `- ${line(criterion.key)} (${line(criterion.label)}): ${line(criterion.description)}`,
    );
    return [
      companyBlock(input.company),
      `<imagens>\n${images.length ? images.join('\n') : 'Nenhuma imagem disponível.'}\n</imagens>`,
      `<rubrica>\n${rubric.join('\n')}\n</rubrica>`,
      `<medicoes>\n${refs(input.metrics, '(nenhuma)')}\n</medicoes>`,
      `<o_que_o_site_diz>\n${refs(input.context, '(nada extraído do texto do site)')}\n</o_que_o_site_diz>`,
    ].join('\n');
  },

  'competitor-triage'(input: AnalysisInputs['competitor-triage']): string {
    const candidates = input.candidates.map((candidate) =>
      [
        `[${line(candidate.ref)}] ${line(candidate.domain)}`,
        `Título: ${line(candidate.title)}`,
        `Trecho: ${line(candidate.snippet)}`,
      ].join('\n'),
    );
    return [
      companyBlock(input.company),
      `<o_que_a_empresa_oferece>\n${input.offerings.length ? input.offerings.map((item) => `- ${line(item)}`).join('\n') : '(não extraído)'}\n</o_que_a_empresa_oferece>`,
      `<candidatos>\n${candidates.join('\n\n')}\n</candidatos>`,
    ].join('\n');
  },

  competitive(input: AnalysisInputs['competitive']): string {
    const competitors = input.competitors.map((competitor) =>
      [
        `[${line(competitor.ref)}] ${line(competitor.domain)} (${COMPETITOR_KIND_LABELS[competitor.kind]})`,
        block(competitor.text),
      ].join('\n'),
    );
    const kinds = CompetitiveFindingKind.options
      .map((kind) => `- ${kind}: ${COMPETITIVE_FINDING_LABELS[kind]}`)
      .join('\n');
    return [
      companyBlock(input.company),
      `<dossie>\n${refs(input.facts, '(vazio)')}\n</dossie>`,
      `<concorrentes>\n${competitors.join('\n\n')}\n</concorrentes>`,
      `<tipos_de_achado>\n${kinds}\n</tipos_de_achado>`,
    ].join('\n');
  },

  diagnosis(input: AnalysisInputs['diagnosis']): string {
    const facts = input.facts.map((fact) => {
      const kind =
        fact.type === 'fact' ? 'fato' : fact.type === 'inference' ? 'inferência' : 'hipótese';
      const confidence =
        fact.confidence === null ? '' : `, confiança ${Math.round(fact.confidence)}%`;
      return `[${line(fact.ref)}] (${kind}${confidence}) ${line(fact.text)}`;
    });
    const offers = input.offers.map((offer) =>
      [
        `[${line(offer.ref)}] ${line(offer.name)}`,
        `Problemas que a oferta resolve:\n${numbered(offer.problems)}`,
        `Sinais de necessidade:\n${numbered(offer.needSignals)}`,
        `Desqualificadores:\n${numbered(offer.disqualifiers)}`,
      ].join('\n'),
    );
    return [
      companyBlock(input.company),
      `<dossie>\n${facts.length ? facts.join('\n') : '(vazio)'}\n</dossie>`,
      `<ofertas>\n${offers.length ? offers.join('\n\n') : '(nenhuma oferta ativa)'}\n</ofertas>`,
      `<lacunas>\n${input.gaps.length ? input.gaps.map((gap) => `- ${line(gap)}`).join('\n') : '(nenhuma)'}\n</lacunas>`,
    ].join('\n');
  },
} satisfies { [A in AnalysisAgent]: (input: AnalysisInputs[A]) => string };

/** Ordem fixa das imagens (computador, celular), só as presentes. */
function imageOrder(images: AnalysisInputs['brand-visual']['images']): CaptureViewport[] {
  return (['desktop', 'mobile'] as const).filter((viewport) => (images[viewport]?.length ?? 0) > 0);
}

function gatewayImages(images: AnalysisInputs['brand-visual']['images']): GatewayImage[] {
  return imageOrder(images).map((viewport) => ({
    base64: Buffer.from(images[viewport] ?? new Uint8Array()).toString('base64'),
    // Teto do tamanho (a captura nunca passa disso): a conta do contexto erra para cima.
    width: CAPTURE_VIEWPORTS[viewport].width,
    height: CAPTURE_MAX_HEIGHT[viewport],
  }));
}

/** JSON da resposta; tolera cerca de código e texto em volta. null = não é um objeto JSON. */
export function parseAnalysisJson(raw: string): Record<string, unknown> | null {
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

export function createLocalBrandAnalysisAi(deps: {
  gateway: Pick<LocalAiGateway, 'chat'>;
  prompts?: Partial<Record<AnalysisAgent, PromptDoc>>;
  log?: (message: string) => void;
}): BrandAnalysisAi & { readonly promptIds: Record<AnalysisAgent, string> } {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const prompts = Object.fromEntries(
    AnalysisAgent.options.map((agent) => [
      agent,
      deps.prompts?.[agent] ?? loadPrompt(agent, ANALYSIS_PROMPT_VERSIONS[agent]),
    ]),
  ) as Record<AnalysisAgent, PromptDoc>;

  async function generate(
    agent: AnalysisAgent,
    user: string,
    images: GatewayImage[],
    signal: AbortSignal | undefined,
  ): Promise<{
    json: Record<string, unknown> | null;
    model: string | null;
    usage: GatewayDoneUsage | null;
    doneReason: string | null;
  }> {
    let answer = '';
    let truncated = false;
    let model: string | null = null;
    let usage: GatewayDoneUsage | null = null;
    let doneReason: string | null = null;
    for await (const event of deps.gateway.chat(
      TASKS[agent],
      {
        messages: [
          { role: 'system', content: prompts[agent].text },
          { role: 'user', content: user, ...(images.length ? { images } : {}) },
        ],
        think: false,
        format: ANALYSIS_JSON_SCHEMAS[agent],
        maxOutputTokens: MAX_TOKENS[agent],
      },
      signal,
    )) {
      if (event.type === 'start') model = event.model;
      else if (event.type === 'delta') answer += event.text;
      else if (event.type === 'done') {
        truncated = event.doneReason === 'length';
        doneReason = event.doneReason ?? null;
        usage = event.usage ?? null;
      }
    }
    return { json: truncated ? null : parseAnalysisJson(answer), model, usage, doneReason };
  }

  return {
    promptIds: Object.fromEntries(
      AnalysisAgent.options.map((agent) => [agent, prompts[agent].id]),
    ) as Record<AnalysisAgent, string>,

    async analyze(agent, input, options) {
      const started = performance.now();
      const promptVersion = prompts[agent].id;
      const elapsed = () => Math.round(performance.now() - started);
      const user = (analysisMessages[agent] as (value: typeof input) => string)(input);
      const images =
        agent === 'brand-visual'
          ? gatewayImages((input as AnalysisInputs['brand-visual']).images)
          : [];
      let model: string | null = null;
      const task = TASKS[agent];
      const total: AnalysisUsage = {
        inputTokens: null,
        outputTokens: null,
        totalMs: null,
        loadMs: null,
      };
      let doneReason: string | null = null;
      const add = (a: number | null, b: number | null | undefined) =>
        b === null || b === undefined ? a : (a ?? 0) + b;
      const telemetry = () => ({ task, usage: { ...total }, doneReason });
      try {
        // Uma segunda tentativa quando a resposta vem cortada ou fora do formato.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const out = await generate(agent, user, images, options?.signal);
          model = out.model ?? model;
          doneReason = out.doneReason ?? doneReason;
          if (out.usage) {
            total.inputTokens = add(total.inputTokens, out.usage.inputTokens);
            total.outputTokens = add(total.outputTokens, out.usage.outputTokens);
            total.totalMs = add(total.totalMs, out.usage.totalMs);
            total.loadMs = add(total.loadMs, out.usage.loadMs);
          }
          if (!out.json) continue;
          const parsed = ANALYSIS_OUTPUT_SCHEMAS[agent].safeParse(out.json);
          if (parsed.success) {
            return {
              ok: true,
              output: parsed.data,
              model: model ?? 'desconhecido',
              promptVersion,
              durationMs: elapsed(),
              ...telemetry(),
            } as AnalysisResult<typeof agent>;
          }
        }
        log(`[investigação] ${agent}: resposta fora do formato`);
        return {
          ok: false,
          code: 'invalid_output',
          model,
          promptVersion,
          durationMs: elapsed(),
          ...telemetry(),
        };
      } catch (error) {
        if (options?.signal?.aborted) throw error;
        const failure = isAiError(error) ? error : toAiError(error);
        log(
          `[investigação] ${agent}: ${failure.code}${failure.detail ? ` (${failure.detail})` : ''}`,
        );
        return {
          ok: false,
          code: failure.code,
          model,
          promptVersion,
          durationMs: elapsed(),
          ...telemetry(),
        };
      }
    },
  };
}
