/**
 * Conferência da caixa de e-mail (ADR-0016, fatia E3; docs/12 §5, controle 1): o que os registros
 * públicos do DNS dizem sobre SPF, DKIM e DMARC do domínio remetente, e o que impede a caixa de
 * enviar. Puro: os registros chegam já consultados.
 */
import type {
  ConnectionOutcome,
  DkimStatus,
  DmarcStatus,
  MailboxCheck,
  SpfStatus,
} from '@prospector/contracts';

export interface MailProviderPreset {
  id: 'hostinger';
  label: string;
  smtpHost: string;
  smtpPort: 465 | 587;
  imapHost: string;
  imapPort: 993;
  /** `include:` do SPF que autoriza os servidores do provedor. */
  spfIncludes: readonly string[];
  dkimSelectors: readonly string[];
  /** Onde o usuário arruma senha e DNS. */
  panelHint: string;
}

export const MAIL_PROVIDERS: Record<MailProviderPreset['id'], MailProviderPreset> = {
  hostinger: {
    id: 'hostinger',
    label: 'Hostinger',
    smtpHost: 'smtp.hostinger.com',
    smtpPort: 465,
    imapHost: 'imap.hostinger.com',
    imapPort: 993,
    spfIncludes: ['_spf.mail.hostinger.com'],
    dkimSelectors: ['hostingermail-a', 'hostingermail-b', 'hostingermail-c'],
    panelHint: 'painel da Hostinger (E-mails › Contas de e-mail e Domínios › Zona DNS)',
  },
};

/** Seletores comuns, tentados depois dos do provedor. */
export const COMMON_DKIM_SELECTORS: readonly string[] = [
  'default',
  'selector1',
  'selector2',
  'google',
  'dkim',
  'mail',
];

export function providerForHost(smtpHost: string): MailProviderPreset | null {
  const host = smtpHost.toLowerCase();
  return host === 'hostinger.com' || host.endsWith('.hostinger.com')
    ? MAIL_PROVIDERS.hostinger
    : null;
}

export function dkimSelectorsFor(smtpHost: string): string[] {
  const provider = providerForHost(smtpHost);
  return [...new Set([...(provider?.dkimSelectors ?? []), ...COMMON_DKIM_SELECTORS])].slice(0, 10);
}

export function emailDomain(address: string): string {
  return address.slice(address.lastIndexOf('@') + 1).toLowerCase();
}

/** Resultado de uma consulta TXT: achou, não existe, ou o DNS falhou (não dá para concluir). */
export interface DnsTxtResult {
  status: 'found' | 'missing' | 'error';
  records: readonly string[];
}

// -----------------------------------------------------------------------------
// SPF, DMARC e DKIM
// -----------------------------------------------------------------------------

export function assessSpf(
  result: DnsTxtResult,
  provider: MailProviderPreset | null,
): { status: SpfStatus; record: string | null } {
  if (result.status === 'error') return { status: 'unknown', record: null };
  const spf = result.records
    .map((record) => record.trim())
    .filter((record) => /^v=spf1(\s|$)/i.test(record));
  if (spf.length === 0) return { status: 'missing', record: null };
  if (spf.length > 1) return { status: 'multiple', record: spf.join(' | ').slice(0, 512) };
  const record = spf[0] ?? '';
  if (/(^|\s)[+?]?all(\s|$)/i.test(record)) return { status: 'permissive', record };
  if (provider) {
    const lower = record.toLowerCase();
    const authorized = provider.spfIncludes.some((include) =>
      lower.split(/\s+/).includes(`include:${include}`),
    );
    if (!authorized) return { status: 'without_provider', record };
  }
  return { status: 'ok', record };
}

export function assessDmarc(result: DnsTxtResult): { status: DmarcStatus; record: string | null } {
  if (result.status === 'error') return { status: 'unknown', record: null };
  const dmarc = result.records
    .map((record) => record.trim())
    .filter((record) => /^v=DMARC1\s*(;|$)/i.test(record));
  if (dmarc.length !== 1) return { status: 'missing', record: null };
  const record = dmarc[0] ?? '';
  const policy = /(?:^|;)\s*p\s*=\s*(none|quarantine|reject)\s*(?:;|$)/i
    .exec(record)?.[1]
    ?.toLowerCase();
  if (!policy) return { status: 'missing', record };
  return { status: policy === 'none' ? 'monitoring' : 'enforced', record: record.slice(0, 512) };
}

export function assessDkim(results: readonly { selector: string; result: DnsTxtResult }[]): {
  status: DkimStatus;
  selectors: string[];
} {
  const active = results
    .filter(({ result }) =>
      result.records.some(
        (record) =>
          /(^|;)\s*v=DKIM1\s*(;|$)/i.test(record) &&
          /(^|;)\s*p=[A-Za-z0-9+/]{16,}={0,2}\s*(;|$)/.test(record),
      ),
    )
    .map(({ selector }) => selector);
  if (active.length > 0) return { status: 'ok', selectors: active };
  const allFailed = results.length > 0 && results.every(({ result }) => result.status === 'error');
  return { status: allFailed ? 'unknown' : 'missing', selectors: [] };
}

// -----------------------------------------------------------------------------
// O que impede a caixa de enviar
// -----------------------------------------------------------------------------

export type MailboxCheckItem = 'smtp' | 'imap' | 'spf' | 'dkim' | 'dmarc';

export interface MailboxIssue {
  item: MailboxCheckItem;
  /** "blocking" impede a caixa de ficar conferida; "warning" funciona, mas vale arrumar. */
  severity: 'blocking' | 'warning';
  message: string;
}

