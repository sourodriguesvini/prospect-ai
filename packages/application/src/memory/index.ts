/**
 * Adaptadores em memória das portas de application (ADR-0009): sem IO, mesmo comportamento
 * observável dos adaptadores de banco. Servem aos testes de serviço e ao modo local sem banco.
 */
export { createMemoryAuditRepository } from './audit-repository';
export {
  createMemoryCompanyRepository,
  type MemoryCompanyHooks,
  type MemoryCompanyRepository,
} from './company-repository';
export { createMemoryCopilotRepository } from './copilot-repository';
export { createMemoryEmailRepository } from './email-repository';
export { createMemoryIntelligenceRepository, createMemoryMonitoringRepository } from './monitoring';
export { createMemoryRelationshipRepository } from './relationship-repository';
export {
  createMemoryCaptureStore,
  createMemoryInvestigationRepository,
} from './investigation-repository';
export {
  createMemoryStrategyRepository,
  type MemoryStrategyOptions,
  type MemoryStrategyRepository,
} from './strategy-repository';
export { createMemoryWebResearchUsage } from './web-research-usage';
export { createMemoryDiscoveryStore, type MemoryJobInput } from './discovery';
export {
  createMemoryResearchRepository,
  type MemoryResearchRepository,
} from './research-repository';
