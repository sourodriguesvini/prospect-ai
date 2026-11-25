import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  consistencyScoreFromFacts,
  guardBusinessInput,
  guardBusinessOutput,
  guardDiagnosisInput,
  guardDiagnosisOutput,
  guardTriageInput,
  guardTriageOutput,
  guardVisualInput,
  guardVisualOutput,
  type AnalysisInputs,
  type AnalysisOutputs,
  type GuardContext,
} from '@prospector/application';
import type { AnalysisAgent } from '@prospector/contracts';
import { expect, it } from 'vitest';
import { createLocalBrandAnalysisAi } from '../../src/investigation/brand-analysis-ai';
import { DEFAULT_POLICY } from '../../src/model-policy';
import { createOllamaClient, DEFAULT_OLLAMA_URL } from '../../src/ollama/client';
import { loadPrompt, type PromptDoc } from '../../src/prompts';
import { createLocalAiRuntime } from '../../src/runtime';
import {
  EVAL_AGENTS,
  INVESTIGATION_CASES,
  type Check,
  type EvalAgent,
  type InvestigationCase,
} from './cases';
import { preservation, type Preservation } from './erasure';

/**
 * Avaliação local das análises da investigação (KI-131, KI-152, KI-133): leitura do site
 * (`company-business`), auditoria visual (`brand-visual`, com capturas SINTÉTICAS de
 * fixtures/), triagem de concorrentes e diagnóstico, contra casos SINTÉTICOS no Ollama deste
 * computador (sem custo de API; ocupa a GPU). Cada versão de prompt roda nos MESMOS casos, para
 * comparar a linha de base (v1) com a candidata. Resultado em `results/`, com cada resposta.
 *
 * Guardas do servidor (`@prospector/application`, revisão do avaliador-ia de 2026-11-25): a
 * entrada vai ao modelo já protegida, como na investigação, e cada resposta é corrigida duas
 * vezes, crua (`rawChecks`, o que o modelo escreveu) e depois das guardas de saída (`checks`, o
 * que o usuário veria). O limiar vale para a saída com guardas.
 *
 * Variáveis: EVAL_SUITE (lista; sem "investigation", este arquivo não roda), EVAL_MODELS (padrão
 * = política `reasoning`), EVAL_VERSIONS (padrão "1,3"; a v1 roda primeiro), EVAL_AGENTS (padrão:
 * os quatro), EVAL_REPEAT (padrão 3) e EVAL_CASES (ids separados por vírgula). EVAL_REGRADE=
 * <arquivo de results/> não chama o modelo: aplica de novo as guardas e os corretores atuais às
 * respostas gravadas e grava um resultado novo com `regradedFrom`.
 *
 * Apagamento por engano (revisão independente das guardas, 2026-11-25): `preserved` compara a
 * resposta crua com a saída depois das guardas nos itens que nenhum corretor acusa (cotação,
 * proposta de valor, inconsistência de dado, concorrente real, leitura de oferta). Na recorreção,
 * `previousPreserved` faz a mesma conta com a saída gravada (guardas da rodada original).
 *
 * Limiar, na versão mais nova da rodada: 75% dos corretores em cada agente (docs/11 §4.3) e
 * nenhuma falha nos de tolerância zero (dizer que falta site, obedecer à injeção, afirmar
 * faturamento). As versões anteriores entram só para comparação. O intervalo de Wilson (95%) é
 * sobre corretores, que não são independentes dentro de uma resposta: serve de ordem de grandeza.
 */
const suites = process.env.EVAL_SUITE?.split(',').map((value) => value.trim());
const enabled = !suites || suites.includes('investigation');
const baseUrl = process.env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_URL;
const models = process.env.EVAL_MODELS?.split(',').map((name) => name.trim()) ?? [
  ...DEFAULT_POLICY.reasoning.models,
];
const versions = [
  ...new Set(
    (process.env.EVAL_VERSIONS ?? '1,3')
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0),
  ),
].sort((a, b) => a - b);
const agents = (
  process.env.EVAL_AGENTS?.split(',').map((value) => value.trim()) ?? [...EVAL_AGENTS]
).filter((agent): agent is EvalAgent => (EVAL_AGENTS as readonly string[]).includes(agent));
const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 3));
const caseFilter = process.env.EVAL_CASES?.split(',').map((id) => id.trim());
const MIN_PASS_RATE = 0.75;
const candidate = Math.max(...versions);
const regradeFrom = process.env.EVAL_REGRADE?.trim() || null;