export const MAILBOX_CHECK_LABELS: Record<MailboxCheckItem, string> = {
  smtp: 'Login no servidor de envio (SMTP)',
  imap: 'Login na caixa de entrada (IMAP)',
  spf: 'SPF do domínio',
  dkim: 'Assinatura DKIM',
  dmarc: 'Política DMARC',
};

type CheckResult = Pick<MailboxCheck, MailboxCheckItem>;

interface IssueContext {
  domain: string;
  smtpHost: string;
  imapHost: string;
  provider: MailProviderPreset | null;
  dkimSelectors: readonly string[];
}

function connectionIssue(
  item: 'smtp' | 'imap',
  outcome: ConnectionOutcome,
  host: string,
  context: IssueContext,
): MailboxIssue | null {
  const server = item === 'smtp' ? 'de envio' : 'da caixa de entrada';
  const panel = context.provider ? ` no ${context.provider.panelHint}` : ' no painel do provedor';
  switch (outcome) {
    case 'ok':
      return null;
    case 'auth_failed':
      return {
        item,
        severity: 'blocking',
        message: `O servidor ${server} (${host}) recusou o usuário ou a senha. Confira a senha${panel} e grave de novo.`,
      };
    case 'tls_failed':
      return {
        item,
        severity: 'blocking',
        message:
          item === 'smtp'
            ? `A conexão segura com ${host} falhou. Confira a porta: 465 usa SSL e 587 usa STARTTLS.`
            : `A conexão segura com ${host} falhou. O IMAP usa a porta 993 com SSL.`,
      };
    case 'unreachable':
      return {
        item,
        severity: 'blocking',
        message: `Não foi possível conectar a ${host}. Confira o nome do servidor, a porta e a internet deste computador.`,
      };
    case 'not_tested':
      return {
        item,
        severity: 'blocking',
        message: 'Não testado: grave a senha da caixa primeiro.',
      };
  }
}

export function mailboxCheckIssues(check: CheckResult, context: IssueContext): MailboxIssue[] {
  const issues: MailboxIssue[] = [];
  const smtp = connectionIssue('smtp', check.smtp, context.smtpHost, context);
  if (smtp) issues.push(smtp);
  // A caixa de entrada é necessária: antes de cada envio o app confere se a empresa respondeu.
  const imap = connectionIssue('imap', check.imap, context.imapHost, context);
  if (imap) issues.push(imap);

  const include = context.provider?.spfIncludes[0];
  const spfExample = `v=spf1${include ? ` include:${include}` : ''} ~all`;
  switch (check.spf) {
    case 'ok':
      break;
    case 'missing':
      issues.push({
        item: 'spf',
        severity: 'blocking',
        message: `${context.domain} não tem registro SPF. Na zona DNS, crie um TXT em "@" com: ${spfExample}`,
      });
      break;
    case 'multiple':
      issues.push({
        item: 'spf',
        severity: 'blocking',
        message: `${context.domain} tem mais de um registro SPF, e os provedores tratam isso como erro. Junte tudo num TXT só.`,
      });
      break;
    case 'permissive':
      issues.push({
        item: 'spf',
        severity: 'warning',
        message:
          'O SPF termina em "+all" ou "?all" e autoriza qualquer servidor a enviar em seu nome. Troque por "~all".',
      });
      break;
    case 'without_provider':
      issues.push({
        item: 'spf',
        severity: 'warning',
        message: `O SPF não autoriza os servidores ${context.provider?.label ? `da ${context.provider.label}` : 'do provedor'}${include ? ` (include:${include})` : ''}. Sem isso, parte dos e-mails pode cair no spam.`,
      });
      break;
    case 'unknown':
      issues.push({
        item: 'spf',
        severity: 'blocking',
        message: 'Não deu para consultar o DNS agora. Tente de novo em alguns minutos.',
      });
      break;
  }

  if (check.dkim === 'missing') {
    issues.push({
      item: 'dkim',
      severity: 'blocking',
      message: `Nenhuma chave DKIM ativa encontrada (seletores testados: ${context.dkimSelectors.join(', ')}). Ative o DKIM${context.provider ? ` no ${context.provider.panelHint}` : ' no painel do provedor'}.`,
    });
  } else if (check.dkim === 'unknown') {
    issues.push({
      item: 'dkim',
      severity: 'blocking',
      message: 'Não deu para consultar o DKIM no DNS agora. Tente de novo em alguns minutos.',
    });
  }

  switch (check.dmarc) {
    case 'enforced':
      break;
    case 'monitoring':
      issues.push({
        item: 'dmarc',
        severity: 'warning',
        message:
          'O DMARC está em "p=none" (só monitora). Já funciona; depois de algumas semanas sem problema, passe para "p=quarantine".',
      });
      break;
    case 'missing':
      issues.push({
        item: 'dmarc',
        severity: 'blocking',
        message: `${context.domain} não tem política DMARC válida. Na zona DNS, crie um TXT em "_dmarc" com: v=DMARC1; p=none`,
      });
      break;
    case 'unknown':
      issues.push({
        item: 'dmarc',
        severity: 'blocking',
        message: 'Não deu para consultar o DMARC no DNS agora. Tente de novo em alguns minutos.',
      });
      break;
  }
  return issues;
}

/** A caixa fica "conferida" só sem nenhum item bloqueante. */
export function mailboxCheckPasses(issues: readonly MailboxIssue[]): boolean {
  return issues.every((issue) => issue.severity !== 'blocking');
}
