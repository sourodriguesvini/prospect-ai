import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApproachAiOutput, MessageDraftText } from '@prospector/contracts';
import { expect, it } from 'vitest';
import { DEFAULT_POLICY } from '../../src/model-policy';
import { createOllamaClient, DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { loadPrompt } from '../../src/prompts';
import {
  createRelationshipAi,
  RELATIONSHIP_PROMPT_VERSIONS,
} from '../../src/relationship/relationship-ai';
import { createLocalAiRuntime } from '../../src/runtime';
import {
  APPROACH_CASES,
  HOLDOUT_APPROACH_CASES,
  HOLDOUT_MESSAGE_CASES,
  MESSAGE_CASES,
  THESIS_APPROACH_CASES,
  THESIS_MESSAGE_CASES,
  type Check,
} from './cases';
import { loadExperimentalVoiceGuide, toVoiceGuideContent, withAgency } from './voice-guide';

/**
 * Avaliação local do Relacionamento (ADR-0014, KI-150): estratégia de abordagem e mensagem contra
 * casos SINTÉTICOS, no Ollama deste computador (sem custo de API; ocupa a GPU por alguns minutos).
 * Um modelo por vez, descarregado ao terminar (ADR-0008). Resultado em `results/` com cada
 * resposta.
 *
 * Variáveis: EVAL_SUITE (lista; sem "relationship", este arquivo não roda), EVAL_MODELS (padrão =
 * política `copilot`, a tarefa do Relacionamento), EVAL_APPROACH / EVAL_MESSAGE (versões dos
 * prompts, padrão = em uso), EVAL_REPEAT (padrão 3), EVAL_CASES (ids separados por vírgula) e
 * EVAL_HOLDOUT=1 (inclui os casos de fora da amostra, guardados para a rodada final).
 * EVAL_VOICE=experimental dá a todos os casos o guia de voz experimental (`voice-guide.ts`).
 * EVAL_REGRADE=<arquivo em results/> recalcula as notas de um resultado salvo com os corretores
 * atuais, sem chamar o modelo (grava `<arquivo>.regraded.json`).
 *
 * A saída passa pelo contrato (como no serviço): JSON que não passa conta como falha em todos os
 * corretores do caso. Limiar: 75% dos corretores em cada agente (docs/11 §4.3) e nenhuma falha
 * nos de tolerância zero (fonte trocada, histórico de contato inventado, marcador entre colchetes,
 * reescrita que traz de volta o que o usuário tirou, lugar ou experiência inventados). Corretores
 * "informativos" aparecem no relatório mas ficam fora da taxa.
 */
const suites = process.env.EVAL_SUITE?.split(',').map((value) => value.trim());
const enabled = suites?.includes('relationship') ?? false;
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const models = process.env.EVAL_MODELS?.split(',').map((name) => name.trim()) ?? [
  ...DEFAULT_POLICY.copilot.models,
];
const approachVersion = Number(process.env.EVAL_APPROACH ?? RELATIONSHIP_PROMPT_VERSIONS.approach);
const messageVersion = Number(process.env.EVAL_MESSAGE ?? RELATIONSHIP_PROMPT_VERSIONS.message);
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 3));
const caseFilter = process.env.EVAL_CASES?.split(',').map((id) => id.trim());
const regradeSource = process.env.EVAL_REGRADE;
const holdout = process.env.EVAL_HOLDOUT === '1';
// EVAL_VOICE=experimental: todos os casos recebem o guia de voz EXPERIMENTAL (exemplos fictícios,
// docs/comunicacao-frente-2-experimental.md), com o nome da agência de cada caso. Sem a variável,
// cada caso usa o guia que já tem (em geral nenhum).
const experimentalVoice =
  process.env.EVAL_VOICE === 'experimental'
    ? toVoiceGuideContent(loadExperimentalVoiceGuide())
    : null;
const withVoice = <T extends { voice: unknown; agencyName: string | null }>(input: T): T =>
  experimentalVoice ? { ...input, voice: withAgency(experimentalVoice, input.agencyName) } : input;
