import type { DatabaseStatus } from '@prospector/contracts';
import type { DatabaseHealth } from '../ports/database-health';

export interface SystemService {
  databaseStatus(): Promise<DatabaseStatus>;
}

/** `health` é null quando as credenciais do banco não foram configuradas. */
export function createSystemService(health: DatabaseHealth | null): SystemService {
  return {
    async databaseStatus() {
      if (!health) return 'not_configured';
      try {
        return await health.check();
      } catch {
        return 'unreachable';
      }
    },
  };
}
