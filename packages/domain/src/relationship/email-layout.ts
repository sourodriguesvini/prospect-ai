/**
 * Modelo de e-mail da Found Studio (`email-layout/v1`, ADR-0016 §1).
 *
 * Monta o HTML e o texto puro de um e-mail a partir do texto aprovado e da identidade de quem
 * envia, no desenho do modelo de referência: cabeçalho com monograma e etiqueta, corpo em
 * parágrafos, cartão opcional de esboço, despedida, assinatura com faixa de imagem e painel, e
 * rodapé pequeno com o opt-out. Puro e determinístico: o mesmo texto aprovado gera sempre o mesmo
 * e-mail. O texto aprovado é a fonte; o layout não acrescenta frases ao corpo.
 */
import {
  SOCIAL_NETWORK_LABELS as SOCIAL_LABELS,
  type SenderIdentityContent,
  type SocialNetwork,
} from '@prospector/contracts';
import { withoutContactFooter } from './rules';

export const EMAIL_LAYOUT_VERSION = 'email-layout/v1' as const;

export interface EmailSocialLink {
  network: SocialNetwork;
  url: string;
  iconUrl: string;
}

/** Quem assina: vem da configuração de identidade, não da IA. */
export interface EmailIdentity {
  senderName: string;
  role: string;
  studio: string;
  location: string | null;
  website: string | null;
  whatsapp: string | null;
  email: string;
  banner: { url: string; alt: string } | null;
  socials: readonly EmailSocialLink[];
  /** Cor de acento em hex (#rrggbb). */
  accent: string;
}

/** Imagem de esboço feita para a empresa (hospedada no site do estúdio). */
export interface EmailSketch {
  label: string;
  imageUrl: string;
  alt: string;
}

export interface EmailPortfolio {
  url: string;
  label?: string | null;
}

export interface EmailRenderInput {
  subject: string;
  /** Texto aprovado, com o rodapé do sistema (opt-out e canal do titular) no fim. */
  body: string;
  policy: { optOutText: string | null; privacyContact: string | null };
  identity: EmailIdentity;
  /** Etiqueta à direita do cabeçalho ("Proposta de conversa · Empresa"). */
  headerTag?: string | null;
  /** Prévia exibida na lista da caixa de entrada; padrão: o primeiro parágrafo depois da saudação. */
  preheader?: string | null;
  sketch?: EmailSketch | null;
  portfolio?: EmailPortfolio | null;
}

