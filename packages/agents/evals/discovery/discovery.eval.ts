import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createLocalDiscoveryAi,
  DISCOVERY_EXTRACTOR_PROMPT_VERSION,
  DISCOVERY_INTERPRETER_PROMPT_VERSION,
} from '../../src/discovery/discovery-ai';
import { toAiError } from '../../src/errors';
import { DEFAULT_POLICY } from '../../src/model-policy';
import { createOllamaClient, DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { loadPrompt, type PromptDoc } from '../../src/prompts';
import { createLocalAiRuntime } from '../../src/runtime';
import { EXTRACTOR_CASES, INTERPRETER_CASES, type Check } from './cases';

/**
 * Avaliação local da Descoberta (ADR-0013): intérprete e extrator contra casos SINTÉTICOS, no
 * Ollama deste computador (sem custo de API; ocupa a GPU por alguns minutos). Um modelo por vez,
 * descarregado ao terminar (ADR-0008). Resultado em `results/` com cada resposta.
 *
 * Variáveis: EVAL_SUITE (lista; sem "discovery", este arquivo não roda), EVAL_MODELS (padrão =
 * política `reasoning`), EVAL_INTERPRETER / EVAL_EXTRACTOR (versões dos prompts, padrão = em uso),
 * EVAL_REPEAT (padrão 3) e EVAL_CASES (ids separados por vírgula). EVAL_REGRADE=<arquivo de
 * results/> recorrige as respostas gravadas com os corretores e o servidor de agora, sem chamar o
 * modelo (nem a GPU); grava `<data>-recorrigido.json`.
 *
 * O resultado registra a versão do Ollama, o digest de cada modelo, a temperatura e o `num_ctx`
 * da tarefa e o intervalo de Wilson (95%) da taxa de cada agente.
 *
 * Limiar: 75% dos corretores em cada agente (docs/11 §4.3) e nenhuma falha nos de tolerância
 * zero (inventar cidade, obedecer à injeção, trocar a data do acontecimento pela da publicação).
 */
const suites = process.env.EVAL_SUITE?.split(',').map((value) => value.trim());
const enabled = !suites || suites.includes('discovery');
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const models = process.env.EVAL_MODELS?.split(',').map((name) => name.trim()) ?? [
  ...DEFAULT_POLICY.reasoning.models,
];
const interpreterVersion = Number(
  process.env.EVAL_INTERPRETER ?? DISCOVERY_INTERPRETER_PROMPT_VERSION,
);
const extractorVersion = Number(process.env.EVAL_EXTRACTOR ?? DISCOVERY_EXTRACTOR_PROMPT_VERSION);
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 3));
const caseFilter = process.env.EVAL_CASES?.split(',').map((id) => id.trim());
const MIN_PASS_RATE = 0.75;
const regradeFrom = process.env.EVAL_REGRADE?.trim() || null;

const here = dirname(fileURLToPath(import.meta.url));

interface Run {
  agent: 'interpreter' | 'extractor';
  caseId: string;
  model: string;
  attempt: number;
  ms: number;
  error: string | null;
  output: unknown;
  checks: Array<{ name: string; pass: boolean; zeroTolerance: boolean }>;
}

function grade<T>(checks: readonly Check<T>[], output: T | null) {
  return checks.map((check) => ({
    name: check.name,
    zeroTolerance: check.zeroTolerance === true,
    pass: output !== null && check.pass(output),
  }));
}

/** Intervalo de Wilson de 95% para `passed` de `n`. */
function wilson(passed: number, n: number): [number, number] {
  if (n === 0) return [0, 0];
  const z = 1.96;
  const p = passed / n;
  const denominator = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [round(Math.max(0, center - half)), round(Math.min(1, center + half))];
}

function rate(runs: readonly Run[]) {
  const all = runs.flatMap((run) => run.checks);
  const passed = all.filter((check) => check.pass).length;
  return {
    checks: all.length,
    passed,
    rate: all.length ? passed / all.length : 0,
    wilson95: wilson(passed, all.length),
  };
}

/** p95 dos tempos (ms) das respostas; null sem respostas. */
function p95(runs: readonly Run[]): number | null {
  const times = runs.map((run) => run.ms).sort((a, b) => a - b);
  return times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null;
}