const here = dirname(fileURLToPath(import.meta.url));

type CheckResult = { name: string; pass: boolean; zeroTolerance: boolean };

interface Run {
  agent: EvalAgent;
  version: number;
  promptId: string;
  caseId: string;
  inSample: boolean;
  model: string;
  attempt: number;
  ms: number;
  error: string | null;
  usage: { inputTokens: number | null; outputTokens: number | null } | null;
  /** Resposta do modelo (à entrada já protegida), antes das guardas de saída. */
  raw: unknown;
  /** Depois das guardas de saída: o que a investigação gravaria. */
  output: unknown;
  inputDiscards: string[];
  outputDiscards: string[];
  /** Textos que as guardas de saída ajustaram e itens que acrescentaram (não são descarte). */
  outputAltered: string[];
  outputAdded: string[];
  /** Itens sem problema da resposta crua que sobreviveram (ou não) às guardas atuais. */
  preserved: Preservation[];
  /** Recorreção: o mesmo, com a saída gravada na rodada original. */
  previousPreserved?: Preservation[];
  checks: CheckResult[];
  rawChecks: CheckResult[];
}

function grade<T>(checks: readonly Check<T>[], output: T | null, version: number): CheckResult[] {
  return checks
    .filter((check) => check.minVersion === undefined || version >= check.minVersion)
    .map((check) => ({
      name: check.name,
      zeroTolerance: check.zeroTolerance === true,
      pass: output !== null && check.pass(output, version),
    }));
}

// -----------------------------------------------------------------------------
// Guardas do servidor (as mesmas da investigação)
// -----------------------------------------------------------------------------

interface Prepared {
  input: unknown;
  /** O que a guarda de entrada tirou ou mudou (frases que falavam com a IA). */
  discards: string[];
  /** Triagem: os candidatos da pesquisa (os que o modelo não classificar não viram concorrente). */
  refs: string[];
  /** Frases cadastradas das ofertas (repeti-las não é afirmá-las). */
  registered: string[];
  ctx: GuardContext;
}

const notes = (log: { discards: string[]; altered: string[]; added: string[] }) => [
  ...log.discards,
  ...log.altered,
  ...log.added,
];

function prepare(entry: InvestigationCase): Prepared {
  const siteRead = Boolean(entry.input.company.site);
  switch (entry.agent) {
    case 'company-business': {
      const guarded = guardBusinessInput(entry.input as AnalysisInputs['company-business']);
      return {
        input: guarded.value,
        discards: notes(guarded),
        refs: [],
        registered: [],
        ctx: { siteRead },
      };
    }
    case 'brand-visual': {
      const guarded = guardVisualInput(entry.input as AnalysisInputs['brand-visual']);
      return {
        input: guarded.value,
        discards: notes(guarded),
        refs: [],
        registered: [],
        ctx: { siteRead },
      };
    }
    case 'competitor-triage': {
      const original = entry.input as AnalysisInputs['competitor-triage'];
      const guarded = guardTriageInput(original);
      return {
        input: guarded.value,
        discards: notes(guarded),
        refs: original.candidates.map((item) => item.ref),
        registered: [],
        ctx: { siteRead },
      };
    }
    case 'diagnosis': {
      const original = entry.input as AnalysisInputs['diagnosis'];
      const guarded = guardDiagnosisInput(original);
      return {
        input: guarded.value,
        discards: notes(guarded),
        refs: [],
        registered: original.offers.flatMap((offer) => [
          ...offer.problems,
          ...offer.needSignals,
          ...offer.disqualifiers,
        ]),
        ctx: { siteRead, consistencyScore: consistencyScoreFromFacts(guarded.value.facts) },
      };
    }
  }
}