// Os casos da tese (Parte 5) entram na amostra: com prompt anterior à v5, a tese não chega ao
// modelo, e a comparação mostra o que ela muda.
const MAIN_APPROACH = [...APPROACH_CASES, ...THESIS_APPROACH_CASES];
const MAIN_MESSAGE = [...MESSAGE_CASES, ...THESIS_MESSAGE_CASES];
const ALL_APPROACH = [...MAIN_APPROACH, ...HOLDOUT_APPROACH_CASES];
const ALL_MESSAGE = [...MAIN_MESSAGE, ...HOLDOUT_MESSAGE_CASES];
const HOLDOUT_IDS = new Set(
  [...HOLDOUT_APPROACH_CASES, ...HOLDOUT_MESSAGE_CASES].map((entry) => entry.id),
);
const MIN_PASS_RATE = 0.75;

const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results');

interface Run {
  agent: 'approach' | 'message';
  caseId: string;
  model: string;
  attempt: number;
  ms: number;
  /** Chamadas ao modelo (2 = a conferência da resposta pediu correção, v2+). */
  calls: number;
  error: string | null;
  output: unknown;
  /** Primeira resposta, quando a conferência pediu correção (antes dela). */
  first?: unknown;
  /** Texto da correção enviada ao modelo. */
  corrections?: string[];
  /** Avisos que sobraram na resposta usada (viram aviso na tela). */
  unresolved?: string[];
  /** Ajustes do sistema depois da correção (menção de fonte errada tirada). */
  adjusted?: string[];
  checks: Array<{ name: string; pass: boolean; zeroTolerance: boolean; informative?: boolean }>;
}

function grade<T>(checks: readonly Check<T>[], output: T | null) {
  return checks.map((check) => ({
    name: check.name,
    zeroTolerance: check.zeroTolerance === true,
    ...(check.informative ? { informative: true } : {}),
    pass: output !== null && check.pass(output),
  }));
}

/** Intervalo de Wilson (95%) da taxa: com poucas amostras, a faixa importa mais que o ponto. */
function wilson(passed: number, total: number): [number, number] | null {
  if (total === 0) return null;
  const z = 1.96;
  const p = passed / total;
  const center = p + (z * z) / (2 * total);
  const margin = z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total));
  const scale = 1 + (z * z) / total;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [round((center - margin) / scale), round((center + margin) / scale)];
}

function rate(runs: readonly Run[]) {
  const all = runs.flatMap((run) => run.checks).filter((check) => !check.informative);
  const passed = all.filter((check) => check.pass).length;
  return {
    checks: all.length,
    passed,
    rate: all.length ? passed / all.length : 0,
    wilson95: wilson(passed, all.length),
  };
}

/** Notas de uma resposta pelos corretores atuais do caso (a saída passa pelo contrato). */
function gradeOutput(agent: Run['agent'], caseId: string, output: unknown): Run['checks'] {
  if (agent === 'approach') {
    const entry = ALL_APPROACH.find((item) => item.id === caseId);
    if (!entry) throw new Error(`caso desconhecido: ${caseId}`);
    const parsed = output === null ? null : ApproachAiOutput.safeParse(output);
    return grade(entry.checks, parsed?.success ? parsed.data : null);
  }
  const entry = ALL_MESSAGE.find((item) => item.id === caseId);
  if (!entry) throw new Error(`caso desconhecido: ${caseId}`);
  const parsed = output === null ? null : MessageDraftText.safeParse(output);
  return grade(entry.checks, parsed?.success ? parsed.data : null);
}

