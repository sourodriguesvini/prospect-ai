import { safeFetch, type SafeFetchOptions } from './safe-http';

/**
 * robots.txt (RFC 9309). O grupo vale para o token `prospector` (sem diferenciar maiúsculas) ou,
 * na falta dele, para `*`. Regra mais longa vence; empate, `allow` vence; `*` e `$` são curingas.
 * Respostas: 2xx = regras; 4xx = sem restrições; 5xx, rede ou DNS = tudo proibido (o RFC manda
 * supor proibição quando o arquivo não pode ser lido). Cache por origem por até 24 h.
 */

export const ROBOTS_PRODUCT_TOKEN = 'prospector';
const ROBOTS_MAX_BYTES = 512 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

interface Rule {
  allow: boolean;
  pattern: string;
}

export interface RobotsPolicy {
  /** null = sem regras (pode tudo); 'disallow_all' = arquivo inacessível. */
  rules: Rule[] | null | 'disallow_all';
}

/** Regras do grupo que vale para o token informado. */
export function parseRobots(text: string, token = ROBOTS_PRODUCT_TOKEN): Rule[] {
  const groups: Array<{ agents: string[]; rules: Rule[] }> = [];
  let current: { agents: string[]; rules: Rule[] } | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r\n|\r|\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) continue;
    const field = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'allow' || field === 'disallow') {
      // `Disallow:` vazio não proíbe nada.
      if (value === '') continue;
      // `**` seguidos valem o mesmo que um `*` e só encareceriam a comparação.
      current.rules.push({ allow: field === 'allow', pattern: value.replace(/\*{2,}/g, '*') });
    }
  }
  const wanted = token.toLowerCase();
  const specific = groups.filter((group) =>
    group.agents.some((agent) => agent === wanted || agent.startsWith(`${wanted}/`)),
  );
  const chosen = specific.length > 0 ? specific : groups.filter((g) => g.agents.includes('*'));
  return chosen.flatMap((group) => group.rules);
}

/**
 * Limites contra robots.txt montado para travar o leitor (revisão de segurança 2026-11-10, A1).
 * Arquivo acima deles vale como "tudo proibido": o site não é lido, o que é o lado seguro.
 */
const MAX_RULES = 2000;
const MAX_PATTERN_CHARS = 512;
const MAX_TOTAL_PATTERN_CHARS = 32 * 1024;
/** Caminho maior que isto não é lido (não dá para comparar com custo previsível). */
const MAX_PATH_CHARS = 2048;

export function withinLimits(rules: readonly Rule[]): boolean {
  if (rules.length > MAX_RULES) return false;
  let total = 0;
  for (const rule of rules) {
    if (rule.pattern.length > MAX_PATTERN_CHARS) return false;
    total += rule.pattern.length;
  }
  return total <= MAX_TOTAL_PATTERN_CHARS;
}

/**
 * Compara o caminho com o padrão (`*` = qualquer sequência; `$` no fim = fim do caminho; sem `$`,
 * vale como prefixo). Sem regex: curinga com retorno só à última `*`, custo no máximo
 * tamanho do padrão × tamanho do caminho, limitados acima.
 */
export function matchesRule(pattern: string, path: string): boolean {
  const glob = pattern.endsWith('$') ? pattern.slice(0, -1) : `${pattern}*`;
  let p = 0;
  let t = 0;
  let star = -1;
  let mark = 0;
  while (t < path.length) {
    if (p < glob.length && glob[p] === '*') {
      star = p;
      p += 1;
      mark = t;
    } else if (p < glob.length && glob[p] === path[t]) {
      p += 1;
      t += 1;
    } else if (star !== -1) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else {
      return false;
    }
  }
  while (p < glob.length && glob[p] === '*') p += 1;
  return p === glob.length;
}

/** Caminho com a consulta, como o RFC compara (percent-encoding do próprio URL). */
export function robotsPath(url: URL): string {
  return `${url.pathname || '/'}${url.search}`;
}

export function isAllowed(rules: readonly Rule[], path: string): boolean {
  if (path === '/robots.txt') return true;
  if (path.length > MAX_PATH_CHARS) return false;
  let best: Rule | null = null;
  for (const rule of rules) {
    if (!matchesRule(rule.pattern, path)) continue;
    if (
      !best ||
      rule.pattern.length > best.pattern.length ||
      (rule.pattern.length === best.pattern.length && rule.allow && !best.allow)
    ) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

export interface RobotsCheckerOptions {
  fetchOptions: Omit<SafeFetchOptions, 'maxBytes' | 'beforeRedirect' | 'accept'>;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}

export interface RobotsChecker {
  /** `signal`: prazo de quem pediu; cancelado, lança (nada vai para o cache). */
  allowed(url: URL, signal?: AbortSignal): Promise<boolean>;
}

export function createRobotsChecker(options: RobotsCheckerOptions): RobotsChecker {
  const now = options.now ?? Date.now;
  const ttl = Math.min(options.ttlMs ?? DAY_MS, DAY_MS);
  const maxEntries = options.maxEntries ?? 200;
  const cache = new Map<string, { at: number; policy: RobotsPolicy }>();

  async function load(origin: string, signal?: AbortSignal): Promise<RobotsPolicy> {
    const result = await safeFetch(`${origin}/robots.txt`, {
      ...options.fetchOptions,
      ...(signal ? { signal } : {}),
      maxBytes: ROBOTS_MAX_BYTES,
      accept: 'text/plain,*/*;q=0.1',
    });
    if (!result.ok) return { rules: 'disallow_all' };
    const { status, body } = result.response;
    if (status >= 200 && status < 300) {
      const rules = parseRobots(new TextDecoder('utf-8').decode(body));
      return withinLimits(rules) ? { rules } : { rules: 'disallow_all' };
    }
    if (status >= 400 && status < 500) return { rules: null };
    return { rules: 'disallow_all' };
  }

  return {
    async allowed(url, signal) {
      const origin = url.origin;
      let entry = cache.get(origin);
      if (!entry || now() - entry.at >= ttl) {
        entry = { at: now(), policy: await load(origin, signal) };
        cache.delete(origin);
        cache.set(origin, entry);
        while (cache.size > maxEntries) {
          const oldest = cache.keys().next().value;
          if (oldest === undefined) break;
          cache.delete(oldest);
        }
      }
      const { rules } = entry.policy;
      if (rules === 'disallow_all') return false;
      if (rules === null) return true;
      return isAllowed(rules, robotsPath(url));
    },
  };
}
