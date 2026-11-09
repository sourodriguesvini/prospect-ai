/** Nomes de host aceitos: o app só atende este computador (ADR-0007). */
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Extrai o nome do host de um cabeçalho `Host` (com ou sem porta, IPv6 entre colchetes). */
export function hostnameOf(hostHeader: string): string {
  const value = hostHeader.trim().toLowerCase();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? value : value.slice(0, end + 1);
  }
  return value.split(':')[0] ?? '';
}

/**
 * Recusa qualquer requisição cujo `Host` (ou `X-Forwarded-Host`, se presente) não seja local.
 * Sem login, é isso que impede um site externo de usar o app via DNS rebinding.
 */
export function isLocalRequest(host: string | null, forwardedHost: string | null): boolean {
  if (!host || !LOCAL_HOSTNAMES.has(hostnameOf(host))) return false;
  if (forwardedHost !== null) {
    return forwardedHost.split(',').every((entry) => LOCAL_HOSTNAMES.has(hostnameOf(entry)));
  }
  return true;
}
