#!/usr/bin/env node
/**
 * Verifica as fronteiras do ADR-0001 que o ESLint não cobre:
 *  1. dependências declaradas entre pacotes do workspace (package.json);
 *  2. dependências externas proibidas em pacotes puros;
 *  3. imports relativos que escapam da pasta do pacote (atalho para burlar as regras acima);
 *  4. `@prospector/db` e `@prospector/agents` na web só na raiz de composição;
 *  5. nenhum `@supabase/*` na web (nem no package.json nem em imports): o Supabase fica dentro
 *     de @prospector/db (ADR-0007);
 *  6. credenciais do banco (`process.env.SUPABASE_*`) só são lidas em src/server/env.ts, e a web não usa
 *     variáveis `NEXT_PUBLIC_*` (nada do servidor vai para o navegador).
 *  7. chamadas a modelos locais (API do Ollama, porta 11434) só em packages/agents (ADR-0008).
 * Sai com código 1 e lista as violações.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Dependências internas permitidas (direção única). `@prospector/config` é livre (só tsconfig). */
const ALLOWED_INTERNAL = {
  '@prospector/contracts': [],
  '@prospector/domain': ['@prospector/contracts'],
  '@prospector/application': ['@prospector/domain', '@prospector/contracts'],
  '@prospector/db': ['@prospector/application', '@prospector/contracts'],
  '@prospector/agents': ['@prospector/application', '@prospector/contracts'],
  '@prospector/ui': [],
  '@prospector/config': [],
  '@prospector/web': [
    '@prospector/application',
    '@prospector/contracts',
    '@prospector/domain',
    '@prospector/ui',
    '@prospector/db',
    '@prospector/agents',
  ],
};

/** Dependências externas de runtime permitidas em pacotes que precisam ficar puros. */
const ALLOWED_EXTERNAL = {
  '@prospector/contracts': ['zod'],
  '@prospector/domain': [],
  '@prospector/application': ['zod'],
  // IA local sem SDK (ADR-0008): fala com o Ollama por `fetch`. SDK de IA novo passa por aqui.
  '@prospector/agents': ['zod'],
};

const WEB_SRC = join('apps', 'web', 'src');
const COMPOSITION_ROOT = join(WEB_SRC, 'server', 'container.ts');
const SECRET_READER = join(WEB_SRC, 'server', 'env.ts');
const AGENTS_DIR = join('packages', 'agents');
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;

const violations = [];

function workspaceDirs() {
  return ['apps', 'packages'].flatMap((group) =>
    readdirSync(join(root, group))
      .map((name) => join(root, group, name))
      .filter((dir) => {
        try {
          return statSync(join(dir, 'package.json')).isFile();
        } catch {
          return false;
        }
      }),
  );
}

function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.turbo', 'dist'].includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|mts|mjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

for (const dir of workspaceDirs()) {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const name = pkg.name;
  const rel = relative(root, dir);
  const allowedInternal = ALLOWED_INTERNAL[name];
  if (!allowedInternal) {
    violations.push(
      `${rel}: pacote ${name} não está mapeado em scripts/check-boundaries.mjs (adicione e registre no ADR-0001).`,
    );
    continue;
  }

  const runtimeDeps = Object.keys(pkg.dependencies ?? {});
  const allDeps = [
    ...runtimeDeps,
    ...Object.keys(pkg.devDependencies ?? {}),
    ...Object.keys(pkg.peerDependencies ?? {}),
  ];
  for (const dep of allDeps) {
    if (
      dep.startsWith('@prospector/') &&
      dep !== '@prospector/config' &&
      !allowedInternal.includes(dep)
    ) {
      violations.push(`${rel}/package.json: ${name} não pode depender de ${dep} (ADR-0001).`);
    }
  }
  if (name === '@prospector/web') {
    for (const dep of allDeps.filter((d) => d.startsWith('@supabase/'))) {
      violations.push(`${rel}/package.json: a web não depende de ${dep}; use @prospector/db.`);
    }
  }
  const allowedExternal = ALLOWED_EXTERNAL[name];
  if (allowedExternal) {
    for (const dep of runtimeDeps) {
      if (!dep.startsWith('@prospector/') && !allowedExternal.includes(dep)) {
        violations.push(
          `${rel}/package.json: ${name} deve ficar puro; dependência externa ${dep} não permitida.`,
        );
      }
    }
  }

  for (const file of sourceFiles(dir)) {
    const text = readFileSync(file, 'utf8');
    const fileRel = relative(root, file);
    if (name === '@prospector/web' && fileRel.startsWith(WEB_SRC + sep)) {
      // Leitura de credenciais (process.env.SUPABASE_* ou acesso dinâmico) só no leitor central.
      if (/process\.env(?:\.SUPABASE_|\[)/.test(text) && fileRel !== SECRET_READER) {
        violations.push(`${fileRel}: credenciais do banco só são lidas em ${SECRET_READER}.`);
      }
      if (/NEXT_PUBLIC_[A-Z0-9_]+/.test(text)) {
        violations.push(`${fileRel}: sem variáveis NEXT_PUBLIC_* na web (ADR-0007).`);
      }
    }
    if (/:11434\b/.test(text) && !fileRel.startsWith(AGENTS_DIR + sep)) {
      violations.push(`${fileRel}: a API do Ollama só é chamada pelo gateway em ${AGENTS_DIR}.`);
    }
    for (const match of text.matchAll(IMPORT_RE)) {
      const spec = match[1] ?? match[2] ?? match[3];
      if (!spec) continue;
      if (spec.startsWith('.')) {
        const target = resolve(dirname(file), spec);
        if (target !== dir && !target.startsWith(dir + sep)) {
          violations.push(
            `${fileRel}: import relativo "${spec}" sai do pacote ${name}; use o nome do pacote.`,
          );
        }
      }
      if (
        name === '@prospector/web' &&
        /^@prospector\/(db|agents)(\/|$)/.test(spec) &&
        fileRel !== COMPOSITION_ROOT
      ) {
        violations.push(`${fileRel}: ${spec} só pode ser importado em ${COMPOSITION_ROOT}.`);
      }
      if (
        name === '@prospector/web' &&
        spec === '@prospector/application/memory' &&
        fileRel !== COMPOSITION_ROOT
      ) {
        violations.push(
          `${fileRel}: os adaptadores em memória só podem ser importados em ${COMPOSITION_ROOT} (ADR-0009).`,
        );
      }
      if (name === '@prospector/web' && spec.startsWith('@supabase/')) {
        violations.push(`${fileRel}: Supabase não entra na web; use os serviços de application.`);
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Fronteiras violadas (${violations.length}):\n- ${violations.join('\n- ')}`);
  process.exit(1);
}
console.warn('Fronteiras OK.');
