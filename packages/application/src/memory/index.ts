/**
 * Adaptadores em memória das portas de application (ADR-0009): sem IO, mesmo comportamento
 * observável dos adaptadores de banco. Servem aos testes de serviço e ao modo local sem banco.
 */
export { createMemoryAuditRepository } from './audit-repository';
export { createMemoryCompanyRepository } from './company-repository';
export { createMemoryCopilotRepository } from './copilot-repository';
export {
  createMemoryStrategyRepository,
  type MemoryStrategyOptions,
  type MemoryStrategyRepository,
} from './strategy-repository';
