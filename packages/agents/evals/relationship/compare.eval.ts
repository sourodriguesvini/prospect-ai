import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import {
  buildBlindReview,
  tallyBlindReview,
  type BlindAnswer,
  type BlindKeyEntry,
} from './blind-review';
import {
  naturalness,
  NATURALNESS_PATTERN_LABELS,
  summarizeNaturalness,
  type NaturalnessPatternId,
} from './naturalness';

/**
 * Comparação de duas rodadas já gravadas da avaliação do Relacionamento (proposta de 26/11,
 * Frente 2 — EXPERIMENTAL). Não chama modelo nem usa a GPU: lê dois arquivos de `results/`
 * (ex.: v3 e v4 do prompt, ou dois modelos), mede a naturalidade das mensagens, põe lado a lado
 * as taxas dos corretores de fato e fonte de cada rodada e monta a página de leitura às cegas.
 *
 * Variáveis: EVAL_SUITE=compare, EVAL_A e EVAL_B (arquivos em `results/` ou caminhos), EVAL_SEED
 * (ordem da página; padrão 1). Para apurar a leitura: EVAL_ANSWERS (o JSON baixado da página) e
 * EVAL_KEY (a chave gravada junto da página).
 */
const suites = process.env.EVAL_SUITE?.split(',').map((value) => value.trim());
const enabled = suites?.includes('compare') ?? false;
const here = dirname(fileURLToPath(import.meta.url));
const resultsDir = join(here, 'results');
const resolve = (path: string) => (isAbsolute(path) ? path : join(resultsDir, path));

interface SavedRun {
  agent: 'approach' | 'message';
  caseId: string;
  model: string;
  attempt: number;
  output: unknown;
  checks: Array<{ name: string; pass: boolean; zeroTolerance: boolean; informative?: boolean }>;
}

interface SavedResult {
  synthetic?: boolean;
  prompts?: unknown;
  summary?: Array<{
    model: string;
    approach?: { rate: number };
    message?: { rate: number };
    zeroFailures?: string[];
  }>;
  runs: SavedRun[];
}

/** Assunto e corpo da mensagem de uma resposta (a da abordagem fica em `message`). */
export function messageOf(run: SavedRun): { subject: string | null; body: string } | null {
  const output = run.output as Record<string, unknown> | null;
  if (!output || typeof output !== 'object') return null;
  const message = (run.agent === 'approach' ? output.message : output) as
    Record<string, unknown> | undefined;
  if (!message || typeof message.body !== 'string') return null;
  return {
    subject: typeof message.subject === 'string' ? message.subject : null,
    body: message.body,
  };
}

function load(path: string): SavedResult {
  return JSON.parse(readFileSync(resolve(path), 'utf8')) as SavedResult;
}

function label(path: string, result: SavedResult): string {
  const name = path.split(/[\\/]/).at(-1) ?? path;
  const models = [...new Set(result.runs.map((run) => run.model))].join(', ');
  return `${name} · ${models}`;
}

function table(rows: string[][]): string {
  const [head, ...body] = rows;
  if (!head) return '';
  return [
    `| ${head.join(' | ')} |`,
    `|${head.map(() => '---').join('|')}|`,
    ...body.map((row) => `| ${row.join(' | ')} |`),
  ].join('\n');
}