export interface RenderedEmail {
  layoutVersion: typeof EMAIL_LAYOUT_VERSION;
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

// -----------------------------------------------------------------------------
// Portfólio por serviço (decisão do usuário, 2026-11-25)
// -----------------------------------------------------------------------------

export type ServiceLine =
  | 'brand_identity'
  | 'rebranding'
  | 'website'
  | 'ui_ux'
  | 'product'
  | 'systems'
  | 'design_system'
  | 'social_media';

export const PORTFOLIO_LINKS = {
  branding: { url: 'https://branding.foundstudio.com.br/', label: 'Portfólio de branding' },
  product: { url: 'https://foundstudio.com.br/', label: 'Portfólio de produto e UI/UX' },
} as const satisfies Record<string, EmailPortfolio>;

const PORTFOLIO_BY_SERVICE: Record<ServiceLine, keyof typeof PORTFOLIO_LINKS> = {
  brand_identity: 'branding',
  rebranding: 'branding',
  social_media: 'branding',
  website: 'product',
  ui_ux: 'product',
  product: 'product',
  systems: 'product',
  design_system: 'product',
};

/** Branding, rebranding e social media → site de branding; o resto → site principal. */
export function portfolioForService(service: ServiceLine | null): EmailPortfolio | null {
  if (!service) return null;
  return PORTFOLIO_LINKS[PORTFOLIO_BY_SERVICE[service]];
}

// -----------------------------------------------------------------------------
// Texto seguro
// -----------------------------------------------------------------------------

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Só `https://` sem espaço nem aspas; o resto não vira link nem imagem. */
export function safeHttpsUrl(url: string | null | undefined): string | null {
  const value = url?.trim();
  if (!value || !/^https:\/\/[^\s"'<>`]+$/i.test(value)) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.includes('.') ? value : null;
  } catch {
    return null;
  }
}

const EMAIL_ADDRESS = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/;

function displayHost(url: string): string {
  return url.replace(/^https:\/\//i, '').replace(/\/$/, '');
}

function safeAccent(color: string): string {
  return /^#[0-9a-f]{6}$/i.test(color.trim()) ? color.trim() : '#fa4e3e';
}

/** URLs `https://` e e-mails viram links; o resto do texto é escapado. */
const LINKABLE = /(https:\/\/[^\s<>"'`]+)|([A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
const TRAILING_PUNCTUATION = /[.,;:!?)\]]+$/;

function linkify(text: string, linkColor: string): string {
  let html = '';
  let last = 0;
  for (const match of text.matchAll(LINKABLE)) {
    const start = match.index;
    let token = match[0];
    const trailing = TRAILING_PUNCTUATION.exec(token)?.[0] ?? '';
    token = token.slice(0, token.length - trailing.length);
    html += escapeHtml(text.slice(last, start));
    const style = `color:${linkColor};`;
    if (match[1]) {
      const url = safeHttpsUrl(token);
      html += url
        ? `<a href="${escapeHtml(url)}" style="${style}">${escapeHtml(token)}</a>`
        : escapeHtml(token);
    } else {
      html += EMAIL_ADDRESS.test(token)
        ? `<a href="mailto:${escapeHtml(token)}" style="${style}">${escapeHtml(token)}</a>`
        : escapeHtml(token);
    }
    html += escapeHtml(trailing);
    last = start + match[0].length;
  }
  return html + escapeHtml(text.slice(last));
}

// -----------------------------------------------------------------------------
// Corpo: parágrafos, despedida e rodapé
// -----------------------------------------------------------------------------

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n').trim();
}

function paragraphsOf(text: string): string[] {
  return normalize(text)
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

/** "Abraço,", "Um abraço", "Atenciosamente," … no começo do último parágrafo. */
const SIGN_OFF =
  /^(um\s+|grande\s+)?(abra[cç]os?|abs|att|atenciosamente|obrigad[oa]s?|at[eé]\s+mais|valeu|sauda[cç][oõ]es|cordialmente)(?![\p{L}\p{N}])[^\n]{0,40}(\n[^\n]{1,60})?$/iu;

interface BodyParts {
  paragraphs: string[];
  signOff: string | null;
  footer: string | null;
}

function splitBody(body: string, policy: EmailRenderInput['policy']): BodyParts {
  const full = normalize(body);
  const main = withoutContactFooter(full, policy);
  const footer = full.slice(main.length).trim() || null;
  const paragraphs = paragraphsOf(main);
  const lastParagraph = paragraphs.at(-1);
  const signOff = lastParagraph && SIGN_OFF.test(lastParagraph) ? lastParagraph : null;
  if (signOff) paragraphs.pop();
  return { paragraphs, signOff, footer };
}

/** Onde entra o cartão do esboço: depois do parágrafo que termina em ":", ou no fim do corpo. */
function sketchAnchor(paragraphs: readonly string[]): number {
  const index = paragraphs.findIndex((paragraph) => paragraph.endsWith(':'));
  return index >= 0 ? index : paragraphs.length - 1;
}

function defaultPreheader(paragraphs: readonly string[]): string {
  const greeting =
    /^(oi|ol[aá]|bom dia|boa tarde|boa noite|prezad[oa]s?|caro|cara)(?![\p{L}\p{N}])/iu;
  const candidate =
    paragraphs.find((paragraph, index) => !(index === 0 && greeting.test(paragraph))) ??
    paragraphs[0] ??
    '';
  const flat = candidate.replace(/\s+/g, ' ').trim();
  return flat.length > 200 ? `${flat.slice(0, 199).trimEnd()}…` : flat;
}

// -----------------------------------------------------------------------------
// HTML
// -----------------------------------------------------------------------------

const SANS = "Inter,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MONO = "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const INK = '#0a0a0a';
const INK_SOFT = '#2b2b2a';
const MUTED = '#6b6b67';
const RULE = '#e3e3df';
const CARD = '#f4f4f1';
const PANEL = '#efefec';
/** Caracteres invisíveis que impedem o leitor de puxar o corpo para a prévia. */
const PREHEADER_PAD = '&#8199;&#65279;&#847;'.repeat(4);

function paragraphHtml(paragraph: string, last: boolean): string {
  const lines = paragraph.split('\n').map((line) => linkify(line.trim(), INK));
  return `<p style="margin:0 0 ${last ? 20 : 14}px;">${lines.join('<br>')}</p>`;
}

function textBlock(paragraphs: readonly string[], paddingTop: number): string {
  if (paragraphs.length === 0) return '';
  const html = paragraphs
    .map((paragraph, index) => paragraphHtml(paragraph, index === paragraphs.length - 1))
    .join('\n    ');
  return `
  <tr><td class="px" style="padding:${paddingTop}px 32px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${INK};">
    ${html}
  </td></tr>`;
}

function headerHtml(identity: EmailIdentity, accent: string, headerTag: string | null): string {
  const monogram = escapeHtml(identity.senderName.trim().charAt(0).toUpperCase() || '·');
  const tag = headerTag?.trim()
    ? `
      <td class="hide-sm" align="right" style="vertical-align:middle;font-family:${MONO};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};">${escapeHtml(headerTag.trim())}</td>`
    : '';
  return `
  <tr><td class="px" style="padding:0 32px 18px;border-bottom:1px solid ${RULE};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="vertical-align:middle;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
          <td width="30" height="30" align="center" style="width:30px;height:30px;background:${INK};color:#ffffff;font-family:${SANS};font-size:16px;font-weight:700;line-height:30px;mso-line-height-rule:exactly;">${monogram}<span style="color:${accent};">.</span></td>
          <td style="padding-left:12px;font-family:${MONO};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${INK};">${escapeHtml(identity.senderName.trim())}</td>
        </tr></table>
      </td>${tag}
    </tr></table>
  </td></tr>`;
}

function sketchHtml(sketch: EmailSketch, accent: string): string {
  const url = safeHttpsUrl(sketch.imageUrl);
  if (!url) return '';
  return `
  <tr><td class="px" style="padding:0 32px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${CARD};border-left:3px solid ${accent};">
      <tr><td class="cardpad" style="padding:18px 20px 20px;">
        <div style="font-family:${MONO};font-size:11px;letter-spacing:1.4px;text-transform:uppercase;color:${MUTED};margin:0 0 14px;">${escapeHtml(sketch.label)}</div>
        <img src="${escapeHtml(url)}" width="496" alt="${escapeHtml(sketch.alt)}" style="display:block;width:100%;max-width:496px;height:auto;border:0;border-radius:10px;background:#e8e8e4;color:${INK_SOFT};font-family:${SANS};font-size:13px;line-height:19px;">
      </td></tr>
    </table>
  </td></tr>`;
}

function signOffHtml(signOff: string): string {
  const lines = signOff.split('\n').map((line) => escapeHtml(line.trim()));
  return `
  <tr><td class="px" style="padding:6px 32px 22px;font-family:${SANS};font-size:15px;line-height:24px;color:${INK};">
    <p style="margin:0;">${lines.join('<br>')}</p>
  </td></tr>`;
}

function socialsHtml(socials: readonly EmailSocialLink[]): string {
  const cells = socials.flatMap((social) => {
    const url = safeHttpsUrl(social.url);
    const icon = safeHttpsUrl(social.iconUrl);
    if (!url || !icon) return [];
    const label = SOCIAL_LABELS[social.network];
    return [
      `<td style="padding:0 14px 0 0;"><a href="${escapeHtml(url)}" style="text-decoration:none;"><img src="${escapeHtml(icon)}" width="20" height="20" alt="${label}" style="display:block;width:20px;height:20px;border:0;"></a></td>`,
    ];
  });
  if (cells.length === 0) return '';
  return `
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>${cells.join('')}</tr></table>`;
}

interface ContactLine {
  text: string;
  href: string | null;
  strong?: boolean;
}

function contactLines(identity: EmailIdentity, portfolio: EmailPortfolio | null): ContactLine[] {
  const lines: ContactLine[] = [{ text: identity.studio.trim(), href: null }];
  if (identity.location?.trim()) lines.push({ text: identity.location.trim(), href: null });
  const website = safeHttpsUrl(identity.website);
  if (website) lines.push({ text: displayHost(website), href: website });
  const portfolioUrl = safeHttpsUrl(portfolio?.url);
  if (portfolioUrl && displayHost(portfolioUrl) !== (website ? displayHost(website) : null)) {
    lines.push({ text: displayHost(portfolioUrl), href: portfolioUrl });
  }
  if (identity.whatsapp?.trim()) {
    lines.push({ text: `WhatsApp ${identity.whatsapp.trim()}`, href: null });
  }
  if (EMAIL_ADDRESS.test(identity.email.trim())) {
    lines.push({
      text: identity.email.trim(),
      href: `mailto:${identity.email.trim()}`,
      strong: true,
    });
  }
  return lines;
}

function signatureHtml(identity: EmailIdentity, portfolio: EmailPortfolio | null): string {
  const bannerUrl = safeHttpsUrl(identity.banner?.url);
  const banner =
    bannerUrl && identity.banner
      ? `
      <tr><td style="line-height:0;font-size:0;">
        <img src="${escapeHtml(bannerUrl)}" width="536" alt="${escapeHtml(identity.banner.alt)}" style="display:block;width:100%;max-width:536px;height:auto;border:0;background:#2a2a28;">
      </td></tr>`
      : '';
  const contacts = contactLines(identity, portfolio)
    .map((line) => {
      if (!line.href) return escapeHtml(line.text);
      const style = line.strong
        ? `color:${INK};text-decoration:none;font-weight:600;`
        : `color:${INK_SOFT};text-decoration:none;`;
      return `<a href="${escapeHtml(line.href)}" style="${style}">${escapeHtml(line.text)}</a>`;
    })
    .join('<br>');
  return `
  <tr><td class="px" style="padding:0 32px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${banner}
      <tr><td class="painel" style="background:${PANEL};padding:26px 26px 26px;font-size:0;">
        <!--[if mso]><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td width="290" valign="top"><![endif]-->
        <div class="col" style="display:inline-block;vertical-align:top;width:100%;max-width:290px;">
          <div style="font-family:${SANS};font-size:25px;line-height:30px;font-weight:500;letter-spacing:0.2px;text-transform:uppercase;color:${INK};">${escapeHtml(identity.senderName.trim())}</div>
          <div style="font-family:${SANS};font-size:12px;line-height:18px;letter-spacing:0.3px;text-transform:uppercase;color:${INK_SOFT};padding:8px 0 14px;">${escapeHtml(identity.role.trim())}</div>${socialsHtml(identity.socials)}
        </div>
        <!--[if mso]></td><td width="194" valign="top"><![endif]-->
        <div class="col col2" style="display:inline-block;vertical-align:top;width:100%;max-width:194px;padding-top:4px;">
          <div style="font-family:${SANS};font-size:13px;line-height:21px;color:${INK_SOFT};">
            ${contacts}
          </div>
        </div>
        <!--[if mso]></td></tr></table><![endif]-->
      </td></tr>
    </table>
  </td></tr>`;
}

function footerHtml(footer: string): string {
  const html = footer
    .split('\n')
    .map((line) => linkify(line.trim(), MUTED))
    .filter(Boolean)
    .join('<br>');
  return `
  <tr><td class="px" style="padding:18px 32px 0;font-family:${SANS};font-size:11px;line-height:17px;color:${MUTED};">
    ${html}
  </td></tr>`;
}

const HEAD_STYLE = `
  body{margin:0;padding:0;background:#ffffff;}
  a{color:${INK};}
  @media (max-width:620px){
    .wrap{width:100% !important;}
    .px{padding-left:20px !important;padding-right:20px !important;}
    .hide-sm{display:none !important;}
    .painel{padding:22px 20px !important;}
    .col{max-width:100% !important;}
    .col2{padding-top:18px !important;}
    .cardpad{padding:14px 10px 12px !important;}
  }`;

// -----------------------------------------------------------------------------
// Texto puro
// -----------------------------------------------------------------------------

function textVersion(
  parts: BodyParts,
  identity: EmailIdentity,
  sketch: EmailSketch | null,
  portfolio: EmailPortfolio | null,
): string {
  const paragraphs = [...parts.paragraphs];
  const sketchUrl = sketch ? safeHttpsUrl(sketch.imageUrl) : null;
  if (sketch && sketchUrl && paragraphs.length > 0) {
    const anchor = sketchAnchor(paragraphs);
    const paragraph = paragraphs[anchor] ?? '';
    paragraphs[anchor] = paragraph.endsWith(':')
      ? `${paragraph} ${sketchUrl}`
      : `${paragraph}\n\n${sketch.label}: ${sketchUrl}`;
  }
  const blocks = [...paragraphs];
  if (parts.signOff) blocks.push(parts.signOff);
  const signature = [
    identity.senderName.trim(),
    identity.role.trim(),
    ...contactLines(identity, portfolio).map((line) => line.text),
  ].filter(Boolean);
  blocks.push(signature.join('\n'));
  if (parts.footer) blocks.push(`--\n${parts.footer}`);
  return blocks.join('\n\n');
}

// -----------------------------------------------------------------------------
// Montagem
// -----------------------------------------------------------------------------

export function renderEmail(input: EmailRenderInput): RenderedEmail {
  const accent = safeAccent(input.identity.accent);
  const parts = splitBody(input.body, input.policy);
  const sketch = input.sketch && safeHttpsUrl(input.sketch.imageUrl) ? input.sketch : null;
  const portfolio = input.portfolio ?? null;
  const subject = input.subject.replace(/\s+/g, ' ').trim();
  const preheader = (input.preheader?.trim() || defaultPreheader(parts.paragraphs)).replace(
    /\s+/g,
    ' ',
  );

  let bodyRows: string;
  if (sketch && parts.paragraphs.length > 0) {
    const anchor = sketchAnchor(parts.paragraphs);
    bodyRows =
      textBlock(parts.paragraphs.slice(0, anchor + 1), 28) +
      sketchHtml(sketch, accent) +
      textBlock(parts.paragraphs.slice(anchor + 1), 0);
  } else {
    bodyRows = textBlock(parts.paragraphs, 28);
  }

  const html = `<!DOCTYPE html>
<html lang="pt-BR" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(subject)}</title>
<style>${HEAD_STYLE}
</style>
</head>
<body style="margin:0;padding:0;background:#ffffff;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#ffffff;font-size:1px;line-height:1px;">${escapeHtml(preheader)}${PREHEADER_PAD}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 0 32px;">
<!--[if mso]><table role="presentation" width="600" align="center" cellpadding="0" cellspacing="0" border="0"><tr><td><![endif]-->
<table role="presentation" class="wrap" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;">
${headerHtml(input.identity, accent, input.headerTag ?? null)}
${bodyRows}
${parts.signOff ? signOffHtml(parts.signOff) : ''}
${signatureHtml(input.identity, portfolio)}
${parts.footer ? footerHtml(parts.footer) : ''}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>
`;

  return {
    layoutVersion: EMAIL_LAYOUT_VERSION,
    subject,
    preheader,
    html,
    text: textVersion(parts, input.identity, sketch, portfolio),
  };
}

/** Identidade gravada (contrato) → identidade do layout. */
export function emailIdentityFrom(content: SenderIdentityContent): EmailIdentity {
  return {
    senderName: content.senderName,
    role: content.role,
    studio: content.studio,
    location: content.location,
    website: content.website,
    whatsapp: content.whatsapp,
    email: content.email,
    banner:
      content.bannerUrl && content.bannerAlt
        ? { url: content.bannerUrl, alt: content.bannerAlt }
        : null,
    socials: content.socials,
    accent: content.accent,
  };
}
