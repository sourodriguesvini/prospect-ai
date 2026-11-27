import { describe, expect, it } from 'vitest';

import {
  EMAIL_LAYOUT_VERSION,
  PORTFOLIO_LINKS,
  portfolioForService,
  renderEmail,
  safeHttpsUrl,
  withContactFooter,
  type EmailIdentity,
  type EmailRenderInput,
} from '../../src';

// Dados ilustrativos (não são pessoas nem empresas reais).
const identity: EmailIdentity = {
  senderName: 'Pessoa Exemplo',
  role: 'Designer de produto',
  studio: 'Estúdio Exemplo',
  location: 'Cidade, SP · Brasil',
  website: 'https://estudio.exemplo.com.br/',
  whatsapp: '(00) 00000-0000',
  email: 'fala@estudio.exemplo.com.br',
  banner: {
    url: 'https://estudio.exemplo.com.br/assets/email/banner.jpg',
    alt: 'Pessoa Exemplo · Produtos digitais',
  },
  socials: [
    {
      network: 'instagram',
      url: 'https://www.instagram.com/exemplo',
      iconUrl: 'https://estudio.exemplo.com.br/assets/email/icone-instagram.png',
    },
  ],
  accent: '#fa4e3e',
};

const policy = {
  optOutText:
    'Escrevi para este endereço porque ele está publicado no site de vocês. Se preferir não receber outras mensagens, é só responder “não”.',
  privacyContact: null,
};

const approvedBody = withContactFooter(
  [
    'Oi, pessoal da Empresa Exemplo. Tudo bem?',
    'Vi que o site de vocês no celular corta o menu de serviços.',
    'Fiz um esboço rápido de como isso ficaria:',
    'Topam 20 minutos? Um projeto meu: https://estudio.exemplo.com.br/works/caso.html.',
    'Abraço,\nPessoa',
  ].join('\n\n'),
  policy,
  { firstContact: true, awaitingFirstReply: false },
);

function input(overrides: Partial<EmailRenderInput> = {}): EmailRenderInput {
  return {
    subject: 'Uma sugestão para o site da Empresa Exemplo',
    body: approvedBody,
    policy,
    identity,
    headerTag: 'Proposta de conversa · Empresa Exemplo',
    ...overrides,
  };
}

