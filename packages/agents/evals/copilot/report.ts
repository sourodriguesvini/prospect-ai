import type { GenerationUsage } from '@prospector/contracts';
import type { EvalCase } from './cases';
import type { Grade } from './graders';

export interface Run {
  /** Versão do prompt (`copilot/vN`). Resultados antigos não têm: vale o `promptId` do arquivo. */
  promptId?: string;
  model: string;
  caseId: string;
  attempt: number;
  /** Raciocínio ligado nesta resposta (resultados antigos não têm: vale o caso). */
  think?: boolean;
  output: string;
  /** Ferramentas chamadas nesta resposta, na ordem (IA-2; ausente no modo sem ferramentas). */
  toolCalls?: string[];
  /** URLs que os resultados das ferramentas trouxeram (`EVAL_WEB=1`). */
  toolUrls?: string[];
  /** Algum resultado de ferramenta trazia uma instrução escondida (`EVAL_WEB=1`). */
  toolInstruction?: boolean;
  /** Módulos dados como disponíveis além dos da IA-1 (`EVAL_WEB=1`: Empresas, M2). */
  builtModules?: string[];
  error: string | null;
  firstTokenMs: number | null;
  usage: GenerationUsage | null;
  grades: Grade[];
  pass: boolean;
}

export interface ModelSummary {
  promptId: string | null;
  model: string;
  runs: number;
  passRate: number;
  /** Intervalo de Wilson de 95% da taxa de aprovação: com 18 respostas ele é largo. */
  passRate95: [number, number];
  medianTotalMs: number | null;
  p95TotalMs: number | null;
  /** p95 separado (KI-037): o raciocínio multiplica o tempo e distorce o p95 geral. */
  p95TotalMsNoThinking: number | null;
  p95TotalMsThinking: number | null;
  medianFirstTokenMs: number | null;
  medianTokensPerSecond: number | null;
  /** Respostas longas demoram mais: compare latência junto com o tamanho. */
  medianOutputTokens: number | null;
  /** Taxa de aprovação de cada corretor, para ver onde o modelo erra. */
  byCriterion: Record<string, { pass: number; total: number }>;
  /** Aprovação por caso, para comparar versões de prompt caso a caso. */
  byCase: Record<string, { pass: number; total: number }>;
  failures: string[];
}

/** Uma linha do resumo: um modelo com uma versão de prompt. */
export interface SummaryGroup {
  promptId: string | null;
  model: string;
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const a = sorted[low] ?? 0;
  const b = sorted[high] ?? a;
  return a + (b - a) * (rank - low);
}

/** Intervalo de Wilson (95%) para `pass` sucessos em `total` tentativas. */
export function wilson(pass: number, total: number): [number, number] {
  if (total === 0) return [0, 0];
  const z = 1.96;
  const p = pass / total;
  const denominator = 1 + (z * z) / total;
  const center = (p + (z * z) / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p)) / total + (z * z) / (4 * total * total))) / denominator;
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return [round(Math.max(0, center - margin)), round(Math.min(1, center + margin))];
}

/** Aplica os corretores atuais de cada caso a uma resposta gravada. */
export function gradeRun(run: Run, cases: readonly EvalCase[]): Run {
  const evalCase = cases.find((entry) => entry.id === run.caseId);
  run = { ...run, think: run.think ?? evalCase?.think ?? false };
  if (!evalCase || run.error) return { ...run, grades: [], pass: false };
  // Resposta vazia (ex.: o raciocínio gastou todo o limite) é falha própria, não de "português".
  if (run.output.trim() === '') {
    return { ...run, grades: [{ name: 'resposta não vazia', pass: false }], pass: false };
  }
  const context = {
    toolsCalled: run.toolCalls ?? [],
    toolUrls: run.toolUrls ?? [],
    toolInstruction: run.toolInstruction ?? false,
    builtModules: run.builtModules ?? [],
  };
  const grades = evalCase.graders.map((grade) => grade(run.output, context));
  return { ...run, grades, pass: grades.every((grade) => grade.pass) };
}

export function summarize(runs: readonly Run[], groups: readonly SummaryGroup[]): ModelSummary[] {
  return groups
    .map((group) => ({
      group,
      mine: runs.filter(
        (run) => run.model === group.model && (run.promptId ?? null) === group.promptId,
      ),
    }))
    .filter(({ mine }) => mine.length > 0)
    .map(({ group, mine }) => {
      const pick = (read: (run: Run) => number | null | undefined) =>
        mine.flatMap((run) => {
          const value = read(run);
          return value == null ? [] : [value];
        });
      const totals = pick((run) => run.usage?.totalMs);
      const totalsBy = (thinking: boolean) =>
        mine.flatMap((run) =>
          Boolean(run.think) === thinking && run.usage?.totalMs != null ? [run.usage.totalMs] : [],
        );
      const passed = mine.filter((run) => run.pass).length;
      const byCriterion: ModelSummary['byCriterion'] = {};
      for (const run of mine) {
        for (const grade of run.grades) {
          const entry = (byCriterion[grade.name] ??= { pass: 0, total: 0 });
          entry.total += 1;
          if (grade.pass) entry.pass += 1;
        }
      }
      const byCase: ModelSummary['byCase'] = {};
      for (const run of mine) {
        const entry = (byCase[run.caseId] ??= { pass: 0, total: 0 });
        entry.total += 1;
        if (run.pass) entry.pass += 1;
      }
      return {
        promptId: group.promptId,
        model: group.model,
        runs: mine.length,
        passRate: passed / mine.length,
        passRate95: wilson(passed, mine.length),
        medianTotalMs: percentile(totals, 50),
        p95TotalMs: percentile(totals, 95),
        p95TotalMsNoThinking: percentile(totalsBy(false), 95),
        p95TotalMsThinking: percentile(totalsBy(true), 95),
        medianFirstTokenMs: percentile(
          pick((run) => run.firstTokenMs),
          50,
        ),
        medianTokensPerSecond: percentile(
          pick((run) => run.usage?.outputTokensPerSecond),
          50,
        ),
        medianOutputTokens: percentile(
          pick((run) => run.usage?.outputTokens),
          50,
        ),
        byCriterion,
        byCase,
        failures: mine
          .filter((run) => !run.pass)
          .map(
            (run) =>
              `${run.caseId}#${run.attempt}: ${
                run.error ??
                run.grades
                  .filter((grade) => !grade.pass)
                  .map((grade) => (grade.detail ? `${grade.name} (${grade.detail})` : grade.name))
                  .join(', ')
              }`,
          ),
      };
    });
}

export function printSummary(file: string, summary: readonly ModelSummary[]): void {
  console.info(`[evals] ${file}`);
  for (const row of summary) {
    const [low, high] = row.passRate95.map((value) => Math.round(value * 100));
    console.info(
      `[evals] ${row.promptId ?? '?'} · ${row.model}: ${Math.round(row.passRate * 100)}% (${row.runs} respostas; IC95 ${low}–${high}%) · mediana ${Math.round(row.medianTotalMs ?? 0)} ms (p95 ${Math.round(row.p95TotalMs ?? 0)} ms; sem raciocínio ${Math.round(row.p95TotalMsNoThinking ?? 0)} ms, com ${Math.round(row.p95TotalMsThinking ?? 0)} ms), ${Math.round(row.medianOutputTokens ?? 0)} tokens de saída, ${Math.round(row.medianTokensPerSecond ?? 0)} tokens/s`,
    );
    for (const failure of row.failures) console.info(`[evals]   ✗ ${failure}`);
  }
}