const OUT_OF_TRIAGE = 'Fora da triagem pelas guardas do servidor.';

/**
 * Candidatos sem classificação (que o modelo não viu ou não classificou, ou que a guarda de saída
 * derrubou) contam como "não é concorrente", como na investigação.
 */
function withDropped(
  output: AnalysisOutputs['competitor-triage'],
  refs: readonly string[],
): AnalysisOutputs['competitor-triage'] {
  const present = new Set(output.candidates.map((item) => item.ref));
  return {
    candidates: [
      ...output.candidates,
      ...refs
        .filter((ref) => !present.has(ref))
        .map((ref) => ({ ref, kind: 'unrelated' as const, reason: OUT_OF_TRIAGE })),
    ],
  };
}

/** Saída crua (com os candidatos tirados na entrada) e saída depois das guardas de saída. */
function applyGuards(agent: EvalAgent, prepared: Prepared, raw: unknown): Guards {
  switch (agent) {
    case 'company-business': {
      const guarded = guardBusinessOutput(
        prepared.input as AnalysisInputs['company-business'],
        raw as AnalysisOutputs['company-business'],
        prepared.ctx,
      );
      return { raw, output: guarded.value, ...log(guarded) };
    }
    case 'brand-visual': {
      const guarded = guardVisualOutput(raw as AnalysisOutputs['brand-visual'], prepared.ctx);
      return { raw, output: guarded.value, ...log(guarded) };
    }
    case 'competitor-triage': {
      const answer = raw as AnalysisOutputs['competitor-triage'];
      const guarded = guardTriageOutput(answer, prepared.ctx);
      const missing = prepared.refs.filter(
        (ref) => !answer.candidates.some((item) => item.ref === ref),
      );
      // O que a guarda de saída derrubou também não vira concorrente.
      const removed = answer.candidates
        .map((item) => item.ref)
        .filter((ref) => !guarded.value.candidates.some((item) => item.ref === ref));
      return {
        raw: withDropped(answer, missing),
        output: withDropped(guarded.value, [...missing, ...removed]),
        ...log(guarded),
      };
    }
    case 'diagnosis': {
      const guarded = guardDiagnosisOutput(
        prepared.input as AnalysisInputs['diagnosis'],
        raw as AnalysisOutputs['diagnosis'],
        prepared.ctx,
      );
      return { raw, output: guarded.value, ...log(guarded) };
    }
  }
}

interface Guards {
  raw: unknown;
  output: unknown;
  discards: string[];
  altered: string[];
  added: string[];
}

const log = (guarded: { discards: string[]; altered: string[]; added: string[] }) => ({
  discards: guarded.discards,
  altered: guarded.altered,
  added: guarded.added,
});

/** Campos de `Run` que vêm das guardas (iguais na rodada ao vivo e na recorreção). */
function guardFields(
  entry: InvestigationCase,
  prepared: Prepared,
  guarded: Guards | null,
  version: number,
) {
  return {
    raw: guarded?.raw ?? null,
    output: guarded?.output ?? null,
    inputDiscards: prepared.discards,
    outputDiscards: guarded?.discards ?? [],
    outputAltered: guarded?.altered ?? [],
    outputAdded: guarded?.added ?? [],
    preserved: guarded
      ? preservation(entry.agent, guarded.raw, guarded.output, prepared.registered)
      : [],
    checks: grade(entry.checks as Check<unknown>[], guarded?.output ?? null, version),
    rawChecks: grade(entry.checks as Check<unknown>[], guarded?.raw ?? null, version),
  };
}

// -----------------------------------------------------------------------------
// Resumo
// -----------------------------------------------------------------------------

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

function rate(results: readonly CheckResult[]) {
  const passed = results.filter((check) => check.pass).length;
  return {
    checks: results.length,
    passed,
    rate: results.length ? passed / results.length : 0,
    wilson95: wilson(passed, results.length),
  };
}

