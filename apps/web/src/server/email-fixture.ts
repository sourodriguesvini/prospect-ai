import 'server-only';
import type { DnsTxtLookup, MailboxReader, MailTransport } from '@prospector/application';

/**
 * Caixa de e-mail SIMULADA para os testes de ponta a ponta (`PROSPECTOR_EMAIL=fixture`). Só
 * funciona no modo memória (o container recusa com banco) e não abre conexão nenhuma: o login
 * "passa", o DNS devolve registros de exemplo e o envio só guarda a mensagem na memória do
 * processo. A tela mostra o selo DEMO enquanto este modo estiver ligado.
 */

const DKIM_SAMPLE = `v=DKIM1;k=rsa;p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAexemplo${'A'.repeat(32)}IDAQAB`;

export interface FixtureOutbox {
  sent: { to: string; subject: string }[];
}

const OUTBOX_KEY = '__prospectorEmailFixtureOutbox';

/** Mensagens "enviadas" no modo simulado (uma lista por processo). */
export function fixtureOutbox(): FixtureOutbox {
  const holder = globalThis as { [OUTBOX_KEY]?: FixtureOutbox };
  holder[OUTBOX_KEY] ??= { sent: [] };
  return holder[OUTBOX_KEY];
}

export function syntheticEmail(): {
  transport: MailTransport;
  reader: MailboxReader;
  dns: DnsTxtLookup;
} {
  return {
    transport: {
      async verify() {
        return 'ok';
      },
      async send(_config, mail) {
        const outbox = fixtureOutbox();
        outbox.sent.push({ to: mail.to, subject: mail.subject });
        return { messageId: `<demo-${outbox.sent.length}@prospector.invalid>` };
      },
    },
    reader: {
      async verify() {
        return 'ok';
      },
    },
    dns: {
      async txt(name) {
        if (name.startsWith('_dmarc.')) return { status: 'found', records: ['v=DMARC1; p=none'] };
        if (name.startsWith('hostingermail-a._domainkey.')) {
          return { status: 'found', records: [DKIM_SAMPLE] };
        }
        if (name.includes('._domainkey.')) return { status: 'missing', records: [] };
        return { status: 'found', records: ['v=spf1 include:_spf.mail.hostinger.com ~all'] };
      },
    },
  };
}
