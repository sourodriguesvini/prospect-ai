import type { PendingAudit } from '../../src';
import type { MemoryStrategyRepository } from '../../src/memory';

/** O seed também deixa registro, como qualquer escrita (KI-041). */
const SEED_AUDIT: PendingAudit = {
  actorType: 'system',
  actorLabel: 'seed-de-teste',
  traceId: '00000000-0000-4000-8000-000000000000',
  action: 'strategy.offer.created',
  entityType: 'offer',
  entityId: null,
  diff: { version: 1, demo: true },
  withVersion: false,
};

/**
 * Seed de demonstração SÓ PARA TESTES (o modo memória nunca semeia: ADR-0009). Tudo marcado
 * como demonstração (`isDemo`), com nomes que deixam isso explícito; nunca conta para a prontidão.
 */
export async function seedStrategyDemo(repo: MemoryStrategyRepository): Promise<void> {
  const offer = await repo.createOffer(
    {
      name: 'Oferta de demonstração',
      description: 'Exemplo para conhecer a tela. Não conta para a prontidão.',
      problems: ['Exemplo de problema'],
      needSignals: ['Exemplo de sinal'],
      disqualifiers: ['Exemplo de desqualificador'],
      deliverables: ['Exemplo de entregável'],
      valueProps: [],
      priceMinCents: null,
      priceMaxCents: null,
    },
    SEED_AUDIT,
  );
  repo.markOfferAsDemo(offer.id);
}
