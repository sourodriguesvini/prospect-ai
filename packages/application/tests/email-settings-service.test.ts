import type { ContactPolicyVersion } from '@prospector/contracts';
import type { DnsTxtResult } from '@prospector/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createEmailSettingsService,
  newEmailThrottle,
  type DnsTxtLookup,
  type EmailSettingsService,
  type LoginOutcome,
  type MailServerConfig,
  type MailTransport,
  type MailboxReader,
  type OutgoingMail,
  type RequestContext,
} from '../src';
import { createMemoryAuditRepository, createMemoryEmailRepository } from '../src/memory';

/**
 * Configuração do e-mail (ADR-0016, fatia E3) com adaptadores falsos: nenhum teste abre conexão,
 * consulta DNS de verdade ou envia e-mail. Dados ILUSTRATIVOS (domínio e pessoa de exemplo).
 */

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '0b7c6d5e-4f3a-4b2c-9d1e-8f7a6b5c4d3e',
};

const IDENTITY = {
  senderName: 'Pessoa Exemplo',
  role: 'Diretora de arte',
  studio: 'Estúdio Exemplo',
  location: 'Cidade Exemplo, BR',
  website: 'https://estudio.exemplo.com.br',
  whatsapp: '(11) 90000-0000',
  email: 'fala@estudio.exemplo.com.br',
  socials: [
    {
      network: 'instagram',
      url: 'https://instagram.com/estudio.exemplo',
      iconUrl: 'https://estudio.exemplo.com.br/icones/instagram.png',
    },
  ],
};

const MAILBOX = {
  address: 'fala@estudio.exemplo.com.br',
  displayName: 'Pessoa Exemplo · Estúdio Exemplo',
  smtpHost: 'smtp.hostinger.com',
  smtpPort: 465,
  imapHost: 'imap.hostinger.com',
  imapPort: 993,
  username: 'fala@estudio.exemplo.com.br',
  dailyLimit: 20,
};

const SECRET = 'senha-de-teste-que-nao-pode-vazar';
const OPT_OUT = 'Se não quiser receber mais mensagens, responda "remover".';
const DKIM_KEY = `v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAs${'A'.repeat(40)}IDAQAB`;

const POLICY: ContactPolicyVersion = {
  id: '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d',
  version: 1,
  content: {
    agencyName: 'Estúdio Exemplo',
    privacyContact: 'privacidade@estudio.exemplo.com.br',
    optOutText: OPT_OUT,
  },
  createdAt: '2026-11-01T12:00:00.000Z',
};

function fakeDns(records: Record<string, DnsTxtResult | 'throw'>) {
  const asked: string[] = [];
  const dns: DnsTxtLookup = {
    async txt(name) {
      asked.push(name);
      const result = records[name];
      if (result === 'throw') throw new Error('falha simulada');
      return result ?? { status: 'missing', records: [] };
    },
  };
  return { dns, asked };
}

const GOOD_DNS = {
  'estudio.exemplo.com.br': {
    status: 'found',
    records: ['v=spf1 include:_spf.mail.hostinger.com ~all'],
  },
  '_dmarc.estudio.exemplo.com.br': { status: 'found', records: ['v=DMARC1; p=none'] },
  'hostingermail-a._domainkey.estudio.exemplo.com.br': { status: 'found', records: [DKIM_KEY] },
} satisfies Record<string, DnsTxtResult>;

function fakeServers() {
  const state = {
    smtp: 'ok' as LoginOutcome | 'throw',
    imap: 'ok' as LoginOutcome,
    verified: [] as MailServerConfig[],
    sent: [] as OutgoingMail[],
    /** Roda no meio do login de envio (para simular mudança da caixa durante a conferência). */
    duringVerify: null as (() => Promise<void>) | null,
    sendFails: false,
  };
  const transport: MailTransport = {
    async verify(config) {
      state.verified.push(config);
      const hook = state.duringVerify;
      state.duringVerify = null;
      await hook?.();
      if (state.smtp === 'throw') throw new Error('falha simulada');
      return state.smtp;
    },
    async send(config, mail) {
      state.verified.push(config);
      if (state.sendFails) throw new Error('falha simulada');
      state.sent.push(mail);
      return { messageId: `<teste-${state.sent.length}@estudio.exemplo.com.br>` };
    },
  };
  const reader: MailboxReader = {
    async verify(config) {
      state.verified.push(config);
      return state.imap;
    },
  };
  return { state, transport, reader };
}

let now: Date;
let audit: ReturnType<typeof createMemoryAuditRepository>;
let servers: ReturnType<typeof fakeServers>;
let dns: ReturnType<typeof fakeDns>;
let service: EmailSettingsService;
let policies: ContactPolicyVersion[];
let repo: ReturnType<typeof createMemoryEmailRepository>;
const clock = { now: () => now };