it.runIf(enabled && !process.env.EVAL_ANSWERS)(
  'compara duas rodadas gravadas: naturalidade, corretores e leitura às cegas',
  () => {
    const pathA = process.env.EVAL_A;
    const pathB = process.env.EVAL_B;
    if (!pathA || !pathB) throw new Error('Defina EVAL_A e EVAL_B (arquivos em results/).');
    const a = load(pathA);
    const b = load(pathB);
    const labelA = label(pathA, a);
    const labelB = label(pathB, b);

    const reports = (result: SavedResult) =>
      result.runs.flatMap((run) => {
        const message = messageOf(run);
        return message ? [naturalness(message.body)] : [];
      });
    const summaryA = summarizeNaturalness(reports(a));
    const summaryB = summarizeNaturalness(reports(b));

    const rates = (result: SavedResult) =>
      (result.summary ?? []).map(
        (entry) =>
          `${entry.model}: estratégia ${Math.round((entry.approach?.rate ?? 0) * 1000) / 10}%, mensagem ${Math.round((entry.message?.rate ?? 0) * 1000) / 10}%, ${entry.zeroFailures?.length ?? 0} falha(s) de tolerância zero`,
      );

    const patternIds = [
      ...new Set([...Object.keys(summaryA.patternRate), ...Object.keys(summaryB.patternRate)]),
    ] as NaturalnessPatternId[];
    const percent = (value: number | undefined) => `${Math.round((value ?? 0) * 1000) / 10}%`;
    const md = [
      `# Comparação de rodadas (EXPERIMENTAL, casos SINTÉTICOS)`,
      '',
      `- A: ${labelA}`,
      `- B: ${labelB}`,
      '',
      '## Corretores de fato e fonte (gravados em cada rodada)',
      '',
      ...rates(a).map((line) => `- A · ${line}`),
      ...rates(b).map((line) => `- B · ${line}`),
      '',
      'Uma versão só pode substituir a outra se não piorar estes números (docs/comunicacao-frente-2-experimental.md).',
      '',
      '## Naturalidade (heurística; não substitui a leitura humana)',
      '',
      table([
        ['Medida', 'A', 'B'],
        ['Mensagens', String(summaryA.messages), String(summaryB.messages)],
        ['Nota média (0–100)', String(summaryA.meanScore), String(summaryB.meanScore)],
        ['Mediana de palavras', String(summaryA.medianWords), String(summaryB.medianWords)],
        [
          'Termina com pergunta',
          percent(summaryA.endsWithQuestion),
          percent(summaryB.endsWithQuestion),
        ],
        ...patternIds.map((id) => [
          NATURALNESS_PATTERN_LABELS[id],
          percent(summaryA.patternRate[id]),
          percent(summaryB.patternRate[id]),
        ]),
      ]),
    ].join('\n');

    // Um par por caso e agente (primeira tentativa de cada lado).
    const first = (result: SavedResult) => {
      const map = new Map<string, SavedRun>();
      for (const run of result.runs) {
        const key = `${run.agent}:${run.caseId}`;
        if (!map.has(key) && messageOf(run)) map.set(key, run);
      }
      return map;
    };
    const firstA = first(a);
    const firstB = first(b);
    const pairs = [...firstA.entries()].flatMap(([key, runA]) => {
      const runB = firstB.get(key);
      const textA = messageOf(runA);
      const textB = runB ? messageOf(runB) : null;
      if (!textA || !textB) return [];
      return [
        {
          caseId: key,
          a: { label: 'A', ...textA },
          b: { label: 'B', ...textB },
        },
      ];
    });
    const seed = Number(process.env.EVAL_SEED ?? 1);
    const page = buildBlindReview(pairs, {
      seed,
      title: 'Leitura às cegas: mensagens do Relacionamento',
    });

    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    const base = join(resultsDir, `${stamp}-comparacao`);
    writeFileSync(`${base}.md`, `${md}\n`);
    writeFileSync(`${base}-leitura-as-cegas.html`, page.html);
    writeFileSync(
      `${base}-chave.json`,
      `${JSON.stringify({ synthetic: true, A: labelA, B: labelB, seed, key: page.key }, null, 2)}\n`,
    );
    console.log(md);
    console.log(`\nPágina: ${base}-leitura-as-cegas.html\nChave: ${base}-chave.json`);
    expect(pairs.length).toBeGreaterThan(0);
  },
);

it.runIf(enabled && Boolean(process.env.EVAL_ANSWERS))('apura a leitura às cegas', () => {
  const answersPath = process.env.EVAL_ANSWERS as string;
  const keyPath = process.env.EVAL_KEY;
  if (!keyPath) throw new Error('Defina EVAL_KEY (a chave gravada junto da página).');
  const { answers } = JSON.parse(readFileSync(resolve(answersPath), 'utf8')) as {
    answers: BlindAnswer[];
  };
  const saved = JSON.parse(readFileSync(resolve(keyPath), 'utf8')) as {
    A: string;
    B: string;
    key: BlindKeyEntry[];
  };
  const tally = tallyBlindReview(answers, saved.key);
  console.log(JSON.stringify({ A: saved.A, B: saved.B, ...tally }, null, 2));
  expect(tally.items).toBe(saved.key.length);
});
