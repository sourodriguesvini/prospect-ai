/**
 * Prévia do e-mail num documento próprio (ADR-0016). A tela de e-mail mostra a prévia num
 * `<iframe>` que carrega esta rota; só ela aceita as imagens https cadastradas (faixa e ícones),
 * sem script, e só pode ser aberta dentro do próprio app. O resto do app segue sem imagens de fora.
 */

export const EMAIL_PREVIEW_HREF = '/configuracoes/email/previa';

/**
 * Política só da prévia: nada de script, formulário ou fonte; estilos inline (o HTML do e-mail
 * depende deles); imagens https e `data:`; enquadrável só pelo próprio app.
 */
export const EMAIL_PREVIEW_CSP = [
  "default-src 'none'",
  'img-src https: data:',
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

export function isEmailPreviewPath(pathname: string): boolean {
  return pathname === EMAIL_PREVIEW_HREF || pathname === `${EMAIL_PREVIEW_HREF}/`;
}

/**
 * O HTML do e-mail como documento da prévia: links abrem fora do quadro (`<base target>` sem
 * endereço, que a política `base-uri 'none'` aceita). O e-mail enviado não leva essa linha.
 */
export function previewDocument(html: string): string {
  const base = '<base target="_blank">';
  const head = /<head(\s[^>]*)?>/i.exec(html);
  if (!head) return `${base}${html}`;
  const at = head.index + head[0].length;
  return `${html.slice(0, at)}\n${base}${html.slice(at)}`;
}

/**
 * Versão curta do conteúdo (FNV-1a), para o endereço do quadro mudar quando a prévia muda e o
 * navegador recarregar a prévia depois de salvar.
 */
export function previewVersion(html: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < html.length; index += 1) {
    hash ^= html.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}
