import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GenerationUsage } from '@prospector/contracts';
import { expect, it } from 'vitest';
import { COPILOT_PROMPT_VERSION, createCopilot } from '../../src/copilot/copilot';
import { DEFAULT_POLICY } from '../../src/model-policy';
import { createOllamaClient, DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { loadPrompt } from '../../src/prompts';
import { createLocalAiRuntime } from '../../src/runtime';
import { CASES, EVAL_NOW, evalSystemFacts } from './cases';
import { gradeRun, printSummary, summarize, type Run, type SummaryGroup } from './report';

/**
 * Avaliação local do Copiloto (`pnpm evals`). Roda no Ollama deste computador, sem custo de API.
 * Os modelos rodam UM DE CADA VEZ e cada um é descarregado ao terminar (ADR-0008), para não
 * somar uso de VRAM; com mais de uma versão de prompt, todas rodam com o modelo já carregado.
 * Resultado salvo em `results/` com o texto de cada resposta.
 *
 * Variáveis: EVAL_MODELS (lista separada por vírgula; padrão = política do Copiloto),
 * EVAL_PROMPTS (versões do prompt, ex.: "1,2"; padrão = a versão em uso), EVAL_REPEAT
 * (repetições por caso; padrão 2, a temperatura não é zero), EVAL_CASES (ids separados por
 * vírgula; padrão = todos, ex.: "raciocinio-ligado" com EVAL_REPEAT=10) e EVAL_REGRADE (caminho
 * de um resultado salvo: recalcula as notas com os corretores atuais, sem Ollama).
 */
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const models = process.env.EVAL_MODELS?.split(',').map((name) => name.trim()) ?? [
  ...DEFAULT_POLICY.copilot.models,
];
const promptVersions = process.env.EVAL_PROMPTS?.split(',').map((value) =>
  Number(value.trim()),
) ?? [COPILOT_PROMPT_VERSION];
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 2));
const caseFilter = process.env.EVAL_CASES?.split(',').map((id) => id.trim());
const selectedCases = caseFilter ? CASES.filter((entry) => caseFilter.includes(entry.id)) : CASES;
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
    promptId?: string;
    runs: Run[];
    summary: Array<{ model: string; promptId?: string | null }>;
  } & Record<string, unknown>;
  // Resultados da IA-1 têm um só prompt, gravado no topo do arquivo.
  const filePrompt = original.promptId ?? null;
  const runs = original.runs.map((run) =>
    gradeRun({ ...run, promptId: run.promptId ?? filePrompt ?? undefined }, CASES),
  );
  const summary = summarize(
    runs,
    original.summary.map((row) => ({ model: row.model, promptId: row.promptId ?? filePrompt })),
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

it.skipIf(regradeSource)('Copiloto nos modelos locais', async () => {
  if (selectedCases.length === 0) throw new Error(`EVAL_CASES sem casos conhecidos: ${caseFilter}`);
  const runtime = createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 0 });
  const client = createOllamaClient({ baseUrl });
  const status = await runtime.gateway.status();
  if (status.state !== 'online') throw new Error(`Ollama fora do ar: ${status.message}`);
  const installed = new Map(status.installed.map((model) => [model.name, model]));
  const digests = new Map(
    (await client.listModels()).map((model) => [model.name, model.digest] as const),
  );
  const prompts = promptVersions.map((version) => loadPrompt('copilot', version));
  const copilots = prompts.map((prompt) => ({
    prompt,
    copilot: createCopilot({ gateway: runtime.gateway, prompt: () => prompt }),
  }));
  const runs: Run[] = [];
  const skipped: string[] = [];

  for (const model of models) {
    if (!installed.has(model)) {
      skipped.push(model);
      continue;
    }
    for (const evalCase of selectedCases) {
      for (let attempt = 1; attempt <= repeat; attempt += 1) {
        // Versões alternadas na mesma tentativa: a ordem não favorece nenhuma.
        for (const { prompt, copilot } of copilots) {
          const started = performance.now();
          let firstTokenMs: number | null = null;
          let output = '';
          let usage: GenerationUsage | null = null;
          let error: string | null = null;
          for await (const event of copilot.reply(
            {
              schemaVersion: 1,
              think: evalCase.think ?? false,
              model,
              messages: [...(evalCase.history ?? []), { role: 'user', content: evalCase.input }],
            },
            {
              traceId: `eval-${prompt.id}-${evalCase.id}-${attempt}`,
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
                promptId: prompt.id,
                model,
                caseId: evalCase.id,
                attempt,
                think: evalCase.think ?? false,
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
    }
    // Sequencial: libera a VRAM antes do próximo modelo.
    await runtime.gateway.unload(model);
  }

  const evaluated = models.filter((model) => !skipped.includes(model));
  const groups: SummaryGroup[] = evaluated.flatMap((model) =>
    prompts.map((prompt) => ({ promptId: prompt.id, model })),
  );
  const summary = summarize(runs, groups);
  const policy = runtime.policy.copilot;
  const report = {
    synthetic: true,
    capability: 'copilot',
    prompts: prompts.map(({ id, sha256 }) => ({ id, sha256 })),
    ...(prompts.length === 1 ? { promptId: prompts[0]?.id, promptSha256: prompts[0]?.sha256 } : {}),
    ranAt: new Date().toISOString(),
    factsDate: EVAL_NOW.toISOString(),
    ollamaVersion: status.version,
    gpu: status.gpu?.name ?? null,
    params: {
      temperature: policy.temperature,
      numCtx: policy.numCtx,
      maxOutputTokens: policy.maxOutputTokens,
      maxOutputTokensThinking: policy.maxOutputTokensThinking,
      repeat,
    },
    modelDigests: Object.fromEntries(evaluated.map((model) => [model, digests.get(model) ?? null])),
    cases: selectedCases.map(({ id, goal, input, history, think, database }) => ({
      id,
      goal,
      input,
      history: history ?? [],
      think: think ?? false,
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
  // O limiar vale para a última versão pedida (a candidata) no modelo preferido.
  const candidate = prompts.at(-1)?.id ?? null;
  const preferred = summary.find((row) => row.model === models[0] && row.promptId === candidate);
  expect(preferred, `${models[0]} precisa estar instalado`).toBeDefined();
  expect(preferred?.passRate ?? 0).toBeGreaterThanOrEqual(MIN_PASS_RATE);
});
