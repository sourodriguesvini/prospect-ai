import type {
  ConnectionOutcome,
  DkimStatus,
  DmarcStatus,
  MailboxCheck,
  MailboxStatus,
  SpfStatus,
} from '@prospector/contracts';
import type { MailboxCheckItem, MailboxIssue } from '@prospector/domain';

/** Rótulos da conferência da caixa (ADR-0016), em pt-BR, para a tela. */

const CONNECTION: Record<ConnectionOutcome, string> = {
  ok: 'Login aceito',
  auth_failed: 'Usuário ou senha recusados',
  unreachable: 'Servidor não respondeu',
  tls_failed: 'Falha na conexão segura (TLS)',
  not_tested: 'Não testado (falta a senha)',
};

const SPF: Record<SpfStatus, string> = {
  ok: 'Autoriza o provedor',
  missing: 'Sem registro',
  multiple: 'Registros duplicados',
  permissive: 'Permissivo demais',
  without_provider: 'Não inclui o provedor',
  unknown: 'DNS não respondeu',
};

const DKIM: Record<DkimStatus, string> = {
  ok: 'Chave publicada',
  missing: 'Sem chave publicada',
  unknown: 'DNS não respondeu',
};

const DMARC: Record<DmarcStatus, string> = {
  enforced: 'Política ativa',
  monitoring: 'Só monitora (p=none)',
  missing: 'Sem registro',
  unknown: 'DNS não respondeu',
};

export function checkStatusLabel(check: MailboxCheck, item: MailboxCheckItem): string {
  switch (item) {
    case 'smtp':
      return CONNECTION[check.smtp];
    case 'imap':
      return CONNECTION[check.imap];
    case 'spf':
      return SPF[check.spf];
    case 'dkim':
      return DKIM[check.dkim];
    case 'dmarc':
      return DMARC[check.dmarc];
  }
}

export type CheckTone = 'success' | 'warning' | 'danger';

/** O tom vem do que a regra do domínio apontou: bloqueio, aviso ou nada. */
export function checkTone(issues: readonly MailboxIssue[], item: MailboxCheckItem): CheckTone {
  const found = issues.filter((issue) => issue.item === item);
  if (found.some((issue) => issue.severity === 'blocking')) return 'danger';
  if (found.length > 0) return 'warning';
  return 'success';
}

export const MAILBOX_STATUS_BADGE: Record<MailboxStatus, 'success' | 'warning' | 'outline'> = {
  verified: 'success',
  unverified: 'warning',
  paused: 'outline',
};
