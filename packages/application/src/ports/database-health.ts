import type { DatabaseStatus } from '@prospector/contracts';

/** Verifica se o banco responde com as credenciais configuradas e se as migrações existem. */
export interface DatabaseHealth {
  check(): Promise<Exclude<DatabaseStatus, 'not_configured'>>;
}
