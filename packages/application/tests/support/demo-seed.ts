import type { MemoryStrategyRepository } from '../../src/memory';

/**
 * Seed de demonstração SÓ PARA TESTES (o modo memória nunca semeia: ADR-0009). Tudo marcado
 * como demonstração (`isDemo`), com nomes que deixam isso explícito; nunca conta para a prontidão.
 */
export async function seedStrategyDemo(repo: MemoryStrategyRepository): Promise<void> {
  const offer = await repo.createOffer({
    name: 'Oferta de demonstração',
    description: 'Exemplo para conhecer a tela. Não conta para a prontidão.',
    problems: ['Exemplo de problema'],
    needSignals: ['Exemplo de sinal'],
    disqualifiers: ['Exemplo de desqualificador'],
    deliverables: ['Exemplo de entregável'],
    valueProps: [],
    priceMinCents: null,
    priceMaxCents: null,
  });
  repo.markOfferAsDemo(offer.id);
}
