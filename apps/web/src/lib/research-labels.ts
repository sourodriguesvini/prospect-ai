import {
  RESEARCH_DISCARD_LABELS,
  ResearchDiscardReason,
  type CopilotResearch,
  type ResearchItemView,
  type ResearchQuery,
} from '@prospector/contracts';

/** Telas da pesquisa extensa do Copiloto. */
export const researchRoutes = {
  list: '/copiloto/pesquisas',
  detail: (id: string) => `/copiloto/pesquisas/${encodeURIComponent(id)}`,
  csv: (id: string) => `/api/copiloto/pesquisas/${encodeURIComponent(id)}/csv`,
  conversation: (threadId: string) => `/copiloto?conversa=${encodeURIComponent(threadId)}`,
};

/** Avisos depois de uma ação na tela da pesquisa (`?aviso=`); só valores conhecidos viram texto. */
export const RESEARCH_NOTICE_MESSAGES = {
  cancelada: 'Pesquisa cancelada. O que foi achado continua abaixo.',
  retomada: 'Pesquisa retomada de onde parou.',
  'opt-out':
    'Opt-out registrado. A pessoa não entra mais em pesquisas e o contato dela foi apagado daqui.',
} as const;
export type ResearchNotice = keyof typeof RESEARCH_NOTICE_MESSAGES;

export function researchNoticeHref(id: string, notice: ResearchNotice): string {
  return `${researchRoutes.detail(id)}?aviso=${notice}`;
}

export function readResearchNotice(value: string | string[] | undefined): string | null {
  const key = Array.isArray(value) ? value[0] : value;
  return key && Object.hasOwn(RESEARCH_NOTICE_MESSAGES, key)
    ? RESEARCH_NOTICE_MESSAGES[key as ResearchNotice]
    : null;
}

/** Motivos de descarte guardados em `progress.discarded`, como a tela os mostra. */
export function discardSummary(discarded: Record<string, number>): string | null {
  const parts = Object.entries(discarded)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => {
      const known = ResearchDiscardReason.safeParse(reason);
      return `${count} ${known.success ? RESEARCH_DISCARD_LABELS[known.data] : reason}`;
    });
  return parts.length > 0 ? parts.join(' · ') : null;
}

export function researchTitle(
  research: Pick<CopilotResearch, 'requestedCount' | 'audience'>,
): string {
  return `${research.requestedCount} ${research.audience}`;
}

export function regionSummary(research: CopilotResearch): string {
  const { ufs, cities, priorityUfs } = research.criteria;
  const base =
    cities.length > 0
      ? cities.join(', ')
      : ufs.length > 0
        ? ufs.join(', ')
        : 'Brasil inteiro (estados mais populosos primeiro)';
  return priorityUfs.length > 0 ? `${base}; prioridade: ${priorityUfs.join(', ')}` : base;
}

export function queryPlace(query: Pick<ResearchQuery, 'city' | 'uf'>): string {
  if (query.city && query.uf) return `${query.city}/${query.uf}`;
  return query.city ?? query.uf ?? '—';
}

export function itemPlace(item: Pick<ResearchItemView, 'city' | 'uf'>): string | null {
  if (item.city && item.uf) return `${item.city}/${item.uf}`;
  return item.city ?? item.uf ?? null;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
