import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  createLocalDiscoveryAi,
  DISCOVERY_EXTRACTOR_PROMPT_VERSION,
  DISCOVERY_INTERPRETER_PROMPT_VERSION,
} from '../../src/discovery/discovery-ai';
import { toAiError } from '../../src/errors';
import { DEFAULT_POLICY } from '../../src/model-policy';
import { DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { loadPrompt } from '../../src/prompts';
import { createLocalAiRuntime } from '../../src/runtime';
import { EXTRACTOR_CASES, INTERPRETER_CASES, type Check } from './cases';

/**
 * Avaliação local da Descoberta (ADR-0013): intérprete e extrator contra casos SINTÉTICOS, no
 * Ollama deste computador (sem custo de API; ocupa a GPU por alguns minutos). Um modelo por vez,
 * descarregado ao terminar (ADR-0008). Resultado em `results/` com cada resposta.
 *
 * Variáveis: EVAL_SUITE (lista; sem "discovery", este arquivo não roda), EVAL_MODELS (padrão =
 * política `reasoning`), EVAL_INTERPRETER / EVAL_EXTRACTOR (versões dos prompts, padrão = em uso),
 * EVAL_REPEAT (padrão 3) e EVAL_CASES (ids separados por vírgula).
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

function rate(runs: readonly Run[]) {
  const all = runs.flatMap((run) => run.checks);
  const passed = all.filter((check) => check.pass).length;
  return { checks: all.length, passed, rate: all.length ? passed / all.length : 0 };
}

it.skipIf(!enabled)('Descoberta: intérprete e extrator no modelo local', async () => {
  const runtime = createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 4 });
  const prompts = {
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

  for (const model of models) {
    // O gateway escolhe pelo nome pedido; a lista da tarefa continua a da política.
    const gateway = {
      chat: (...[task, input, signal]: Parameters<typeof runtime.gateway.chat>) =>
        runtime.gateway.chat(task, { ...input, model }, signal),
    };
    const ai = createLocalDiscoveryAi({ gateway, prompts });
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

  const summary = models.map((model) => {
    const mine = runs.filter((run) => run.model === model);
    const interpreter = rate(mine.filter((run) => run.agent === 'interpreter'));
    const extractor = rate(mine.filter((run) => run.agent === 'extractor'));
    const zeroFailures = mine.flatMap((run) =>
      run.checks
        .filter((check) => check.zeroTolerance && !check.pass)
        .map((check) => `${run.caseId}#${run.attempt}: ${check.name}`),
    );
    const times = mine.map((run) => run.ms).sort((a, b) => a - b);
    const p95 = times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null;
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
      p95Ms: p95,
      failing: [...failing.entries()].sort((a, b) => b[1] - a[1]),
    };
  });

  const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
  const dir = join(here, 'results');
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${stamp}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        synthetic: true,
        repeat,
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
      `${row.model}: intérprete ${(row.interpreter.rate * 100).toFixed(0)}% (${row.interpreter.passed}/${row.interpreter.checks}), ` +
        `extrator ${(row.extractor.rate * 100).toFixed(0)}% (${row.extractor.passed}/${row.extractor.checks}), ` +
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