/** Monta o serviço sobre o mesmo repositório (para trocar servidores ou DNS no meio do teste). */
function build() {
  service = createEmailSettingsService({
    repo,
    transport: servers.transport,
    reader: servers.reader,
    dns: dns.dns,
    strategy: { listContactPolicyVersions: async () => policies },
    audit,
    clock,
    throttle: newEmailThrottle(),
  });
}

async function readyMailbox() {
  await service.saveIdentity(ctx, IDENTITY);
  await service.saveMailbox(ctx, MAILBOX);
  await service.setPassword(ctx, { password: SECRET });
}

beforeEach(() => {
  now = new Date('2026-11-25T13:00:00.000Z');
  audit = createMemoryAuditRepository({ clock: { now: () => now } });
  servers = fakeServers();
  dns = fakeDns(GOOD_DNS);
  policies = [POLICY];
  repo = createMemoryEmailRepository({ audit, clock });
  build();
});

describe('identidade de quem assina', () => {
  it('versiona, ignora o mesmo conteúdo e recusa endereço que não é https', async () => {
    const first = await service.saveIdentity(ctx, IDENTITY);
    expect(first).toMatchObject({ changed: true, value: { version: 1 } });
    expect(first.value.content.accent).toBe('#fa4e3e');

    const same = await service.saveIdentity(ctx, IDENTITY);
    expect(same.changed).toBe(false);

    const second = await service.saveIdentity(ctx, { ...IDENTITY, role: 'Direção de arte' });
    expect(second.value.version).toBe(2);

    await expect(
      service.saveIdentity(ctx, { ...IDENTITY, website: 'http://estudio.exemplo.com.br' }),
    ).rejects.toMatchObject({ code: 'validation' });
    expect(audit.entries().map((entry) => entry.action)).toEqual([
      'email.identity.versioned',
      'email.identity.versioned',
    ]);
    expect(audit.entries()[1]?.diff).toMatchObject({ version: 2 });
  });

  it('a prévia usa a identidade e o rodapé de opt-out da política de contato', async () => {
    await service.saveIdentity(ctx, IDENTITY);
    const { preview, optOutMissing, testBlocked } = await service.settings(ctx);
    expect(preview?.html).toContain('Pessoa Exemplo');
    expect(preview?.text).toContain(OPT_OUT);
    expect(optOutMissing).toBe(false);
    expect(testBlocked).toBe('Salve a caixa de envio primeiro.');

    // Sem política de contato, a prévia sai sem opt-out e a tela é avisada.
    policies = [];
    const bare = await service.settings(ctx);
    expect(bare.optOutMissing).toBe(true);
    expect(bare.preview?.text).not.toContain(OPT_OUT);
  });
});

describe('caixa de e-mail e senha', () => {
  it('a auditoria leva nomes de campos e nunca a senha', async () => {
    await service.saveMailbox(ctx, MAILBOX);
    const unchanged = await service.saveMailbox(ctx, MAILBOX);
    expect(unchanged.changed).toBe(false);
    await service.saveMailbox(ctx, { ...MAILBOX, dailyLimit: 15 });
    await service.setPassword(ctx, { password: SECRET });

    const entries = audit.entries();
    expect(entries.map((entry) => entry.action)).toEqual([
      'email.mailbox.created',
      'email.mailbox.updated',
      'email.mailbox.password_set',
    ]);
    expect(entries[1]?.diff).toEqual({ fields: ['dailyLimit'] });
    expect(JSON.stringify(entries)).not.toContain(SECRET);

    const { mailbox } = await service.settings(ctx);
    expect(mailbox).toMatchObject({ hasPassword: true, status: 'unverified' });
    expect(JSON.stringify(mailbox)).not.toContain(SECRET);
  });

  it('senha sem caixa cadastrada é recusada', async () => {
    await expect(service.setPassword(ctx, { password: SECRET })).rejects.toMatchObject({
      reason: 'mailbox_missing',
    });
    await expect(service.setPassword(ctx, { password: '' })).rejects.toBeInstanceOf(AppError);
  });

  it('o remetente fica no domínio do usuário da caixa (apelido vale)', async () => {
    await expect(
      service.saveMailbox(ctx, { ...MAILBOX, address: 'fala@outro-dominio.exemplo.com' }),
    ).rejects.toMatchObject({ code: 'validation' });
    const alias = await service.saveMailbox(ctx, {
      ...MAILBOX,
      address: 'contato@estudio.exemplo.com.br',
    });
    expect(alias.value.address).toBe('contato@estudio.exemplo.com.br');
  });

  it('trocar servidor ou usuário desliga a senha; trocar a porta, não', async () => {
    await readyMailbox();
    await service.saveMailbox(ctx, { ...MAILBOX, smtpPort: 587 });
    expect((await service.settings(ctx)).mailbox?.hasPassword).toBe(true);

    const moved = await service.saveMailbox(ctx, {
      ...MAILBOX,
      smtpHost: 'smtp.outro-provedor.exemplo.com',
    });
    expect(moved.value).toMatchObject({ hasPassword: false, passwordSetAt: null });
    expect(await repo.readMailboxPassword(moved.value.id)).toBeNull();
    const settings = await service.settings(ctx);
    expect(settings.testBlocked).toBe('Grave a senha da caixa primeiro.');

    // A senha antiga nunca vai para o servidor novo.
    const check = await service.checkMailbox(ctx);
    expect(check.check.smtp).toBe('not_tested');
    expect(servers.state.verified).toHaveLength(0);
  });

  it('não aceita servidor em endereço privado nem porta fora do padrão', async () => {
    await expect(
      service.saveMailbox(ctx, { ...MAILBOX, smtpHost: 'localhost' }),
    ).rejects.toMatchObject({ code: 'validation' });
    await expect(service.saveMailbox(ctx, { ...MAILBOX, smtpPort: 25 })).rejects.toMatchObject({
      code: 'validation',
    });
  });
});

