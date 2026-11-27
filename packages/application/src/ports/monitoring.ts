import type { FunnelStage, InvestigationChange } from '@prospector/contracts';
import type { StageTally } from '@prospector/domain';

/**
 * Leituras do Monitoramento e da Inteligência (ADR-0017). Só leitura: nada aqui grava, audita ou
 * chama provedor. Implementações: `@prospector/db` (PostgREST) e `memory/` (modo memória e
 * testes de serviço, montado sobre as portas dos outros módulos).
 */

/** Investigação concluída que tem comparação com a anterior e pelo menos uma mudança. */
export interface InvestigationChangeRow {
  investigationId: string;
  companyId: string;
  companyName: string;
  /** Investigação ou empresa de demonstração. */
  isDemo: boolean;
  /** Empresa arquivada: o serviço tira do feed (deixou de ser acompanhada). */
  companyArchived: boolean;
  finishedAt: string;
  changes: InvestigationChange[];
}

export interface MonitoringRepository {
  /**
   * Mais recentes primeiro (`finished_at`), só `succeeded`/`partial` com `changes` não vazio.
   * `limit` conta só as de empresas não arquivadas (as arquivadas vêm marcadas e não ocupam vaga).
   */
  recentChanges(limit: number): Promise<InvestigationChangeRow[]>;
}

export type FunnelTallies = Record<FunnelStage, StageTally>;

export interface IntelligenceRepository {
  /**
   * Empresas distintas em cada etapa do funil desde `since` (null = desde o início), pela data da
   * própria etapa. `capped` quando a leitura chegou ao teto de linhas.
   */
  funnel(since: string | null): Promise<FunnelTallies>;
  /** Soma de `cost_usd` de `llm_calls` e `provider_usage` desde `since`, em micro-dólares. */
  moneySpent(since: string): Promise<{ usdMicros: number; capped: boolean }>;
}
