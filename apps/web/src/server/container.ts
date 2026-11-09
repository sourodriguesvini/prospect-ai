import 'server-only';
import {
  createAuditService,
  createStrategyService,
  createSystemService,
  type AuditRepository,
  type AuditService,
  type StrategyRepository,
  type StrategyService,
  type SystemService,
} from '@prospector/application';
import {
  createMemoryAuditRepository,
  createMemoryStrategyRepository,
} from '@prospector/application/memory';
import {
  createServerSupabaseClient,
  createSupabaseAuditRepository,
  createSupabaseDatabaseHealth,
  createSupabaseStrategyRepository,
} from '@prospector/db';
import { cache } from 'react';
import { databaseEnv, databaseEnvPresent, storageMode, type StorageMode } from './env';

/**
 * Raiz de composição da aplicação web: o único lugar que liga serviços de aplicação a
 * adaptadores concretos (`@prospector/db`) e o único que lê a secret key (ADR-0007).
 * Telas e Server Actions recebem serviços daqui.
 */
export interface Services {
  /** Onde os dados ficam; em "memory" as telas avisam que tudo some ao reiniciar (ADR-0009). */
  storage: StorageMode;
  system: SystemService;
  /** null enquanto o banco não estiver configurado: a tela mostra o estado, não um erro. */
  audit: AuditService | null;
  strategy: StrategyService | null;
}

interface MemoryStores {
  audit: AuditRepository;
  strategy: StrategyRepository;
}

/** Um único conjunto de repositórios em memória por processo do servidor (sobrevive a requisições). */
function memoryStores(): MemoryStores {
  const holder = globalThis as { __prospectorMemoryStores?: MemoryStores };
  holder.__prospectorMemoryStores ??= {
    audit: createMemoryAuditRepository(),
    strategy: createMemoryStrategyRepository(),
  };
  return holder.__prospectorMemoryStores;
}

/** Credenciais do banco ignoradas pelo modo memória: avisa uma vez por processo, alto. */
function warnIgnoredDatabase(): void {
  const holder = globalThis as { __prospectorMemoryWarned?: boolean };
  if (holder.__prospectorMemoryWarned) return;
  holder.__prospectorMemoryWarned = true;
  if (databaseEnvPresent()) {
    console.error(
      'ATENÇÃO: PROSPECTOR_STORAGE=memory com SUPABASE_* definidas. O banco está sendo IGNORADO: nada do que for salvo dura, e as abordagens ficam bloqueadas. Remova PROSPECTOR_STORAGE para usar o banco.',
    );
  }
}

export const getServices = cache((): Services => {
  if (storageMode() === 'memory') {
    warnIgnoredDatabase();
    const stores = memoryStores();
    const audit = createAuditService(stores.audit);
    return {
      storage: 'memory',
      system: createSystemService({ check: async () => 'memory' }),
      audit,
      // LIA e auditoria somem ao reiniciar: a barreira de abordagem nunca libera (ADR-0009).
      strategy: createStrategyService({ repo: stores.strategy, audit, ephemeralStorage: true }),
    };
  }
  const credentials = databaseEnv();
  if (!credentials) {
    return { storage: 'supabase', system: createSystemService(null), audit: null, strategy: null };
  }
  const client = createServerSupabaseClient(credentials.url, credentials.secretKey);
  const audit = createAuditService(createSupabaseAuditRepository(client));
  return {
    storage: 'supabase',
    system: createSystemService(createSupabaseDatabaseHealth(client)),
    audit,
    strategy: createStrategyService({ repo: createSupabaseStrategyRepository(client), audit }),
  };
});
