import 'server-only';
import {
  createLocalAiRuntime,
  createUnavailableLocalAi,
  DEFAULT_OLLAMA_URL,
  isAiError,
  type LocalAiRuntime,
} from '@prospector/agents';

/** Texto dos fatos do sistema para o Copiloto (função pura do pacote de IA). */
export { buildCopilotSystemFacts } from '@prospector/agents';
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
import { databaseEnv, LocalAiConfigError, localAiEnv } from './env';

/**
 * Raiz de composição da aplicação web: o único lugar que liga serviços de aplicação a
 * adaptadores concretos (`@prospector/db`, `@prospector/agents`) e o único que lê a secret key
 * (ADR-0007, ADR-0008). Telas, rotas e Server Actions recebem serviços daqui.
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

/** O que as telas e rotas usam da IA local: estado, descarregar modelo e o Copiloto. */
export interface LocalAi {
  status: LocalAiRuntime['gateway']['status'];
  unload: LocalAiRuntime['gateway']['unload'];
  copilot: LocalAiRuntime['copilot'];
}

/**
 * IA local: uma única instância no processo do servidor (não por requisição), porque o limite
 * de concorrência e a fila precisam valer para todos os pedidos ao mesmo tempo. Fica em
 * `globalThis` porque o Next carrega este módulo mais de uma vez (rotas de API e telas são
 * empacotadas separadamente); um `let` no módulo criaria uma fila para cada cópia.
 */
const LOCAL_AI_KEY = '__prospectorLocalAi';
type LocalAiHolder = typeof globalThis & { [LOCAL_AI_KEY]?: LocalAiRuntime };

export function getLocalAi(): LocalAi {
  const holder = globalThis as LocalAiHolder;
  let runtime: Pick<LocalAiRuntime, 'gateway' | 'copilot'> | undefined = holder[LOCAL_AI_KEY];
  if (!runtime) {
    try {
      const settings = localAiEnv();
      const created = createLocalAiRuntime({
        baseUrl: settings.baseUrl ?? DEFAULT_OLLAMA_URL,
        copilotModels: settings.copilotModels,
        keepAlive: settings.keepAlive,
        numCtx: settings.numCtx,
        maxConcurrent: settings.maxConcurrent,
        maxQueue: settings.maxQueue,
        vramReserveMiB: settings.vramReserveMiB,
      });
      holder[LOCAL_AI_KEY] = created;
      runtime = created;
    } catch (error) {
      // Configuração inválida não derruba a página nem a rota com erro 500: o painel e o
      // Copiloto mostram o motivo. Não fica guardada: corrigida a variável, a próxima leitura
      // monta a IA local de verdade. Qualquer outro erro é defeito e continua subindo.
      const invalid =
        error instanceof LocalAiConfigError ||
        (isAiError(error) && error.code === 'invalid_config');
      if (!invalid) throw error;
      if (isAiError(error) && error.detail) {
        console.warn(`[ia-local] configuração inválida: ${error.detail}`);
      }
      runtime = createUnavailableLocalAi('invalid_config', invalidConfigMessage(error));
    }
  }
  const { gateway, copilot } = runtime;
  return {
    status: () => gateway.status(),
    unload: (model) => gateway.unload(model),
    copilot,
  };
}

/** Texto para a tela: nomes das variáveis e o que fazer, nunca os valores. */
function invalidConfigMessage(error: unknown): string {
  const what =
    error instanceof LocalAiConfigError
      ? error.variables.length === 1
        ? `a variável ${error.variables.join('')} está inválida`
        : `as variáveis ${error.variables.join(', ')} estão inválidas`
      : isAiError(error)
        ? error.message.replace(/\.$/, '')
        : 'não foi possível ler as variáveis AI_* e OLLAMA_BASE_URL';
  return `A IA local não foi iniciada: ${what}. Corrija em apps/web/.env.local (veja docs/runbooks/ambiente-local.md) e reinicie o app.`;
}
