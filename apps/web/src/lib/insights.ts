import type { IntelligencePeriod, MonitoringFeedFilter, WatchItem } from '@prospector/contracts';

/**
 * Endereços e textos do Monitoramento e da Inteligência (ADR-0017). Os filtros vão na URL em
 * português; valor desconhecido volta ao padrão, nunca vira erro.
 */

export const MONITORING_PATH = '/monitoramento';
export const INTELLIGENCE_PATH = '/inteligencia';

const FEED_FILTER_PARAM: Record<MonitoringFeedFilter, string | null> = {
  all: null,
  companies: 'empresas',
  discovery: 'buscas',
};

export const FEED_FILTER_LABELS: Record<MonitoringFeedFilter, string> = {
  all: 'Tudo',
  companies: 'Empresas',
  discovery: 'Buscas recorrentes',
};

function single(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

export function feedFilterFrom(value: unknown): MonitoringFeedFilter {
  const raw = single(value);
  const found = (Object.keys(FEED_FILTER_PARAM) as MonitoringFeedFilter[]).find(
    (filter) => FEED_FILTER_PARAM[filter] !== null && FEED_FILTER_PARAM[filter] === raw,
  );
  return found ?? 'all';
}

export function feedFilterHref(filter: MonitoringFeedFilter): string {
  const param = FEED_FILTER_PARAM[filter];
  return param ? `${MONITORING_PATH}?origem=${param}` : MONITORING_PATH;
}

const PERIOD_PARAM: Record<IntelligencePeriod, string | null> = { month: null, all: 'total' };

export function periodFrom(value: unknown): IntelligencePeriod {
  return single(value) === PERIOD_PARAM.all ? 'all' : 'month';
}

export function periodHref(period: IntelligencePeriod): string {
  const param = PERIOD_PARAM[period];
  return param ? `${INTELLIGENCE_PATH}?periodo=${param}` : INTELLIGENCE_PATH;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Prazo de uma empresa da lista de acompanhamento, em palavras. */
export function watchDueText(item: Pick<WatchItem, 'state' | 'days'>): string {
  if (item.state === 'running') return 'Investigação em andamento';
  if (item.state === 'due') {
    return item.days === 0 ? 'Venceu hoje' : `Vencida há ${plural(item.days, 'dia', 'dias')}`;
  }
  return `Próxima em ${plural(item.days, 'dia', 'dias')}`;
}

const integer = new Intl.NumberFormat('pt-BR');

export function formatCount(value: number): string {
  return integer.format(value);
}

const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 0 });

/** Razão entre 0 e 1 em porcentagem; acima de zero e abaixo de 1%, "menos de 1%". */
export function formatShare(share: number): string {
  if (share > 0 && share < 0.005) return 'menos de 1%';
  return percent.format(share);
}

const usdAmount = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/**
 * Micro-dólares (convenção do banco) em dólares, só o número ("0,00"; acima de zero e abaixo de um
 * centavo, "< 0,01"). O "US$" vai à parte, em letra menor (`UsdValue`).
 */
export function formatUsdAmount(micros: number): string {
  const dollars = Math.max(0, micros) / 1_000_000;
  if (dollars > 0 && dollars < 0.005) return `< ${usdAmount.format(0.01)}`;
  return usdAmount.format(dollars);
}

/** Tempo somado das gerações: "2 h 05 min", "12 min", "45 s". */
export function formatDuration(ms: number): string {
  const seconds = Math.round(Math.max(0, ms) / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}