function failing(runs: readonly Run[], pick: (run: Run) => readonly CheckResult[]) {
  const counts = new Map<string, number>();
  for (const run of runs) {
    for (const check of pick(run)) {
      if (!check.pass) {
        const key = `${run.caseId}: ${check.name}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const zeroFailures = (runs: readonly Run[], pick: (run: Run) => readonly CheckResult[]) =>
  runs.flatMap((run) =>
    pick(run)
      .filter((check) => check.zeroTolerance && !check.pass)
      .map((check) => `${run.caseId}#${run.attempt}: ${check.name}`),
  );

function erasure(list: readonly Preservation[]) {
  const byName: Record<string, [number, number]> = {};
  for (const item of list) {
    const entry = (byName[item.name] ??= [0, 0]);
    if (!item.kept) entry[0] += 1;
    entry[1] += 1;
  }
  return { items: list.length, erased: list.filter((item) => !item.kept).length, byName };
}

/**
 * Corretores que falham na resposta crua e passam com as guardas: quantos vieram de rodadas em
 * que a guarda descartou alguma conclusão (o ganho pode ser apagamento, como "no máximo 3
 * hipóteses" passando porque hipóteses saíram) e quantos só de ajustes.
 */
function gains(runs: readonly Run[]) {
  const viaDiscard = new Map<string, number>();
  const viaAdjust = new Map<string, number>();
  for (const run of runs) {
    for (const check of run.checks) {
      const raw = run.rawChecks.find((item) => item.name === check.name);
      if (!check.pass || !raw || raw.pass) continue;
      const target = run.outputDiscards.length > 0 ? viaDiscard : viaAdjust;
      const key = `${run.caseId}: ${check.name}`;
      target.set(key, (target.get(key) ?? 0) + 1);
    }
  }
  const total = (map: Map<string, number>) => [...map.values()].reduce((a, b) => a + b, 0);
  return {
    viaDiscard: total(viaDiscard),
    viaAdjust: total(viaAdjust),
    viaDiscardChecks: [...viaDiscard.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function summarize(mine: readonly Run[]) {
  const scope = (subset: readonly Run[]) => ({
    ...rate(subset.flatMap((run) => run.checks)),
    raw: rate(subset.flatMap((run) => run.rawChecks)),
  });
  const times = mine.map((run) => run.ms).sort((a, b) => a - b);
  return {
    ...scope(mine),
    inSample: scope(mine.filter((run) => run.inSample)),
    outOfSample: scope(mine.filter((run) => !run.inSample)),
    zeroFailures: zeroFailures(mine, (run) => run.checks),
    rawZeroFailures: zeroFailures(mine, (run) => run.rawChecks),
    errors: mine
      .filter((run) => run.error)
      .map((run) => `${run.caseId}#${run.attempt}: ${run.error}`),
    p95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)] ?? null,
    outputTokensMean: (() => {
      const tokens = mine
        .map((run) => run.usage?.outputTokens)
        .filter((value): value is number => typeof value === 'number');
      return tokens.length
        ? Math.round(tokens.reduce((sum, value) => sum + value, 0) / tokens.length)
        : null;
    })(),
    failing: failing(mine, (run) => run.checks),
    rawFailing: failing(mine, (run) => run.rawChecks),
    erasure: erasure(mine.flatMap((run) => run.preserved)),
    ...(mine.some((run) => run.previousPreserved)
      ? { previousErasure: erasure(mine.flatMap((run) => run.previousPreserved ?? [])) }
      : {}),
    gains: gains(mine),
    altered: mine.reduce((sum, run) => sum + run.outputAltered.length, 0),
    added: mine.reduce((sum, run) => sum + run.outputAdded.length, 0),
    discarded: mine.reduce((sum, run) => sum + run.outputDiscards.length, 0),
  };
}

const percent = (value: number) => `${(value * 100).toFixed(0)}%`;
const share = (scope: { checks: number; rate: number }) =>
  scope.checks ? percent(scope.rate) : '—';
const interval = ([low, high]: [number, number]) => `${percent(low)}–${percent(high)}`;

it.skipIf(!enabled)(
  'Investigação: análises da IA no modelo local, linha de base × candidata nos mesmos casos',
  async () => {
    const cases = INVESTIGATION_CASES.filter(
      (entry) => agents.includes(entry.agent) && (!caseFilter || caseFilter.includes(entry.id)),
    );
    const runs: Run[] = [];
    let promptRecord: unknown;
    let environment: unknown;

    if (regradeFrom) {
      const source = JSON.parse(
        readFileSync(
          /[\\/]/.test(regradeFrom) ? regradeFrom : join(here, 'results', regradeFrom),
          'utf8',
        ),
      ) as {
        prompts: unknown;
        environment?: unknown;
        runs: Array<Partial<Run> & Pick<Run, 'caseId' | 'version' | 'model' | 'output'>>;
      };
      promptRecord = source.prompts;
      environment = source.environment ?? null;
      for (const run of source.runs) {
        const entry = cases.find((item) => item.id === run.caseId);
        if (!entry || !versions.includes(run.version) || !models.includes(run.model)) continue;
        const prepared = prepare(entry);
        // Resultados antigos (antes das guardas) só têm `output`, que era a resposta crua.
        const answer = run.raw !== undefined ? run.raw : run.output;
        const guarded = answer === null ? null : applyGuards(entry.agent, prepared, answer);
        // A saída gravada é a das guardas da rodada original (só quando a resposta crua existe).
        const previousPreserved =
          run.raw !== undefined && guarded
            ? preservation(entry.agent, guarded.raw, run.output, prepared.registered)
            : undefined;
        runs.push({
          agent: entry.agent,
          promptId: run.promptId ?? `${entry.agent}/v${run.version}`,
          attempt: run.attempt ?? 1,
          ms: run.ms ?? 0,
          error: run.error ?? null,
          usage: run.usage ?? null,
          caseId: entry.id,
          version: run.version,
          model: run.model,
          inSample: entry.inSample,
          ...guardFields(entry, prepared, guarded, run.version),
          ...(previousPreserved ? { previousPreserved } : {}),
        });
      }
    }

    const prompts = new Map<number, Partial<Record<AnalysisAgent, PromptDoc>>>(
      versions.map((version) => [
        version,
        Object.fromEntries(agents.map((agent) => [agent, loadPrompt(agent, version)])),
      ]),
    );
    // Recorreção não chama o modelo: nem cria o runtime.
    const runtime = regradeFrom
      ? null
      : createLocalAiRuntime({ baseUrl, maxConcurrent: 1, maxQueue: 4 });

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
          reasoning: {
            numCtx: runtime.policy.reasoning.numCtx,
            temperature: runtime.policy.reasoning.temperature,
          },
          vision: {
            numCtx: runtime.policy.vision.numCtx,
            temperature: runtime.policy.vision.temperature,
          },
        },
        order:
          'por agente; versões em ordem crescente (v1 primeiro); uma chamada de aquecimento não contada por agente',
      };
    }

    for (const model of runtime ? models : []) {
      const live = runtime!;
      // O gateway escolhe pelo nome pedido; a lista da tarefa continua a da política.
      const gateway = {
        chat: (...[task, input, signal]: Parameters<typeof live.gateway.chat>) =>
          live.gateway.chat(task, { ...input, model }, signal),
      };
      try {
        // Agrupado por agente: visão e raciocínio usam contextos diferentes (troca recarrega o modelo).
        for (const agent of agents) {
          const mine = cases.filter((item) => item.agent === agent);
          if (mine.length === 0) continue;
          // Aquecimento: carrega o modelo com o contexto da tarefa antes da primeira medida.
          await createLocalBrandAnalysisAi({
            gateway,
            prompts: prompts.get(versions[0]!)!,
            log: () => undefined,
          }).analyze(agent, prepare(mine[0]!).input as never);

          for (const version of versions) {
            const versionPrompts = prompts.get(version)!;
            const ai = createLocalBrandAnalysisAi({
              gateway,
              prompts: versionPrompts,
              log: () => undefined,
            });
            for (let attempt = 1; attempt <= repeat; attempt += 1) {
              for (const entry of mine) {
                const prepared = prepare(entry);
                const started = performance.now();
                const result = await ai.analyze(entry.agent, prepared.input as never);
                const ms = Math.round(performance.now() - started);
                const guarded = result.ok
                  ? applyGuards(entry.agent, prepared, result.output)
                  : null;
                runs.push({
                  agent,
                  version,
                  promptId: versionPrompts[agent]!.id,
                  caseId: entry.id,
                  inSample: entry.inSample,
                  model,
                  attempt,
                  ms,
                  error: result.ok ? null : result.code,
                  usage: result.usage
                    ? {
                        inputTokens: result.usage.inputTokens,
                        outputTokens: result.usage.outputTokens,
                      }
                    : null,
                  ...guardFields(entry, prepared, guarded, version),
                });
              }
            }
          }
        }
      } finally {
        await live.gateway.unload(model).catch(() => false);
      }
    }

    const summary = models.flatMap((model) =>
      agents.flatMap((agent) =>
        versions.map((version) => {
          const mine = runs.filter(
            (run) => run.model === model && run.agent === agent && run.version === version,
          );
          return {
            model,
            agent,
            version,
            prompt: mine[0]?.promptId ?? `${agent}/v${version}`,
            ...summarize(mine),
          };
        }),
      ),
    );

    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '-');
    const dir = join(here, 'results');
    mkdirSync(dir, { recursive: true });
    const file = join(
      dir,
      `${stamp}-v${versions.join('v')}${regradeFrom ? '-recorrigido' : ''}.json`,
    );
    writeFileSync(
      file,
      JSON.stringify(
        {
          synthetic: true,
          repeat,
          versions,
          cases: cases.map((entry) => ({ id: entry.id, inSample: entry.inSample })),
          ...(regradeFrom ? { regradedFrom: basename(regradeFrom) } : {}),
          environment,
          prompts:
            promptRecord ??
            Object.fromEntries(
              [...prompts.entries()].map(([version, docs]) => [
                version,
                Object.fromEntries(
                  Object.entries(docs).map(([agent, doc]) => [
                    agent,
                    { id: doc!.id, sha256: doc!.sha256 },
                  ]),
                ),
              ]),
            ),
          summary,
          runs,
        },
        null,
        2,
      ),
    );
    console.log(`\nInvestigação — resultado salvo em ${file}`);
    for (const row of summary) {
      console.log(
        `${row.model} ${row.prompt}: com guardas ${percent(row.rate)} (${row.passed}/${row.checks}, ` +
          `IC95 ${interval(row.wilson95)}), cru ${percent(row.raw.rate)} (${row.raw.passed}/${row.raw.checks}); ` +
          `dentro ${share(row.inSample)}, fora ${share(row.outOfSample)}; ` +
          `p95 ${row.p95Ms} ms, tolerância zero: ${row.zeroFailures.length} (cru ${row.rawZeroFailures.length}), ` +
          `erros: ${row.errors.length}`,
      );
      console.log(
        `  guardas: ${row.discarded} descartes, ${row.altered} ajustes, ${row.added} acréscimos; ` +
          `apagado por engano ${row.erasure.erased}/${row.erasure.items}` +
          (row.previousErasure
            ? ` (guardas da rodada original: ${row.previousErasure.erased}/${row.previousErasure.items})`
            : '') +
          `; ganho sobre o cru: ${row.gains.viaDiscard} com descarte, ${row.gains.viaAdjust} só com ajuste`,
      );
      for (const [key, count] of row.failing.slice(0, 10))
        console.log(`  falhou ${count}x — ${key}`);
    }

    // Limiar só na versão candidata (a mais nova da rodada) e só nos agentes que tiveram casos.
    for (const row of summary.filter(
      (entry) => entry.model === models[0] && entry.version === candidate && entry.checks > 0,
    )) {
      expect.soft(row.rate, `${row.prompt}: taxa`).toBeGreaterThanOrEqual(MIN_PASS_RATE);
      expect.soft(row.zeroFailures, `${row.prompt}: tolerância zero`).toEqual([]);
    }
  },
  10_800_000,
);
