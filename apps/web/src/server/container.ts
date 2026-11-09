import 'server-only';
import {
  createAuditService,
  createSystemService,
  type AuditService,
  type SystemService,
} from '@prospector/application';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseDatabaseHealth,
} from '@prospector/db';
import { cache } from 'react';
import { databaseEnv } from './env';

/**
 * Raiz de composição da aplicação web: o único lugar que liga serviços de aplicação a
 * adaptadores concretos (`@prospector/db`) e o único que lê a secret key (ADR-0007).
 * Telas e Server Actions recebem serviços daqui.
 */
export interface Services {
  system: SystemService;
  /** null enquanto o banco não estiver configurado: a tela mostra o estado, não um erro. */
  audit: AuditService | null;
}

export const getServices = cache((): Services => {
  const credentials = databaseEnv();
  if (!credentials) return { system: createSystemService(null), audit: null };
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  return {
    system: createSystemService(createSupabaseDatabaseHealth(client)),
    audit: createAuditService(createSupabaseAuditRepository(client)),
  };
});