describe('conferência da caixa', () => {
  it('sem senha, não tenta login e bloqueia', async () => {
    await service.saveMailbox(ctx, MAILBOX);
    const result = await service.checkMailbox(ctx);
    expect(result.check).toMatchObject({ smtp: 'not_tested', imap: 'not_tested' });
    expect(result.passed).toBe(false);
    expect(servers.state.verified).toHaveLength(0);
  });

  it('login e DNS em ordem: caixa conferida, com aviso do DMARC só monitorando', async () => {
    await readyMailbox();
    const result = await service.checkMailbox(ctx);

    expect(result.check).toMatchObject({
      smtp: 'ok',
      imap: 'ok',
      spf: 'ok',
      dkim: 'ok',
      dmarc: 'monitoring',
    });
    expect(result.passed).toBe(true);
    expect(result.issues.map((issue) => [issue.item, issue.severity])).toEqual([
      ['dmarc', 'warning'],
    ]);
    expect(servers.state.verified.map((config) => [config.host, config.port])).toEqual([
      ['smtp.hostinger.com', 465],
      ['imap.hostinger.com', 993],
    ]);
    expect(dns.asked).toContain('_dmarc.estudio.exemplo.com.br');
    expect(dns.asked).toContain('hostingermail-a._domainkey.estudio.exemplo.com.br');
    expect(JSON.stringify(result.check)).not.toContain(SECRET);

    const { mailbox, lastCheck, testBlocked } = await service.settings(ctx);
    expect(mailbox?.status).toBe('verified');
    expect(mailbox?.verifiedAt).not.toBeNull();
    expect(lastCheck?.id).toBe(result.check.id);
    expect(testBlocked).toBeNull();
    expect(audit.entries().at(-1)?.action).toBe('email.mailbox.verified');
  });

  it('senha recusada ou servidor fora do ar deixam a caixa sem conferência', async () => {
    await readyMailbox();
    servers.state.smtp = 'auth_failed';
    const refused = await service.checkMailbox(ctx);
    expect(refused.passed).toBe(false);
    expect(refused.issues[0]).toMatchObject({ item: 'smtp', severity: 'blocking' });

    servers.state.smtp = 'throw';
    dns = fakeDns({ ...GOOD_DNS, 'estudio.exemplo.com.br': 'throw' });
    build();
    const broken = await service.checkMailbox(ctx);
    expect(broken.check).toMatchObject({ smtp: 'unreachable', spf: 'unknown' });
  });

  it('uma conferência por vez, com intervalo de 10 segundos', async () => {
    await readyMailbox();
    const first = service.checkMailbox(ctx);
    await expect(service.checkMailbox(ctx)).rejects.toMatchObject({
      reason: 'email_check_busy',
    });
    await first;
    now = new Date(now.getTime() + 5_000);
    await expect(service.checkMailbox(ctx)).rejects.toMatchObject({
      reason: 'email_check_busy',
    });
    now = new Date(now.getTime() + 6_000);
    await expect(service.checkMailbox(ctx)).resolves.toMatchObject({ passed: true });
    // Só duas conferências chegaram aos servidores (cada uma testa envio e entrada).
    expect(servers.state.verified).toHaveLength(4);
  });

  it('se a caixa muda durante a conferência, o resultado não vale para ela', async () => {
    await readyMailbox();
    servers.state.duringVerify = async () => {
      now = new Date(now.getTime() + 1_000);
      await service.saveMailbox(ctx, { ...MAILBOX, smtpPort: 587 });
    };
    const result = await service.checkMailbox(ctx);
    expect(result.passed).toBe(true);

    const settings = await service.settings(ctx);
    expect(settings.mailbox?.status).toBe('unverified');
    expect(settings.lastCheck).toBeNull();
    expect(audit.entries().map((entry) => entry.action)).not.toContain('email.mailbox.verified');
  });

  it('trocar a senha ou o servidor invalida a conferência anterior', async () => {
    await readyMailbox();
    await service.checkMailbox(ctx);

    now = new Date('2026-11-25T13:05:00.000Z');
    await service.setPassword(ctx, { password: `${SECRET}-2` });
    let settings = await service.settings(ctx);
    expect(settings.mailbox?.status).toBe('unverified');
    expect(settings.lastCheck).toBeNull();
    expect(settings.testBlocked).toBe('Clique em Testar conexão primeiro.');

    await service.checkMailbox(ctx);
    await service.saveMailbox(ctx, { ...MAILBOX, smtpPort: 587 });
    settings = await service.settings(ctx);
    expect(settings.mailbox?.status).toBe('unverified');
    expect(settings.lastCheck).toBeNull();
  });
});

