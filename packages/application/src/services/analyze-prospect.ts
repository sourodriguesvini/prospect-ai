import type { Investigation } from '@prospector/contracts';
import type { RequestContext } from '../context';
import { isAppError } from '../errors';
import type { DiscoveryService } from './discovery-service';
import type { InvestigationService } from './investigation-service';

/**
 * "Analisar empresa" na Descoberta (proposta de 26/11, Frente 1): grava a empresa com as
 * evidências da pesquisa e, no mesmo clique, começa a análise. Antes disso a ação só criava o
 * cadastro e a investigação exigia um segundo clique no dossiê.
 *
 * Nunca começa uma análise repetida nem gasta busca à toa:
 * - análise em andamento na empresa: não cria outra (`already_running`);
 * - análise concluída (mesmo com uma atualização cancelada ou com falha depois): não refaz
 *   sozinha; quem decide atualizar é o usuário, na página da empresa (`already_analyzed`);
 * - análise interrompida ou com falha: retoma sem repetir as etapas concluídas (`resumed`);
 * - fila cheia ou empresa arquivada: a empresa fica gravada, a análise **não** começou e o
 *   resultado diz isso (`not_started`), para a tela não afirmar o que não aconteceu.
 */
export type AnalyzeProspectResult =
  | { status: 'started'; companyId: string; investigationId: string }
  | { status: 'resumed'; companyId: string; investigationId: string }
  | { status: 'already_running'; companyId: string; investigationId: string | null }
  | { status: 'already_analyzed'; companyId: string; investigationId: string }
  | {
      status: 'not_started';
      companyId: string;
      reason: 'queue_full' | 'company_archived' | 'unavailable';
    };

export interface AnalyzeProspectDeps {
  discovery: Pick<DiscoveryService, 'investigate'>;
  /** null = investigação desligada nesta instalação: a empresa é gravada e nada mais. */
  investigations: Pick<InvestigationService, 'start' | 'resume' | 'history'> | null;
}

const ACTIVE: readonly Investigation['status'][] = ['queued', 'running'];
const FINISHED: readonly Investigation['status'][] = ['succeeded', 'partial'];
const RESUMABLE: readonly Investigation['status'][] = ['interrupted', 'failed'];
/** Análises lidas do histórico da empresa (as mais recentes primeiro). */
const HISTORY_LIMIT = 10;

function notStartedReason(error: unknown): 'queue_full' | 'company_archived' | null {
  if (!isAppError(error)) return null;
  if (error.reason === 'investigation_queue_full') return 'queue_full';
  if (error.reason === 'company_archived') return 'company_archived';
  return null;
}

export async function analyzeProspect(
  deps: AnalyzeProspectDeps,
  ctx: RequestContext,
  prospectId: string,
): Promise<AnalyzeProspectResult> {
  // Idempotente no serviço da Descoberta: a segunda vez liga à mesma empresa.
  const { companyId } = await deps.discovery.investigate(ctx, prospectId);
  const investigations = deps.investigations;
  if (!investigations) return { status: 'not_started', companyId, reason: 'unavailable' };

  // As últimas análises, não só a mais recente: uma atualização cancelada ou com falha depois de
  // uma análise concluída não faz "Analisar empresa" gastar buscas de novo.
  const recent = await investigations.history(ctx, companyId, HISTORY_LIMIT);
  const [latest] = recent;
  if (latest && ACTIVE.includes(latest.status)) {
    return { status: 'already_running', companyId, investigationId: latest.id };
  }
  const analyzed = recent.find((item) => FINISHED.includes(item.status));
  if (analyzed) {
    return { status: 'already_analyzed', companyId, investigationId: analyzed.id };
  }

  try {
    if (latest && RESUMABLE.includes(latest.status)) {
      const resumed = await investigations.resume(ctx, latest.id);
      return { status: 'resumed', companyId, investigationId: resumed.id };
    }
    const started = await investigations.start(ctx, {
      companyId,
      trigger: 'discovery',
      force: false,
    });
    return { status: 'started', companyId, investigationId: started.id };
  } catch (error) {
    // Corrida: outra aba começou a análise entre a leitura e o pedido (índice único no banco).
    if (isAppError(error) && error.reason === 'investigation_running') {
      return { status: 'already_running', companyId, investigationId: null };
    }
    // Corrida na retomada: outra aba já retomou (ou a análise terminou) entre a leitura e o pedido.
    if (isAppError(error) && error.reason === 'investigation_not_resumable') {
      const [current] = await investigations.history(ctx, companyId, 1);
      if (current && ACTIVE.includes(current.status)) {
        return { status: 'already_running', companyId, investigationId: current.id };
      }
      if (current && FINISHED.includes(current.status)) {
        return { status: 'already_analyzed', companyId, investigationId: current.id };
      }
    }
    const reason = notStartedReason(error);
    if (reason) return { status: 'not_started', companyId, reason };
    throw error;
  }
}