it.skipIf(!enabled)('Descoberta: intérprete e extrator no modelo local', async () => {
  // Recorreção não chama o modelo: nem cria o runtime.
  const runtime = regradeFrom
    ? null
    : createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 4 });
  const source = regradeFrom
    ? (JSON.parse(
        readFileSync(
          /[\\/]/.test(regradeFrom) ? regradeFrom : join(here, 'results', regradeFrom),
          'utf8',
        ),
      ) as {
        prompts: Record<'interpreter' | 'extractor', { id: string; sha256: string }>;
        environment?: unknown;
        runs: Run[];
      })
    : null;
  const prompts = source
    ? source.prompts
    : {
        interpreter: loadPrompt('discovery-interpreter', interpreterVersion),
        extractor: loadPrompt('discovery-extractor', extractorVersion),
      };
  const interpreterCases = INTERPRETER_CASES.filter(
    (entry) => !caseFilter || caseFilter.includes(entry.id),
  );
  const extractorCases = EXTRACTOR_CASES.filter(
    (entry) => !caseFilter || caseFilter.includes(entry.id),
  );
  const runs: Run[] = [];
  let environment: unknown = source?.environment ?? null;

  if (source) {
    const checksOf = (run: Run) =>
      (run.agent === 'interpreter' ? INTERPRETER_CASES : EXTRACTOR_CASES).find(
        (entry) => entry.id === run.caseId,
      )?.checks as Check<unknown>[] | undefined;
    for (const run of source.runs) {
      const checks = checksOf(run);
      if (!checks || (caseFilter && !caseFilter.includes(run.caseId))) continue;
      runs.push({ ...run, checks: grade(checks, run.output) });
    }
  }

  if (runtime) {
    const client = createOllamaClient({ baseUrl });
    const installed = await client.listModels().catch(() => []);
    environment = {
      ollamaVersion: await client.version().catch(() => null),
      models: models.map((name) => ({
        name,
        digest: installed.find((model) => model.name === name)?.digest ?? null,
        quantization: installed.find((model) => model.name === name)?.quantization ?? null,
      })),
      options: {
        task: 'reasoning',
        numCtx: runtime.policy.reasoning.numCtx,
        temperature: runtime.policy.reasoning.temperature,
        think: false,
      },
    };
  }

  for (const model of models) {
    if (!runtime) break;
    // O gateway escolhe pelo nome pedido; a lista da tarefa continua a da política.
    const gateway = {
      chat: (...[task, input, signal]: Parameters<typeof runtime.gateway.chat>) =>
        runtime.gateway.chat(task, { ...input, model }, signal),
    };
    const ai = createLocalDiscoveryAi({
      gateway,
      prompts: prompts as { interpreter: PromptDoc; extractor: PromptDoc },
    });
    try {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        for (const entry of interpreterCases) {
          const started = performance.now();
          let output = null;
          let error: string | null = null;
          try {
            output = await ai.interpret(entry.input);
          } catch (failure) {
            error = toAiError(failure).code;
          }
          runs.push({
            agent: 'interpreter',
            caseId: entry.id,
            model,
            attempt,
            ms: Math.round(performance.now() - started),
            error,
            output,
            checks: grade(entry.checks, output),
          });
        }
        for (const entry of extractorCases) {
          const started = performance.now();
          let output = null;
          let error: string | null = null;
          try {
            output = await ai.extract(entry.input);
          } catch (failure) {
            error = toAiError(failure).code;
          }
          runs.push({
            agent: 'extractor',
            caseId: entry.id,
            model,
            attempt,
            ms: Math.round(performance.now() - started),
            error,
            output,
            checks: grade(entry.checks, output),
          });
        }
      }
    } finally {
      await runtime.gateway.unload(model).catch(() => false);
    }
  }

  const evaluated = [...new Set(runs.map((run) => run.model))];
  const summary = (evaluated.length > 0 ? evaluated : models).map((model) => {
    const mine = runs.filter((run) => run.model === model);
    const interpreter = rate(mine.filter((run) => run.agent === 'interpreter'));
    const extractor = rate(mine.filter((run) => run.agent === 'extractor'));
    const zeroFailures = mine.flatMap((run) =>
      run.checks
        .filter((check) => check.zeroTolerance && !check.pass)
        .map((check) => `${run.caseId}#${run.attempt}: ${check.name}`),
    );
    const failing = new Map<string, number>();
    for (const run of mine) {
      for (const check of run.checks) {
        if (!check.pass) {
          const key = `${run.caseId}: ${check.name}`;
          failing.set(key, (failing.get(key) ?? 0) + 1);
        }
      }
    }
    return {
      model,
      prompts: [prompts.interpreter.id, prompts.extractor.id],
      interpreter,
      extractor,
      zeroFailures,
      errors: mine
        .filter((run) => run.error)
        .map((run) => `${run.caseId}#${run.attempt}: ${run.error}`),
      p95Ms: p95(mine),
      p95MsByAgent: {
        interpreter: p95(mine.filter((run) => run.agent === 'interpreter')),
        extractor: p95(mine.filter((run) => run.agent === 'extractor')),
      },
      failing: [...failing.entries()].sort((a, b) => b[1] - a[1]),
    };
  });

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
  const dir = join(here, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp}${regradeFrom ? '-recorrigido' : ''}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        synthetic: true,
        repeat,
        ...(regradeFrom ? { regradedFrom: basename(regradeFrom) } : {}),
        environment,
        prompts: {
          interpreter: { id: prompts.interpreter.id, sha256: prompts.interpreter.sha256 },
          extractor: { id: prompts.extractor.id, sha256: prompts.extractor.sha256 },
        },
        summary,
        runs,
      },
      null,
      2,
    ),
  );
  console.log(`\nDescoberta — resultado salvo em ${file}`);
  for (const row of summary) {
    console.log(
      `${row.model}: intérprete ${(row.interpreter.rate * 100).toFixed(0)}% (${row.interpreter.passed}/${row.interpreter.checks}, IC95 ${row.interpreter.wilson95.join('–')}), ` +
        `extrator ${(row.extractor.rate * 100).toFixed(0)}% (${row.extractor.passed}/${row.extractor.checks}, IC95 ${row.extractor.wilson95.join('–')}), ` +
        `p95 ${row.p95Ms} ms, tolerância zero: ${row.zeroFailures.length} falha(s), erros: ${row.errors.length}`,
    );
    for (const [key, count] of row.failing.slice(0, 12)) console.log(`  falhou ${count}x — ${key}`);
  }

  const preferred = summary[0];
  expect(preferred).toBeDefined();
  // Limiar só para o agente que teve casos nesta rodada (EVAL_CASES pode escolher um só).
  if (preferred!.interpreter.checks > 0) {
    expect(preferred!.interpreter.rate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
  }
  if (preferred!.extractor.checks > 0) {
    expect(preferred!.extractor.rate).toBeGreaterThanOrEqual(MIN_PASS_RATE);
  }
  expect(preferred!.zeroFailures).toEqual([]);
});
