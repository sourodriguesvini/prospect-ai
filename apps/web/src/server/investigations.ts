import 'server-only';
import type { InvestigationService, RequestContext } from '@prospector/application';
import {
  ACTIVE_INVESTIGATION_STATUSES,
  type CompanyInvestigationSummary,
  type Investigation,
} from '@prospector/contracts';
import type { FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { runServiceAction, type CompanyOutcome } from './companies';
import { getServices } from './container';
import { userContext } from './context';

/**
 * Investigação de empresas nas telas (ADR-0015). Leituras que falham não derrubam o dossiê nem a
 * lista: a investigação é uma parte da página, e o resto continua útil sem ela.
 */

/** Só o tipo do erro: a mensagem pode trazer dado da empresa ou detalhe do banco. */
function errorName(error: unknown): string {
  if (error instanceof Error) {
    const reason = (error as { reason?: unknown }).reason;
    return typeof reason === 'string' ? `${error.name} (${reason})` : error.name;
  }
  return 'erro';
}

export interface InvestigationPanelData {
  /** Mais recente primeiro. */
  history: Investigation[];
  latest: Investigation | null;
  active: boolean;
}

/** Até 10 investigações da empresa; null = investigação indisponível nesta instalação. */
export async function loadInvestigationPanel(
  companyId: string,
): Promise<InvestigationPanelData | null> {
  const { investigations } = getServices();
  if (!investigations) return null;
  try {
    const history = await investigations.history(userContext(), companyId, 10);
    const latest = history[0] ?? null;
    return {
      history,
      latest,
      active: latest !== null && ACTIVE_INVESTIGATION_STATUSES.includes(latest.status),
    };
  } catch (error) {
    console.error(`[investigacao] leitura do histórico falhou: ${errorName(error)}`);
    return null;
  }
}

/** Última investigação de cada empresa da lista, por id. Vazio se a leitura falhar. */
export async function loadInvestigationSummaries(
  companyIds: readonly string[],
): Promise<Map<string, CompanyInvestigationSummary>> {
  const { investigations } = getServices();
  if (!investigations || companyIds.length === 0) return new Map();
  try {
    const rows = await investigations.summaries(userContext(), companyIds);
    return new Map(rows.map((row) => [row.companyId, row]));
  } catch (error) {
    console.error(`[investigacao] leitura dos resumos falhou: ${errorName(error)}`);
    return new Map();
  }
}

/** Server Action da investigação: mesmo tratamento de erro das demais telas de empresas. */
export async function runInvestigationAction(
  values: FormValues,
  write: (investigations: InvestigationService, ctx: RequestContext) => Promise<CompanyOutcome>,
): Promise<FormState> {
  return runServiceAction(getServices().investigations, values, write);
}