describe('renderEmail (email-layout/v1)', () => {
  it('monta cabeçalho, corpo, assinatura e rodapé do modelo', () => {
    const email = renderEmail(input());
    expect(email.layoutVersion).toBe(EMAIL_LAYOUT_VERSION);
    expect(email.html).toContain('<html lang="pt-BR"');
    expect(email.html).toContain('P<span style="color:#fa4e3e;">.</span>');
    expect(email.html).toContain('Proposta de conversa · Empresa Exemplo');
    expect(email.html).toContain(
      '<p style="margin:0 0 14px;">Oi, pessoal da Empresa Exemplo. Tudo bem?</p>',
    );
    expect(email.html).toContain('class="painel"');
    expect(email.html).toContain('banner.jpg');
    expect(email.html).toContain('alt="Instagram"');
    expect(email.html).toContain('WhatsApp (00) 00000-0000');
  });

  it('tira o opt-out do corpo e o põe no rodapé, com a frase aprovada', () => {
    const email = renderEmail(input());
    const footerIndex = email.html.indexOf('font-size:11px;line-height:17px;color:#6b6b67;');
    expect(footerIndex).toBeGreaterThan(email.html.indexOf('class="painel"'));
    expect(email.html.slice(footerIndex)).toContain('responder “não”');
    expect(email.html.match(/responder “não”/g)).toHaveLength(1);
    expect(email.text.endsWith(`--\n${policy.optOutText}`)).toBe(true);
  });

  it('separa a despedida num bloco próprio, antes da assinatura', () => {
    const email = renderEmail(input());
    expect(email.html).toContain('<p style="margin:0;">Abraço,<br>Pessoa</p>');
    expect(email.html.indexOf('Abraço,')).toBeLessThan(email.html.indexOf('class="painel"'));
    expect(email.text).toContain(
      'Abraço,\nPessoa\n\nPessoa Exemplo\nDesigner de produto\nEstúdio Exemplo',
    );
  });

  it('escapa o texto e só transforma https e e-mails em link', () => {
    const email = renderEmail(
      input({
        body: 'Teste <script>alert(1)</script> & "aspas".\n\nhttp://inseguro.com.br e javascript:alert(1) e https://seguro.com.br/a. Escreva para oi@empresa.com.br.',
        policy: { optOutText: null, privacyContact: null },
      }),
    );
    expect(email.html).not.toContain('<script>');
    expect(email.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;aspas&quot;.');
    expect(email.html).not.toContain('href="http://');
    expect(email.html).not.toContain('href="javascript:');
    expect(email.html).toContain(
      '<a href="https://seguro.com.br/a" style="color:#0a0a0a;">https://seguro.com.br/a</a>.',
    );
    expect(email.html).toContain('<a href="mailto:oi@empresa.com.br"');
  });

  it('põe o cartão do esboço depois do parágrafo que termina em ":"', () => {
    const email = renderEmail(
      input({
        sketch: {
          label: 'Esboço · Empresa Exemplo',
          imageUrl: 'https://estudio.exemplo.com.br/esbocos/exemplo.jpg',
          alt: 'Esboço do site no celular',
        },
      }),
    );
    const intro = email.html.indexOf('Fiz um esboço rápido de como isso ficaria:');
    const card = email.html.indexOf('Esboço · Empresa Exemplo');
    const next = email.html.indexOf('Topam 20 minutos?');
    expect(intro).toBeLessThan(card);
    expect(card).toBeLessThan(next);
    expect(email.html).toContain('border-left:3px solid #fa4e3e;');
    expect(email.text).toContain(
      'Fiz um esboço rápido de como isso ficaria: https://estudio.exemplo.com.br/esbocos/exemplo.jpg',
    );
  });

  it('ignora esboço, faixa e redes com endereço que não seja https', () => {
    const email = renderEmail(
      input({
        sketch: { label: 'Esboço', imageUrl: 'http://x.com.br/a.jpg', alt: 'a' },
        identity: {
          ...identity,
          banner: { url: 'http://x.com.br/banner.jpg', alt: 'faixa' },
          socials: [
            { network: 'linkedin', url: 'javascript:alert(1)', iconUrl: 'https://x.com.br/i.png' },
          ],
        },
      }),
    );
    expect(email.html).not.toContain('x.com.br');
    expect(email.html).not.toContain('class="cardpad"');
  });

  it('mostra o portfólio do serviço na assinatura sem repetir o site', () => {
    const branding = renderEmail(input({ portfolio: portfolioForService('rebranding') }));
    expect(branding.html).toContain('href="https://branding.foundstudio.com.br/"');
    expect(branding.text).toContain('branding.foundstudio.com.br');

    const same = renderEmail(input({ portfolio: { url: 'https://estudio.exemplo.com.br/' } }));
    expect(same.text.match(/^estudio\.exemplo\.com\.br$/gm)).toHaveLength(1);
  });

  it('usa o primeiro parágrafo depois da saudação como prévia', () => {
    expect(renderEmail(input()).preheader).toBe(
      'Vi que o site de vocês no celular corta o menu de serviços.',
    );
    expect(renderEmail(input({ body: 'Olá, tudo bem?\n\nSegunda linha.' })).preheader).toBe(
      'Segunda linha.',
    );
    const long = renderEmail(input({ body: `Oi!\n\n${'a'.repeat(300)}` })).preheader;
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('é determinístico e troca acento inválido pelo padrão', () => {
    expect(renderEmail(input())).toEqual(renderEmail(input()));
    const email = renderEmail(input({ identity: { ...identity, accent: 'red;x:y' } }));
    expect(email.html).not.toContain('red;x:y');
    expect(email.html).toContain('#fa4e3e');
  });
});

describe('portfolioForService', () => {
  it('branding, rebranding e social media → site de branding; o resto → site principal', () => {
    expect(portfolioForService('brand_identity')).toBe(PORTFOLIO_LINKS.branding);
    expect(portfolioForService('rebranding')).toBe(PORTFOLIO_LINKS.branding);
    expect(portfolioForService('social_media')).toBe(PORTFOLIO_LINKS.branding);
    for (const service of ['website', 'ui_ux', 'product', 'systems', 'design_system'] as const) {
      expect(portfolioForService(service)).toBe(PORTFOLIO_LINKS.product);
    }
    expect(portfolioForService(null)).toBeNull();
  });
});

describe('safeHttpsUrl', () => {
  it('aceita só https com domínio', () => {
    expect(safeHttpsUrl('https://foundstudio.com.br/')).toBe('https://foundstudio.com.br/');
    expect(safeHttpsUrl('http://foundstudio.com.br/')).toBeNull();
    expect(safeHttpsUrl('https://localhost/')).toBeNull();
    expect(safeHttpsUrl('https://a.com.br/"onerror="x')).toBeNull();
    expect(safeHttpsUrl(null)).toBeNull();
  });
});
