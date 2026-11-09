#!/usr/bin/env node
/**
 * Verifica as fronteiras do ADR-0001 que o ESLint não cobre:
 *  1. dependências declaradas entre pacotes do workspace (package.json);
 *  2. dependências externas proibidas em pacotes puros;
 *  3. imports relativos que escapam da pasta do pacote (atalho para burlar as regras acima);
 *  4. `@prospector/db` na web só na raiz de composição;
 *  5. Supabase na web (`@supabase/*` e o cliente em src/server/supabase.ts, por alias ou caminho
 *     relativo) só na fachada de sessão/autenticação, na raiz de composição e no proxy.
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
  '@prospector/ui': [],
  '@prospector/config': [],
  '@prospector/web': [
    '@prospector/application',
    '@prospector/contracts',
    '@prospector/domain',
    '@prospector/ui',
    '@prospector/db',
  ],
};

/** Dependências externas de runtime permitidas em pacotes que precisam ficar puros. */
const ALLOWED_EXTERNAL = {
  '@prospector/contracts': ['zod'],
  '@prospector/domain': [],
  '@prospector/application': ['zod'],
};

const WEB_SRC = join('apps', 'web', 'src');
const COMPOSITION_ROOT = join(WEB_SRC, 'server', 'container.ts');
const SUPABASE_CLIENT = join(root, WEB_SRC, 'server', 'supabase');
const SUPABASE_GATEWAY = [
  join(WEB_SRC, 'server', 'supabase.ts'),
  join(WEB_SRC, 'server', 'auth.ts'),
  join(WEB_SRC, 'server', 'session.ts'),
  join(WEB_SRC, 'proxy.ts'),
  COMPOSITION_ROOT,
];
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
        spec.startsWith('@prospector/db') &&
        fileRel !== COMPOSITION_ROOT
      ) {
        violations.push(`${fileRel}: @prospector/db só pode ser importado em ${COMPOSITION_ROOT}.`);
      }
      if (
        name === '@prospector/web' &&
        fileRel.startsWith(WEB_SRC + sep) &&
        !SUPABASE_GATEWAY.includes(fileRel)
      ) {
        const target = spec.startsWith('.') ? resolve(dirname(file), spec) : null;
        const isClient =
          spec === '@/server/supabase' ||
          target === SUPABASE_CLIENT ||
          target === `${SUPABASE_CLIENT}.ts`;
        if (spec.startsWith('@supabase/') || isClient) {
          violations.push(
            `${fileRel}: Supabase na web só em src/server/{supabase,auth,session,container}.ts e src/proxy.ts; use os serviços de application ou a fachada src/server/auth.ts.`,
          );
        }
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`Fronteiras violadas (${violations.length}):\n- ${violations.join('\n- ')}`);
  process.exit(1);
}
console.warn('Fronteiras OK.');
