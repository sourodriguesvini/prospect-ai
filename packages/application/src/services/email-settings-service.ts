import {
  MailboxCheckDetails,
  MailboxPasswordInput,
  MailboxSettingsInput,
  SenderIdentityContent,
  authenticatedAddress,
  isPublicHostname,
  type ConnectionOutcome,
  type Mailbox,
  type MailboxCheck,
  type SenderIdentityVersion,
} from '@prospector/contracts';
import {
  assessDkim,
  assessDmarc,
  assessSpf,
  dkimSelectorsFor,
  emailDomain,
  emailIdentityFrom,
  emailImageProblem,
  mailboxCheckIssues,
  mailboxCheckPasses,
  providerForHost,
  renderEmail,
  withContactFooter,
  type DnsTxtResult,
  type EmailImageRole,
  type FetchedEmailImage,
  type MailboxIssue,
  type RenderedEmail,
} from '@prospector/domain';
import { systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, assertNoIssues, isAppError, parseInput, type FieldIssue } from '../errors';
import type { AuditRepository } from '../ports/audit-repository';
import type {
  DnsTxtLookup,
  EmailImageFetcher,
  EmailSettingsRepository,
  MailboxReader,
  MailServerConfig,
  MailTransport,
} from '../ports/email';
import type { StrategyRepository } from '../ports/strategy-repository';
import { pendingAudit } from './pending-audit';
import type { SaveResult } from './strategy-service';

/**
 * Configuração do e-mail (ADR-0016, fatia E3): identidade de quem assina, caixa de envio, senha
 * no cofre e conferência (login SMTP/IMAP, SPF, DKIM, DMARC). O único envio desta fatia é o teste
 * para a própria caixa: nenhuma empresa recebe nada daqui.
 */

export interface EmailSettings {
  identity: SenderIdentityVersion | null;
  mailbox: Mailbox | null;
  lastCheck: MailboxCheck | null;
  /** O que a última conferência apontou (vazio sem conferência). */
  issues: MailboxIssue[];
  /** Prévia do modelo com a identidade atual (null sem identidade). */
  preview: RenderedEmail | null;
  /** A política de contato ainda não tem frase de opt-out: o rodapé da prévia sai sem ela. */
  optOutMissing: boolean;
  /** Por que o teste ainda não pode ser enviado (null = pode). */
  testBlocked: string | null;
  /** Para onde o teste vai: o endereço que o login prova (null sem caixa). */
  testRecipient: string | null;
}

export interface MailboxCheckResult {
  check: MailboxCheck;
  issues: MailboxIssue[];
  passed: boolean;
}

export interface EmailSettingsService {
  settings(ctx: RequestContext): Promise<EmailSettings>;
  saveIdentity(ctx: RequestContext, raw: unknown): Promise<SaveResult<SenderIdentityVersion>>;
  saveMailbox(ctx: RequestContext, raw: unknown): Promise<SaveResult<Mailbox>>;
  setPassword(ctx: RequestContext, raw: unknown): Promise<void>;
  checkMailbox(ctx: RequestContext): Promise<MailboxCheckResult>;
  /** Envia o e-mail de teste só para a caixa que o login prova (`authenticatedAddress`). */
  sendTestToSelf(ctx: RequestContext): Promise<{ to: string; messageId: string }>;
}

/** Guardas do processo (os serviços são recriados a cada pedido). */
export interface EmailThrottle {
  /** Última tentativa de envio de teste (reservada antes de conectar). */
  lastSentAt: number | null;
  /** Última conferência iniciada e se ainda está rodando. */
  lastCheckAt: number | null;
  checkRunning: boolean;
}

export function newEmailThrottle(): EmailThrottle {
  return { lastSentAt: null, lastCheckAt: null, checkRunning: false };
}

