import 'server-only';
import type { RequestContext } from '@prospector/application';
import { cache } from 'react';

/**
 * Contexto das chamadas feitas pela interface: o ator é sempre o único usuário (ADR-0007) e o
 * traceId é um por requisição, compartilhado por todos os serviços chamados nela.
 */
export const userContext = cache((): RequestContext => ({
  actor: { type: 'user' },
  traceId: crypto.randomUUID(),
}));
