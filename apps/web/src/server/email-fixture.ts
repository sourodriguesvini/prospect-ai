import 'server-only';
import type {
  DnsTxtLookup,
  EmailImageFetcher,
  MailboxReader,
  MailTransport,
} from '@prospector/application';

/**
 * Caixa de e-mail SIMULADA para os testes de ponta a ponta (`PROSPECTOR_EMAIL=fixture`). Só
 * funciona no modo memória (o container recusa com banco) e não abre conexão nenhuma: o login
 * "passa", o DNS devolve registros de exemplo e o envio só guarda a mensagem na memória do
 * processo. As imagens da assinatura também não são baixadas: endereço terminado em .png, .jpg,
 * .jpeg ou .gif "é" uma imagem quadrada de 1080 px (serve de faixa e de ícone); qualquer outro "é"
 * uma página da web, que a conferência recusa. A tela mostra o selo DEMO enquanto este modo
 * estiver ligado.
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

/** PNG mínimo (assinatura + IHDR) de 1080×1080: é só o que a conferência das imagens lê. */
function samplePng(): Uint8Array {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, 1080);
  view.setUint32(20, 1080);
  return bytes;
}

const IMAGE_PATH = /\.(png|jpe?g|gif)$/i;

export function syntheticEmail(): {
  transport: MailTransport;
  reader: MailboxReader;
  dns: DnsTxtLookup;
  images: EmailImageFetcher;
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
    images: {
      async fetch(url) {
        const isImage = IMAGE_PATH.test(new URL(url).pathname);
        return isImage
          ? {
              kind: 'ok',
              status: 200,
              contentType: 'image/png',
              bytes: samplePng(),
              truncated: false,
            }
          : {
              kind: 'ok',
              status: 200,
              contentType: 'text/html; charset=utf-8',
              bytes: new TextEncoder().encode('<!doctype html><html><body>Página</body></html>'),
              truncated: false,
            };
      },
    },
  };
}
