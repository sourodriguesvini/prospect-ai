const FALLBACK = '/app';

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * Aceita só caminhos internos para redirecionar depois do login (evita open redirect).
 * Recusa URLs absolutas, protocolo relativo (`//host`), barras invertidas e caracteres de controle.
 */
export function safeNextPath(raw: unknown, fallback: string = FALLBACK): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  if (hasControlCharacter(raw)) return fallback;
  return raw;
}

/**
 * `next` do link de confirmação de e-mail. Pode chegar como caminho (`/convite/x`) ou como URL
 * absoluta do próprio site, inclusive apontando para `/auth/confirm?next=…` quando o template de
 * e-mail repassa `{{ .RedirectTo }}`. Qualquer outra origem vira o padrão.
 */
export function resolveConfirmNext(
  raw: string | null,
  siteUrl: string,
  fallback: string = FALLBACK,
): string {
  if (!raw) return fallback;
  let url: URL;
  try {
    url = new URL(raw, siteUrl);
  } catch {
    return fallback;
  }
  if (url.origin !== new URL(siteUrl).origin) return fallback;
  if (url.pathname === '/auth/confirm') return safeNextPath(url.searchParams.get('next'), fallback);
  return safeNextPath(`${url.pathname}${url.search}`, fallback);
}
