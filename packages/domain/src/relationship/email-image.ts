/**
 * Imagens da assinatura do e-mail (ADR-0016): a faixa e os ícones das redes precisam ser arquivos
 * de imagem publicados (PNG, JPG ou GIF). Uma página da web, um SVG ou um WebP no lugar da imagem
 * faz o e-mail sair sem ela: o Gmail não mostra SVG e o Outlook não mostra WebP. Aqui ficam só as
 * regras sobre os bytes já baixados; quem baixa é o adaptador (com proteção SSRF).
 */

export type EmailImageRole = 'banner' | 'icon';

export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'svg' | 'html' | 'other';

/** Largura em que o modelo `email-layout/v1` mostra a faixa e o tamanho dos ícones. */
export const EMAIL_BANNER_WIDTH = 536;
export const EMAIL_ICON_SIZE = 20;

/** Peso máximo: a faixa abre junto com o e-mail; ícones são miniaturas. */
export const EMAIL_IMAGE_MAX_BYTES: Record<EmailImageRole, number> = {
  banner: 1024 * 1024,
  icon: 200 * 1024,
};

/** Resultado de baixar o endereço (o adaptador nunca lança: falha vira `failed`). */
export type FetchedEmailImage =
  | {
      kind: 'ok';
      status: number;
      contentType: string | null;
      bytes: Uint8Array;
      /** Passou do teto de download e foi cortado. */
      truncated: boolean;
    }
  /**
   * `too_large`: o site declarou um tamanho muito acima do teto e nada foi baixado.
   * `bad_port`: o endereço tem porta (o cliente seguro só fala nas portas padrão).
   */
  | { kind: 'failed'; reason: 'blocked' | 'unavailable' | 'too_large' | 'bad_port' };

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let out = '';
  for (let i = start; i < Math.min(end, bytes.length); i += 1)
    out += String.fromCharCode(bytes[i]!);
  return out;
}

/** Formato pelos primeiros bytes (o cabeçalho `content-type` do site pode mentir). */
export function sniffImageFormat(bytes: Uint8Array): ImageFormat {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif';
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return 'webp';
  // Texto: ignora o BOM do UTF-8 e os espaços para achar o começo do documento.
  const start = startsWith(bytes, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  const head = ascii(bytes, start, start + 1024)
    .trimStart()
    .toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'svg';
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<head')) {
    return 'html';
  }
  if (head.startsWith('<!doctype svg')) return 'svg';
  return 'other';
}

/** Largura e altura em pixels de PNG, GIF ou JPEG (null se o cabeçalho não for legível). */
export function imageDimensions(
  bytes: Uint8Array,
  format: ImageFormat,
): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (format === 'png') {
    if (bytes.length < 24 || ascii(bytes, 12, 16) !== 'IHDR') return null;
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (format === 'gif') {
    if (bytes.length < 10) return null;
    return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
  }
  if (format === 'jpeg') {
    // Percorre os segmentos até o SOF (início do quadro), que traz altura e largura.
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) return null;
      const marker = bytes[offset + 1]!;
      if (marker === 0xff) {
        offset += 1;
        continue;
      }
      const isSof =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (isSof) {
        return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
      }
      const length = view.getUint16(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
    return null;
  }
  return null;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
  }
  return `${Math.ceil(bytes / 1024)} KB`;
}

const WHAT: Record<EmailImageRole, string> = { banner: 'A faixa', icon: 'O ícone' };

/**
 * O que impede a imagem de aparecer (ou de aparecer direito) no e-mail, em pt-BR; null se está
 * boa. Regras: o endereço responde 200; o arquivo é PNG, JPG ou GIF (pelos bytes) e o site o
 * entrega como imagem; peso até o teto; a faixa tem pelo menos 536 px de largura; o ícone é
 * quadrado e tem pelo menos 20 px.
 */
