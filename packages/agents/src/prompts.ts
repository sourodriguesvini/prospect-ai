import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface PromptDoc {
  /** `<agente>/v<N>`, gravado em cada resposta para rastrear qual versão falou. */
  id: string;
  text: string;
  /** sha256 do texto: muda se alguém editar uma versão já usada (proibido, ver skill capacidade-ia). */
  sha256: string;
}

const PROMPTS_DIR = join('packages', 'agents', 'prompts');

/**
 * Pasta dos prompts versionados. O app roda só a partir do repositório (ADR-0007), então
 * procuramos a raiz do monorepo subindo a partir do diretório atual (apps/web no Next, o
 * pacote nos testes) em vez de depender de como o bundler trata arquivos .md.
 */
export function findPromptsDir(start: string = process.cwd()): string {
  let dir = start;
  for (;;) {
    const candidate = join(dir, PROMPTS_DIR);
    if (existsSync(join(dir, 'pnpm-workspace.yaml')) && existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Pasta ${PROMPTS_DIR} não encontrada a partir de ${start}.`);
}

const cache = new Map<string, PromptDoc>();

/** Lê `packages/agents/prompts/<agente>/v<N>.md` (uma vez por processo). */
export function loadPrompt(agent: string, version: number, dir?: string): PromptDoc {
  if (!/^[a-z][a-z0-9_-]*$/.test(agent) || !Number.isInteger(version) || version < 1) {
    throw new Error('Prompt inválido.');
  }
  const id = `${agent}/v${version}`;
  const hit = cache.get(id);
  if (hit && !dir) return hit;
  const text = readFileSync(join(dir ?? findPromptsDir(), agent, `v${version}.md`), 'utf8')
    .replace(/\r\n/g, '\n')
    .trim();
  const doc = { id, text, sha256: createHash('sha256').update(text).digest('hex') };
  if (!dir) cache.set(id, doc);
  return doc;
}