export interface EmailSettingsDeps {
  repo: EmailSettingsRepository;
  transport: MailTransport;
  reader: MailboxReader;
  dns: DnsTxtLookup;
  /** Confere, ao salvar quem assina, que a faixa e os ícones são imagens que aparecem no e-mail. */
  images: EmailImageFetcher;
  /** Para o rodapé de opt-out da política de contato no e-mail de teste e na prévia. */
  strategy: Pick<StrategyRepository, 'listContactPolicyVersions'>;
  /** Registro do e-mail de teste (o único envio desta fatia), sem conteúdo. */
  audit?: Pick<AuditRepository, 'append'>;
  clock?: Clock;
  /** Um teste por minuto e uma conferência por vez (com intervalo curto), no processo inteiro. */
  throttle?: EmailThrottle;
}

const TEST_INTERVAL_MS = 60_000;
/** Cliques seguidos em "Testar conexão" com a senha errada podem bloquear a conta no provedor. */
const CHECK_INTERVAL_MS = 10_000;

const TEST_SUBJECT = 'Teste do Prospector: modelo de e-mail';

function testBody(firstName: string): string {
  return [
    'Oi! Este é um e-mail de teste do Prospector.',
    'Ele mostra como as suas mensagens vão chegar: cabeçalho, assinatura e rodapé, montados a partir da identidade cadastrada em Configuração › E-mail. Nenhuma empresa recebeu esta mensagem; ela foi enviada só para a sua própria caixa.',
    'Se algo estiver fora do lugar (imagem, link ou rede social), ajuste a identidade e envie outro teste.',
    `Abraço,\n${firstName}`,
  ].join('\n\n');
}

/**
 * Downloads de imagem ao mesmo tempo: o DNS do sistema roda no pool de threads do Node (4 por
 * padrão), que o resto do servidor também usa.
 */
const IMAGE_DOWNLOAD_CONCURRENCY = 2;

/**
 * Problemas das imagens da assinatura, por campo do formulário. Uma faixa ou um ícone que é página
 * da web, SVG ou WebP faz o e-mail sair sem a imagem, e por isso a identidade não é salva assim.
 * Cada endereço novo é baixado uma vez; os que já estavam na versão salva, no mesmo papel, foram
 * conferidos quando ela foi salva e não são baixados de novo (um site fora do ar não impede
 * corrigir o cargo).
 */