export function emailImageProblem(role: EmailImageRole, fetched: FetchedEmailImage): string | null {
  const max = EMAIL_IMAGE_MAX_BYTES[role];
  const tooHeavy = `${WHAT[role]} tem mais de ${formatBytes(max)}, o limite para o e-mail abrir rápido.`;
  if (fetched.kind === 'failed') {
    if (fetched.reason === 'too_large') return tooHeavy;
    if (fetched.reason === 'bad_port') {
      return 'Use o endereço do arquivo sem porta (como https://seusite.com.br/imagem.png): endereço com porta não é aceito.';
    }
    return fetched.reason === 'blocked'
      ? 'Este endereço não pode ser usado (endereço interno ou site que não permite acesso automático). Publique a imagem no seu site.'
      : 'Não consegui abrir este endereço agora (sem resposta). Confira se ele abre no navegador e tente de novo.';
  }
  if (fetched.status === 404 || fetched.status === 410) {
    return 'Nada publicado neste endereço (erro 404). Confira se a imagem foi enviada para o site.';
  }
  if (fetched.status < 200 || fetched.status >= 300) {
    return `O site respondeu com erro (HTTP ${fetched.status}). Tente de novo ou use outro endereço.`;
  }
  const format = sniffImageFormat(fetched.bytes);
  if (format === 'html') {
    return 'Este endereço abre uma página, não a imagem. Use o endereço do próprio arquivo (PNG ou JPG): abra a imagem e copie o endereço dela.';
  }
  if (format === 'svg') {
    return 'Imagem SVG não aparece no Gmail nem no Outlook. Use PNG ou JPG.';
  }
  if (format === 'webp') {
    return 'WebP não aparece em todos os programas de e-mail (o Outlook não mostra). Use PNG ou JPG.';
  }
  if (format === 'other') {
    return 'O arquivo deste endereço não é PNG, JPG nem GIF.';
  }
  const type = (fetched.contentType ?? '').split(';')[0]!.trim().toLowerCase();
  if (type && !type.startsWith('image/')) {
    // O tipo vem do site: só aparece na tela se tiver cara de tipo de arquivo e for curto.
    const shown = /^[a-z0-9.+-]{1,40}\/[a-z0-9.+-]{1,60}$/.test(type)
      ? `como "${type}"`
      : 'com outro tipo';
    return `O site entrega este arquivo ${shown}, não como imagem, e alguns programas de e-mail não o mostram. Confira a configuração do site.`;
  }
  // O peso vem depois do formato: uma página grande é "página", não "imagem pesada".
  if (fetched.truncated) return tooHeavy;
  if (fetched.bytes.length > max) {
    return `${WHAT[role]} tem ${formatBytes(fetched.bytes.length)}; use até ${formatBytes(max)} para o e-mail abrir rápido.`;
  }
  const size = imageDimensions(fetched.bytes, format);
  if (!size) return 'Não deu para ler o tamanho desta imagem; o arquivo pode estar corrompido.';
  if (role === 'banner' && size.width < EMAIL_BANNER_WIDTH) {
    return `A faixa tem ${size.width} px de largura e o e-mail a mostra com ${EMAIL_BANNER_WIDTH} px, então ficaria borrada. Use pelo menos ${EMAIL_BANNER_WIDTH} px (o ideal é ${EMAIL_BANNER_WIDTH * 2}).`;
  }
  if (role === 'icon') {
    if (size.width !== size.height) {
      return `O ícone não é quadrado (${size.width}×${size.height} px) e sairia achatado. Use um PNG quadrado, como 40×40 px.`;
    }
    if (size.width < EMAIL_ICON_SIZE) {
      return `O ícone tem ${size.width} px e o e-mail o mostra com ${EMAIL_ICON_SIZE} px, então ficaria borrado. Use pelo menos ${EMAIL_ICON_SIZE} px (o ideal é ${EMAIL_ICON_SIZE * 2}×${EMAIL_ICON_SIZE * 2}).`;
    }
  }
  return null;
}
