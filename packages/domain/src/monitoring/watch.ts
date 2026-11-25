import {
  WATCH_CADENCE_DAYS,
  type Recommendation,
  type WatchCadence,
  type WatchItem,
  type WatchState,
} from '@prospector/contracts';

/**
 * Lista de acompanhamento implícita (D15, ADR-0017): a frequência vem da recomendação do último
 * diagnóstico. "Abordar agora" e "Preparar acesso" pedem olhar semanal; "Acompanhar", "Investigar
 * mais" e "Sem base suficiente", mensal; "Descartar por enquanto" sai da lista.
 */
const CADENCE_BY_RECOMMENDATION: Record<Recommendation, WatchCadence | null> = {
  pursue: 'weekly',
  prepare_access: 'weekly',
  monitor: 'monthly',
  investigate_more: 'monthly',
  insufficient_evidence: 'monthly',
  discard: null,
};

export function watchCadence(recommendation: Recommendation): WatchCadence | null {
  return CADENCE_BY_RECOMMENDATION[recommendation];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Prazo e estado de uma empresa acompanhada. Vence `cadence` dias depois da última investigação
 * concluída; `days` conta dias inteiros de atraso (vencida) ou até o prazo (em dia). Data
 * ilegível vira vencida: melhor pedir uma olhada a mais do que esconder a empresa.
 */
export function watchStatus(input: {
  lastInvestigatedAt: string;
  cadence: WatchCadence;
  running: boolean;
  now: Date;
}): { dueAt: string; state: WatchState; days: number } {
  const last = Date.parse(input.lastInvestigatedAt);
  const now = input.now.getTime();
  if (Number.isNaN(last)) {
    return { dueAt: input.now.toISOString(), state: input.running ? 'running' : 'due', days: 0 };
  }
  const due = last + WATCH_CADENCE_DAYS[input.cadence] * DAY_MS;
  const dueAt = new Date(due).toISOString();
  const overdue = now >= due;
  const days = overdue ? Math.floor((now - due) / DAY_MS) : Math.ceil((due - now) / DAY_MS);
  if (input.running) return { dueAt, state: 'running', days: overdue ? 0 : days };
  return { dueAt, state: overdue ? 'due' : 'upcoming', days };
}

const STATE_ORDER: Record<WatchState, number> = { due: 0, running: 1, upcoming: 2 };

/**
 * Ordem da lista: vencidas (mais atrasadas, depois maior prioridade), em andamento, em dia (prazo
 * mais próximo primeiro). Empate final pelo nome, para a ordem não pular entre leituras.
 */
export function compareWatchItems(
  a: Pick<WatchItem, 'state' | 'dueAt' | 'priority' | 'companyName'>,
  b: Pick<WatchItem, 'state' | 'dueAt' | 'priority' | 'companyName'>,
): number {
  const byState = STATE_ORDER[a.state] - STATE_ORDER[b.state];
  if (byState !== 0) return byState;
  const byDue = a.dueAt.localeCompare(b.dueAt);
  if (byDue !== 0) return byDue;
  const byPriority = (b.priority ?? -1) - (a.priority ?? -1);
  if (byPriority !== 0) return byPriority;
  return a.companyName.localeCompare(b.companyName, 'pt-BR');
}