async function imageIssues(
  images: EmailImageFetcher,
  content: SenderIdentityContent,
  saved: SenderIdentityContent | null,
): Promise<FieldIssue[]> {
  const key = (role: EmailImageRole, url: string) => `${role} ${url}`;
  const checked = new Set<string>();
  if (saved?.bannerUrl) checked.add(key('banner', saved.bannerUrl));
  for (const social of saved?.socials ?? []) checked.add(key('icon', social.iconUrl));

  const targets: { field: string; role: EmailImageRole; url: string }[] = [];
  if (content.bannerUrl) {
    targets.push({ field: 'bannerUrl', role: 'banner', url: content.bannerUrl });
  }
  content.socials.forEach((social, index) => {
    targets.push({ field: `socials.${index}.iconUrl`, role: 'icon', url: social.iconUrl });
  });
  const pending = targets.filter((target) => !checked.has(key(target.role, target.url)));

  const urls = [...new Set(pending.map((target) => target.url))];
  const fetched = new Map<string, FetchedEmailImage>();
  let next = 0;
  const worker = async () => {
    while (next < urls.length) {
      const url = urls[next++]!;
      const result = await images
        .fetch(url)
        .catch((): FetchedEmailImage => ({ kind: 'failed', reason: 'unavailable' }));
      fetched.set(url, result);
    }
  };
  const workers = Math.min(IMAGE_DOWNLOAD_CONCURRENCY, urls.length);
  await Promise.all(Array.from({ length: workers }, worker));

  return pending.flatMap((target) => {
    const message = emailImageProblem(target.role, fetched.get(target.url)!);
    return message ? [{ field: target.field, message }] : [];
  });
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function mailboxFields(mailbox: Mailbox): MailboxSettingsInput {
  return {
    address: mailbox.address,
    displayName: mailbox.displayName,
    smtpHost: mailbox.smtpHost,
    smtpPort: mailbox.smtpPort,
    imapHost: mailbox.imapHost,
    imapPort: mailbox.imapPort,
    username: mailbox.username,
    dailyLimit: mailbox.dailyLimit,
  };
}

/** O que uma conferência testou; muda quando a caixa muda de servidor, usuário ou senha. */
export function connectionKey(mailbox: Mailbox): string {
  return [
    mailbox.address,
    `${mailbox.smtpHost}:${mailbox.smtpPort}`,
    `${mailbox.imapHost}:${mailbox.imapPort}`,
    mailbox.username,
    mailbox.passwordSetAt ?? 'sem-senha',
  ].join('|');
}

/** Registros do DNS cabem no contrato da conferência (512 caracteres). */
function clip(record: string | null): string | null {
  return record === null ? null : record.slice(0, 512);
}

/** Nomes dos campos que mudaram (a auditoria leva nomes, nunca valores: KI-015). */
function changedFields(before: MailboxSettingsInput, after: MailboxSettingsInput): string[] {
  return (Object.keys(after) as (keyof MailboxSettingsInput)[]).filter(
    (key) => before[key] !== after[key],
  );
}

export function createEmailSettingsService(deps: EmailSettingsDeps): EmailSettingsService {
  const { repo, transport, reader, dns } = deps;
  const clock = deps.clock ?? systemClock;
  const throttle = deps.throttle ?? newEmailThrottle();

  async function contactPolicy() {
    const [current] = await deps.strategy.listContactPolicyVersions();
    return current?.content ?? null;
  }

  /** A última conferência, se ainda for da conexão atual (null depois de trocar servidor ou senha). */
  async function currentCheck(mailbox: Mailbox): Promise<MailboxCheck | null> {
    const check = await repo.latestCheck(mailbox.id);
    return check && check.details.connection === connectionKey(mailbox) ? check : null;
  }

  function issuesFor(mailbox: Mailbox, check: MailboxCheck): MailboxIssue[] {
    return mailboxCheckIssues(check, {
      domain: emailDomain(mailbox.address),
      smtpHost: mailbox.smtpHost,
      imapHost: mailbox.imapHost,
      provider: providerForHost(mailbox.smtpHost),
      dkimSelectors: dkimSelectorsFor(mailbox.smtpHost),
    });
  }

  async function sample(
    identity: SenderIdentityVersion,
    policy: Awaited<ReturnType<typeof contactPolicy>>,
  ): Promise<RenderedEmail> {
    const footerPolicy = {
      optOutText: policy?.optOutText ?? null,
      privacyContact: policy?.privacyContact ?? null,
    };
    const firstName =
      identity.content.senderName.trim().split(/\s+/)[0] ?? identity.content.senderName;
    return renderEmail({
      subject: TEST_SUBJECT,
      body: withContactFooter(testBody(firstName), footerPolicy, {
        firstContact: true,
        awaitingFirstReply: false,
      }),
      policy: footerPolicy,
      identity: emailIdentityFrom(identity.content),
      headerTag: 'E-mail de teste · Prospector',
    });
  }

  async function requireMailbox(): Promise<Mailbox> {
    const mailbox = await repo.getMailbox();
    if (!mailbox) throw new AppError('conflict', 'mailbox_missing');
    return mailbox;
  }

  function serverConfig(
    mailbox: Mailbox,
    kind: 'smtp' | 'imap',
    password: string | null,
  ): MailServerConfig | null {
    if (!password) return null;
    return {
      host: kind === 'smtp' ? mailbox.smtpHost : mailbox.imapHost,
      port: kind === 'smtp' ? mailbox.smtpPort : mailbox.imapPort,
      username: mailbox.username,
      password,
    };
  }

  async function lookup(name: string): Promise<DnsTxtResult> {
    try {
      return await dns.txt(name);
    } catch {
      return { status: 'error', records: [] };
    }
  }

  async function login(
    verify: (config: MailServerConfig) => Promise<ConnectionOutcome>,
    config: MailServerConfig | null,
  ): Promise<ConnectionOutcome> {
    if (!config) return 'not_tested';
    try {
      return await verify(config);
    } catch {
      return 'unreachable';
    }
  }

  return {
    async settings() {
      const [[identity], mailbox, policy] = await Promise.all([
        repo.listIdentityVersions(),
        repo.getMailbox(),
        contactPolicy(),
      ]);
      const lastCheck = mailbox ? await currentCheck(mailbox) : null;
      const issues = mailbox && lastCheck ? issuesFor(mailbox, lastCheck) : [];
      let testBlocked: string | null = null;
      if (!identity) testBlocked = 'Salve quem assina primeiro.';
      else if (!mailbox) testBlocked = 'Salve a caixa de envio primeiro.';
      else if (!mailbox.hasPassword) testBlocked = 'Grave a senha da caixa primeiro.';
      else if (!lastCheck) testBlocked = 'Clique em Testar conexão primeiro.';
      else if (lastCheck.smtp !== 'ok') {
        testBlocked =
          'O login de envio falhou na última conferência. Corrija o que aparece acima e teste de novo.';
      }
      return {
        identity: identity ?? null,
        mailbox,
        lastCheck,
        issues,
        preview: identity ? await sample(identity, policy) : null,
        optOutMissing: !policy?.optOutText?.trim(),
        testBlocked,
        testRecipient: mailbox ? authenticatedAddress(mailbox) : null,
      };
    },

    async saveIdentity(ctx, raw) {
      const content = parseInput(SenderIdentityContent, raw);
      const [current] = await repo.listIdentityVersions();
      if (current && sameJson(current.content, content)) return { value: current, changed: false };
      assertNoIssues(await imageIssues(deps.images, content, current?.content ?? null));
      const version = await repo.addIdentityVersion(
        content,
        pendingAudit(ctx, {
          action: 'email.identity.versioned',
          entityType: 'sender_identity',
          withVersion: true,
        }),
      );
      return { value: version, changed: true };
    },

    async saveMailbox(ctx, raw) {
      const input = parseInput(MailboxSettingsInput, raw);
      const current = await repo.getMailbox();
      if (!current) {
        const created = await repo.createMailbox(
          input,
          pendingAudit(ctx, { action: 'email.mailbox.created', entityType: 'mailbox' }),
        );
        return { value: created, changed: true };
      }
      const fields = changedFields(mailboxFields(current), input);
      if (fields.length === 0) return { value: current, changed: false };
      const updated = await repo.updateMailbox(
        current.id,
        input,
        pendingAudit(ctx, {
          action: 'email.mailbox.updated',
          entityType: 'mailbox',
          entityId: current.id,
          diff: { fields },
        }),
      );
      return { value: updated, changed: true };
    },

    async setPassword(ctx, raw) {
      const { password } = parseInput(MailboxPasswordInput, raw);
      const mailbox = await requireMailbox();
      await repo.setMailboxPassword(
        mailbox.id,
        password,
        pendingAudit(ctx, {
          action: 'email.mailbox.password_set',
          entityType: 'mailbox',
          entityId: mailbox.id,
          diff: { passwordChanged: true },
        }),
      );
    },

    async checkMailbox(ctx) {
      const started = clock.now().getTime();
      if (
        throttle.checkRunning ||
        (throttle.lastCheckAt !== null && started - throttle.lastCheckAt < CHECK_INTERVAL_MS)
      ) {
        throw new AppError('conflict', 'email_check_busy');
      }
      // Reservado antes de qualquer espera: dois cliques ao mesmo tempo não testam duas vezes.
      throttle.checkRunning = true;
      throttle.lastCheckAt = started;
      try {
        return await runCheck(ctx);
      } finally {
        throttle.checkRunning = false;
      }
    },

    async sendTestToSelf(ctx) {
      const [identity] = await repo.listIdentityVersions();
      if (!identity) throw new AppError('conflict', 'sender_identity_missing');
      const mailbox = await requireMailbox();
      const last = await currentCheck(mailbox);
      if (last?.smtp !== 'ok') throw new AppError('conflict', 'mailbox_not_ready');
      const config = serverConfig(mailbox, 'smtp', await repo.readMailboxPassword(mailbox.id));
      if (!config) throw new AppError('conflict', 'mailbox_password_missing');
      const now = clock.now().getTime();
      if (throttle.lastSentAt !== null && now - throttle.lastSentAt < TEST_INTERVAL_MS) {
        throw new AppError('conflict', 'email_test_too_soon');
      }
      // Reservado antes de conectar (sem espera entre conferir e marcar): vale como tentativa.
      throttle.lastSentAt = now;
      const email = await sample(identity, await contactPolicy());
      // Só para a caixa que o login prova: o destinatário nunca vem de um campo livre.
      const to = authenticatedAddress(mailbox);
      const sent = await transport.send(config, {
        from: { name: mailbox.displayName, address: mailbox.address },
        to,
        subject: email.subject,
        html: email.html,
        text: email.text,
        headers: { 'X-Prospector': 'teste' },
      });
      await deps.audit?.append({
        actorType: ctx.actor.type,
        actorLabel: null,
        action: 'email.test_sent',
        entityType: 'mailbox',
        entityId: mailbox.id,
        diff: { messageId: sent.messageId.slice(0, 300) },
        traceId: ctx.traceId,
      });
      return { to, messageId: sent.messageId };
    },
  };

  async function runCheck(ctx: RequestContext): Promise<MailboxCheckResult> {
    const mailbox = await requireMailbox();
    // A senha é lida uma vez e só vai para os servidores em que foi digitada (o banco a desliga
    // quando o servidor ou o usuário mudam).
    const password = await repo.readMailboxPassword(mailbox.id);
    const smtpConfig = serverConfig(mailbox, 'smtp', password);
    const imapConfig = serverConfig(mailbox, 'imap', password);
    const [smtp, imap] = await Promise.all([
      login((config) => transport.verify(config), smtpConfig),
      login((config) => reader.verify(config), imapConfig),
    ]);

    const domain = emailDomain(mailbox.address);
    const provider = providerForHost(mailbox.smtpHost);
    const selectors = dkimSelectorsFor(mailbox.smtpHost);
    const publicDomain = isPublicHostname(domain);
    const failed: DnsTxtResult = { status: 'error', records: [] };
    const [spfTxt, dmarcTxt, dkimTxt] = publicDomain
      ? await Promise.all([
          lookup(domain),
          lookup(`_dmarc.${domain}`),
          Promise.all(selectors.map((selector) => lookup(`${selector}._domainkey.${domain}`))),
        ])
      : [failed, failed, selectors.map(() => failed)];
    const spf = assessSpf(spfTxt, provider);
    const dmarc = assessDmarc(dmarcTxt);
    const dkim = assessDkim(
      selectors.map((selector, index) => ({ selector, result: dkimTxt[index] ?? failed })),
    );

    const check = await repo.addCheck({
      mailboxId: mailbox.id,
      smtp,
      imap,
      spf: spf.status,
      dkim: dkim.status,
      dmarc: dmarc.status,
      // Validado aqui, igual para os dois repositórios (memória e banco).
      details: MailboxCheckDetails.parse({
        domain,
        spfRecord: clip(spf.record),
        dmarcRecord: clip(dmarc.record),
        dkimSelectors: dkim.selectors.slice(0, 10),
        connection: connectionKey(mailbox),
      }),
      traceId: ctx.traceId,
      checkedAt: clock.now().toISOString(),
    });
    const issues = issuesFor(mailbox, check);
    const passed = mailboxCheckPasses(issues);
    // A caixa pode ter mudado (servidor ou senha) enquanto conferíamos: aí o resultado não vale.
    const latest = await repo.getMailbox();
    if (
      latest &&
      latest.status !== 'paused' &&
      connectionKey(latest) === check.details.connection
    ) {
      const next = passed ? 'verified' : 'unverified';
      if (latest.status !== next) {
        try {
          // Condicional: se a caixa mudou desde a releitura, a conferência não vale para ela.
          await repo.setMailboxStatus(
            mailbox.id,
            next,
            pendingAudit(ctx, {
              action: passed ? 'email.mailbox.verified' : 'email.mailbox.unverified',
              entityType: 'mailbox',
              entityId: mailbox.id,
              diff: { checkId: check.id },
            }),
            { expectedUpdatedAt: latest.updatedAt },
          );
        } catch (error) {
          if (!(isAppError(error) && error.reason === 'concurrent_change')) throw error;
        }
      }
    }
    return { check, issues, passed };
  }
}
