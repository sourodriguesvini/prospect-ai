import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { part8ReviewItems } from './part8-cases';
import {
  buildQualityReview,
  qualityTallyMarkdown,
  tallyQualityReview,
  type QualityAnswer,
  type QualityReviewItem,
} from './quality-review';

/**
 * `pnpm review:quality`: grava a página de revisão humana dos casos da Parte 8 (sem GPU, sem
 * banco, sem internet). Com `EVAL_ANSWERS=<respostas.json>` e `EVAL_ITEMS=<itens.json>`, apura as
 * respostas baixadas da página e grava o relatório ao lado delas.
 */

const resultsDir = join(dirname(fileURLToPath(import.meta.url)), 'results');
const answersPath = process.env.EVAL_ANSWERS;

it.skipIf(Boolean(answersPath))('grava a página de revisão dos casos da Parte 8', () => {
  const items = part8ReviewItems();
  const html = buildQualityReview(items, {
    title: 'Revisão humana: análises dos casos da Parte 8 (sintéticos)',
  });
  mkdirSync(resultsDir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const base = join(resultsDir, `${stamp}-revisao-qualidade`);
  writeFileSync(`${base}.html`, html);
  writeFileSync(`${base}-itens.json`, `${JSON.stringify({ synthetic: true, items }, null, 2)}\n`);
  console.log(`Página: ${base}.html\nItens: ${base}-itens.json`);
  expect(items.length).toBeGreaterThan(0);
});

it.runIf(Boolean(answersPath))('apura as respostas da revisão humana', () => {
  const itemsPath = process.env.EVAL_ITEMS;
  if (!itemsPath)
    throw new Error('Defina EVAL_ITEMS (o arquivo -itens.json gravado com a página).');
  const { items } = JSON.parse(readFileSync(resolve(itemsPath), 'utf8')) as {
    items: QualityReviewItem[];
  };
  const { answers } = JSON.parse(readFileSync(resolve(answersPath as string), 'utf8')) as {
    answers: QualityAnswer[];
  };
  const tally = tallyQualityReview(items, answers);
  const md = qualityTallyMarkdown(tally);
  const out = resolve(answersPath as string).replace(/\.json$/, '') + '-apuracao.md';
  writeFileSync(out, `${md}\n`);
  console.log(md);
  console.log(`\nRelatório: ${out}`);
  expect(tally.items).toBe(items.length);
});