function summarize(runs: readonly Run[], promptIds: readonly string[]) {
  return [...new Set(runs.map((run) => run.model))].map((model) => {
    const mine = runs.filter((run) => run.model === model);
    const approach = rate(mine.filter((run) => run.agent === 'approach'));
    const message = rate(mine.filter((run) => run.agent === 'message'));
    const inSample = mine.filter((run) => !HOLDOUT_IDS.has(run.caseId));
    const outOfSample = mine.filter((run) => HOLDOUT_IDS.has(run.caseId));
    const zeroFailures = mine.flatMap((run) =>
      run.checks
        .filter((check) => check.zeroTolerance && !check.pass)
        .map((check) => `${run.caseId}#${run.attempt}: ${check.name}`),
    );
    const times = mine.map((run) => run.ms).sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null;
    const byCheck = new Map<string, { passed: number; total: number }>();
    for (const run of mine) {
      for (const check of run.checks) {
        const key = `${run.caseId}: ${check.name}${check.informative ? ' (informativo)' : ''}`;
        const entry = byCheck.get(key) ?? { passed: 0, total: 0 };
        entry.total += 1;
        if (check.pass) entry.passed += 1;
        byCheck.set(key, entry);
      }
    }
    return {
      model,
      prompts: [...promptIds],
      approach,
      message,
      ...(outOfSample.length > 0
        ? {
            inSample: {
              approach: rate(inSample.filter((run) => run.agent === 'approach')),
              message: rate(inSample.filter((run) => run.agent === 'message')),
            },
            outOfSample: {
              approach: rate(outOfSample.filter((run) => run.agent === 'approach')),
              message: rate(outOfSample.filter((run) => run.agent === 'message')),
            },
          }
        : {}),
      zeroFailures,
      errors: mine
        .filter((run) => run.error)
        .map((run) => `${run.caseId}#${run.attempt}: ${run.error}`),
      p95Ms: p95,
      corrections: mine.filter((run) => (run.calls ?? 1) > 1).length,
      unresolved: mine.filter((run) => (run.unresolved?.length ?? 0) > 0).length,
      adjusted: mine.filter((run) => (run.adjusted?.length ?? 0) > 0).length,
      checks: Object.fromEntries(
        [...byCheck.entries()].map(([key, value]) => [key, `${value.passed}/${value.total}`]),
      ),
    };
  });
}

const sha256 = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** O que identifica a rodada além dos prompts: modelo exato, Ollama, parâmetros e código. */
async function environment(runtimeModels: readonly string[]) {
  const client = createOllamaClient({ baseUrl });
  const [ollamaVersion, installed] = await Promise.all([
    client.version().catch(() => null),
    client.listModels().catch(() => []),
  ]);
  return {
    ollamaVersion,
    models: runtimeModels.map((name) => ({
      name,
      digest: installed.find((model) => model.name === name)?.digest ?? null,
    })),
    code: {
      'src/relationship/relationship-ai.ts': sha256(
        join(here, '../../src/relationship/relationship-ai.ts'),
      ),
      'evals/relationship/cases.ts': sha256(join(here, 'cases.ts')),
      'evals/relationship/relationship.eval.ts': sha256(fileURLToPath(import.meta.url)),
      // Com EVAL_VOICE=experimental, a rodada depende do guia: duas rodadas só se comparam com o
      // mesmo guia.
      'evals/relationship/voice-guide.experimental.json': sha256(
        join(here, 'voice-guide.experimental.json'),
      ),
      'evals/relationship/voice-guide.ts': sha256(join(here, 'voice-guide.ts')),
    },
  };
}

function save(name: string, report: object): string {
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, name);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

function printSummary(file: string, summary: ReturnType<typeof summarize>) {
  console.log(`\nRelacionamento — resultado salvo em ${file}`);
  for (const row of summary) {
    console.log(
      `${row.model}: estratégia ${(row.approach.rate * 100).toFixed(0)}% (${row.approach.passed}/${row.approach.checks}), ` +
        `mensagem ${(row.message.rate * 100).toFixed(0)}% (${row.message.passed}/${row.message.checks}), ` +
        `p95 ${row.p95Ms} ms, tolerância zero: ${row.zeroFailures.length} falha(s), erros: ${row.errors.length}`,
    );
  }
}

/** Primeira resposta, correção e avisos que sobraram, quando a conferência agiu. */
function reviewFields(outcome: {
  ok: boolean;
  review?: { first: unknown; corrections: string[]; unresolved: string[]; adjusted?: string[] };
}) {
  if (!outcome.ok || !outcome.review) return {};
  return {
    first: outcome.review.first,
    corrections: outcome.review.corrections,
    unresolved: outcome.review.unresolved,
    ...(outcome.review.adjusted ? { adjusted: outcome.review.adjusted } : {}),
  };
}

it.runIf(enabled && regradeSource)('recalcula um resultado salvo com os corretores atuais', () => {
  const source = regradeSource ?? '';
  const path = isAbsolute(source) ? source : join(resultsDir, source);
  const original = JSON.parse(readFileSync(path, 'utf8')) as {
    prompts: { approach: { id: string }; message: { id: string } };
    runs: Run[];
  } & Record<string, unknown>;
  const runs = original.runs.map((run) => ({
    ...run,
    checks: gradeOutput(run.agent, run.caseId, run.output),
  }));
  const summary = summarize(runs, [original.prompts.approach.id, original.prompts.message.id]);
  const name = path.split(/[\\/]/).at(-1) ?? 'resultado.json';
  const file = save(name.replace(/\.json$/, '.regraded.json'), {
    ...original,
    regradedAt: new Date().toISOString(),
    regradedFrom: name,
    note: 'Mesmas respostas, notas recalculadas com os corretores atuais (sem gerar de novo).',
    summary,
    runs,
  });
  printSummary(file, summary);
  expect(summary.length).toBeGreaterThan(0);
});

