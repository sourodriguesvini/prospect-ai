import type { DatabaseStatus } from '@prospector/contracts';
import type { StatusTone } from '@prospector/ui';

export interface DatabaseStatusView {
  label: string;
  tone: StatusTone;
  help: string;
}

/** Texto do estado do banco na tela inicial: o que significa e o que fazer. */
export const DATABASE_STATUS_VIEW: Record<DatabaseStatus, DatabaseStatusView> = {
  ok: {
    label: 'Conectado',
    tone: 'success',
    help: 'O banco responde e as migrações estão aplicadas.',
  },
  not_configured: {
    label: 'Não configurado',
    tone: 'warning',
    help: 'Defina SUPABASE_URL e SUPABASE_SECRET_KEY em apps/web/.env.local e reinicie o app. Passo a passo em docs/runbooks/ambiente-local.md.',
  },
  schema_missing: {
    label: 'Migrações pendentes',
    tone: 'warning',
    help: 'O banco responde, mas as tabelas do Prospector não existem. Aplique as migrações de supabase/migrations (docs/runbooks/ambiente-local.md).',
  },
  unreachable: {
    label: 'Inacessível',
    tone: 'danger',
    help: 'Não foi possível falar com o banco em até 3 segundos, ou a chave foi recusada. Confira a conexão e as variáveis em apps/web/.env.local.',
  },
};