describe('e-mail de teste para mim', () => {
  it('só depois de o login de envio passar', async () => {
    await readyMailbox();
    await expect(service.sendTestToSelf(ctx)).rejects.toMatchObject({
      reason: 'mailbox_not_ready',
    });
    expect(servers.state.sent).toHaveLength(0);
  });

  it('vai só para a própria caixa, com o modelo e o opt-out, um por minuto', async () => {
    await readyMailbox();
    await service.checkMailbox(ctx);

    const sent = await service.sendTestToSelf(ctx);
    expect(sent.to).toBe(MAILBOX.address);
    expect(servers.state.sent).toHaveLength(1);
    const mail = servers.state.sent[0];
    expect(mail).toMatchObject({
      to: MAILBOX.address,
      from: { name: MAILBOX.displayName, address: MAILBOX.address },
    });
    expect(mail?.text).toContain(OPT_OUT);
    expect(mail?.html).toContain('Estúdio Exemplo');

    now = new Date(now.getTime() + 30_000);
    await expect(service.sendTestToSelf(ctx)).rejects.toMatchObject({
      reason: 'email_test_too_soon',
    });
    now = new Date(now.getTime() + 31_000);
    await service.sendTestToSelf(ctx);
    expect(servers.state.sent.map((item) => item.to)).toEqual([MAILBOX.address, MAILBOX.address]);

    // Cada envio fica na auditoria só com o Message-ID (sem conteúdo, sem senha).
    const sentEntries = audit.entries().filter((entry) => entry.action === 'email.test_sent');
    expect(sentEntries).toHaveLength(2);
    expect(sentEntries[0]?.diff).toEqual({ messageId: '<teste-1@estudio.exemplo.com.br>' });
    expect(JSON.stringify(audit.entries())).not.toContain(SECRET);
  });

  it('com apelido como remetente, o teste vai para o usuário que o login prova', async () => {
    await service.saveIdentity(ctx, IDENTITY);
    await service.saveMailbox(ctx, { ...MAILBOX, address: 'contato@estudio.exemplo.com.br' });
    await service.setPassword(ctx, { password: SECRET });
    await service.checkMailbox(ctx);
    expect((await service.settings(ctx)).testRecipient).toBe(MAILBOX.username);

    const sent = await service.sendTestToSelf(ctx);
    expect(sent.to).toBe(MAILBOX.username);
    expect(servers.state.sent[0]).toMatchObject({
      to: MAILBOX.username,
      from: { address: 'contato@estudio.exemplo.com.br' },
    });
  });

  it('uma tentativa que falha também conta para o intervalo de um minuto', async () => {
    await readyMailbox();
    await service.checkMailbox(ctx);
    servers.state.sendFails = true;
    await expect(service.sendTestToSelf(ctx)).rejects.toThrow();
    servers.state.sendFails = false;
    await expect(service.sendTestToSelf(ctx)).rejects.toMatchObject({
      reason: 'email_test_too_soon',
    });
    expect(audit.entries().map((entry) => entry.action)).not.toContain('email.test_sent');
  });

  it('sem identidade não envia', async () => {
    await service.saveMailbox(ctx, MAILBOX);
    await expect(service.sendTestToSelf(ctx)).rejects.toMatchObject({
      reason: 'sender_identity_missing',
    });
  });
});