// Sem EVAL_SUITE com "relationship", não roda (ocupa a GPU; só quando pedido).
it.skipIf(!enabled || regradeSource)(
  'Relacionamento: estratégia e mensagem no modelo local',
  async () => {
    const runtime = createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 4 });
    const prompts = {
      approach: loadPrompt('relationship-approach', approachVersion),
      message: loadPrompt('relationship-message', messageVersion),
    };
    const approachCases = (holdout ? ALL_APPROACH : MAIN_APPROACH).filter(
      (entry) => !caseFilter || caseFilter.includes(entry.id),
    );
    const messageCases = (holdout ? ALL_MESSAGE : MAIN_MESSAGE).filter(
      (entry) => !caseFilter || caseFilter.includes(entry.id),
    );
    const runs: Run[] = [];
    let chatCalls = 0;

    for (const model of models) {
      // O gateway escolhe pelo nome pedido; a lista da tarefa continua a da política.
      const gateway = {
        ...runtime.gateway,
        chat: (...[task, input, signal]: Parameters<typeof runtime.gateway.chat>) => {
          chatCalls += 1;
          return runtime.gateway.chat(task, { ...input, model }, signal);
        },
      };
      const ai = createRelationshipAi({ gateway, prompts });
      try {
        for (let attempt = 1; attempt <= repeat; attempt += 1) {
          for (const entry of approachCases) {
            const started = performance.now();
            const before = chatCalls;
            const outcome = await ai.approach(withVoice(entry.input));
            const parsed = outcome.ok ? ApproachAiOutput.safeParse(outcome.data) : null;
            runs.push({
              agent: 'approach',
              caseId: entry.id,
              model,
              attempt,
              ms: Math.round(performance.now() - started),
              calls: chatCalls - before,
              error: !outcome.ok ? outcome.code : parsed?.success ? null : 'contract',
              output: outcome.ok ? outcome.data : null,
              ...reviewFields(outcome),
              checks: grade(entry.checks, parsed?.success ? parsed.data : null),
            });
          }
          for (const entry of messageCases) {
            const started = performance.now();
            const before = chatCalls;
            const outcome = await ai.message(withVoice(entry.input));
            const parsed = outcome.ok ? MessageDraftText.safeParse(outcome.data) : null;
            runs.push({
              agent: 'message',
              caseId: entry.id,
              model,
              attempt,
              ms: Math.round(performance.now() - started),
              calls: chatCalls - before,
              error: !outcome.ok ? outcome.code : parsed?.success ? null : 'contract',
              output: outcome.ok ? outcome.data : null,
              ...reviewFields(outcome),
              checks: grade(entry.checks, parsed?.success ? parsed.data : null),
            });
          }
        }
      } finally {
        await runtime.gateway.unload(model).catch(() => false);
      }
    }

    const summary = summarize(runs, [prompts.approach.id, prompts.message.id]);
    const policy = runtime.policy.copilot;
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
    const voiceSuffix = experimentalVoice ? '-voz' : '';
    const file = save(`${stamp}-a${approachVersion}-m${messageVersion}${voiceSuffix}.json`, {
      synthetic: true,
      repeat,
      holdout,
      voice: experimentalVoice ? 'experimental' : 'casos',
      params: { temperature: policy.temperature, numCtx: policy.numCtx, task: 'copilot' },
      environment: await environment(models),
      prompts: {
        approach: { id: prompts.approach.id, sha256: prompts.approach.sha256 },
        message: { id: prompts.message.id, sha256: prompts.message.sha256 },
      },
      summary,
      runs,
    });
    printSummary(file, summary);

    for (const row of summary) {
      if (approachCases.length > 0) expect(row.approach.rate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
      if (messageCases.length > 0) expect(row.message.rate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
      expect(row.zeroFailures).toEqual([]);
    }
  },
);
