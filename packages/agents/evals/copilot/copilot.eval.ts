import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerationUsage } from '@prospector/contracts';
import { expect, it } from 'vitest';
import { DEFAULT_POLICY } from '../../src/model-policy';
import { createOllamaClient, DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { loadPrompt } from '../../src/prompts';
import { createLocalAiRuntime } from '../../src/runtime';
import { CASES, EVAL_NOW, evalSystemFacts } from './cases';
import { gradeRun, printSummary, summarize, type Run } from './report';

/**
 * Avaliação local do Copiloto v1 (`pnpm evals`). Roda no Ollama deste computador, sem custo de
 * API. Os modelos rodam UM DE CADA VEZ e cada um é descarregado ao terminar (ADR-0008), para não
 * somar uso de VRAM. Resultado salvo em `results/` com o texto de cada resposta.
 *
 * Variáveis: EVAL_MODELS (lista separada por vírgula; padrão = política do Copiloto),
 * EVAL_REPEAT (repetições por caso; padrão 2, a temperatura não é zero) e EVAL_REGRADE
 * (caminho de um resultado salvo: recalcula as notas com os corretores atuais, sem Ollama).
 */
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const models = process.env.EVAL_MODELS?.split(',').map((name) => name.trim()) ?? [
  ...DEFAULT_POLICY.copilot.models,
];
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 2));
/** Limiar do modelo preferido da política (docs/11 §4.3 para capacidades locais). */
const MIN_PASS_RATE = 0.75;
const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results');

function save(name: string, report: object): string {
  mkdirSync(resultsDir, { recursive: true });
  const file = join(resultsDir, name);
  writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return file;
}

const regradeSource = process.env.EVAL_REGRADE;

it.runIf(regradeSource)('recalcula um resultado salvo com os corretores atuais', () => {
  const source = regradeSource ?? '';
  const path = isAbsolute(source) ? source : join(resultsDir, source);
  const original = JSON.parse(readFileSync(path, 'utf8')) as {
    runs: Run[];
    summary: Array<{ model: string }>;
  } & Record<string, unknown>;
  const runs = original.runs.map((run) => gradeRun(run, CASES));
  const summary = summarize(
    runs,
    original.summary.map((row) => row.model),
  );
  const file = save(
    path
      .split(/[\\/]/)
      .at(-1)
      ?.replace(/\.json$/, '.regraded.json') ?? 'regraded.json',
    {
      ...original,
      regradedAt: new Date().toISOString(),
      regradedFrom: path.split(/[\\/]/).at(-1),
      note: 'Mesmas respostas, notas recalculadas com os corretores atuais (sem gerar de novo).',
      summary,
      runs,
    },
  );
  printSummary(file, summary);
  expect(summary.length).toBeGreaterThan(0);
});

it.skipIf(regradeSource)('copilot/v1 nos modelos locais', async () => {
  const runtime = createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 0 });
  const client = createOllamaClient({ baseUrl });
  const status = await runtime.gateway.status();
  if (status.state !== 'online') throw new Error(`Ollama fora do ar: ${status.message}`);
  const installed = new Map(status.installed.map((model) => [model.name, model]));
  const digests = new Map(
    (await client.listModels()).map((model) => [model.name, model.digest] as const),
  );
  const prompt = loadPrompt('copilot', 1);
  const runs: Run[] = [];
  const skipped: string[] = [];

  for (const model of models) {
    if (!installed.has(model)) {
      skipped.push(model);
      continue;
    }
    for (const evalCase of CASES) {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        const started = performance.now();
        let firstTokenMs: number | null = null;
        let output = '';
        let usage: GenerationUsage | null = null;
        let error: string | null = null;
        for await (const event of runtime.copilot.reply(
          {
            schemaVersion: 1,
            think: false,
            model,
            messages: [{ role: 'user', content: evalCase.input }],
          },
          {
            traceId: `eval-${evalCase.id}-${attempt}`,
            systemFacts: evalSystemFacts(evalCase.database),
          },
        )) {
          if (event.type === 'delta') {
            firstTokenMs ??= performance.now() - started;
            output += event.text;
          }
          if (event.type === 'done') usage = event.usage;
          if (event.type === 'error') error = `${event.code}: ${event.message}`;
        }
        runs.push(
          gradeRun(
            {
              model,
              caseId: evalCase.id,
              attempt,
              output,
              error,
              firstTokenMs,
              usage,
              grades: [],
              pass: false,
            },
            CASES,
          ),
        );
      }
    }
    // Sequencial: libera a VRAM antes do próximo modelo.
    await runtime.gateway.unload(model);
  }

  const evaluated = models.filter((model) => !skipped.includes(model));
  const summary = summarize(runs, evaluated);
  const policy = runtime.policy.copilot;
  const report = {
    synthetic: true,
    capability: 'copilot',
    promptId: prompt.id,
    promptSha256: prompt.sha256,
    ranAt: new Date().toISOString(),
    factsDate: EVAL_NOW.toISOString(),
    ollamaVersion: status.version,
    gpu: status.gpu?.name ?? null,
    params: {
      temperature: policy.temperature,
      numCtx: policy.numCtx,
      maxOutputTokens: policy.maxOutputTokens,
      think: false,
      repeat,
    },
    modelDigests: Object.fromEntries(evaluated.map((model) => [model, digests.get(model) ?? null])),
    cases: CASES.map(({ id, goal, input, database }) => ({
      id,
      goal,
      input,
      database: database ?? 'not_configured',
    })),
    skipped,
    summary,
    runs,
  };
  const file = save(`${report.ranAt.slice(0, 16).replace(/[:T]/g, '-')}.json`, report);
  printSummary(file, summary);
  if (skipped.length) console.info(`[evals] não instalados (pulados): ${skipped.join(', ')}`);

  await client.listRunning(); // confirma que o Ollama segue respondendo depois da bateria
  const preferred = summary.find((row) => row.model === models[0]);
  expect(preferred, `${models[0]} precisa estar instalado`).toBeDefined();
  expect(preferred?.passRate ?? 0).toBeGreaterThanOrEqual(MIN_PASS_RATE);
});
