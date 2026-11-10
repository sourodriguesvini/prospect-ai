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
 * Pedido que muda estado ou gasta recurso (POST de rota) só vale vindo de uma página do próprio
 * app. Um site aberto em outra aba consegue mandar POST para 127.0.0.1 (o `Host` continua
 * local), então conferimos `Sec-Fetch-Site` e `Origin`. O `Origin` é obrigatório (KI-064): todo
 * navegador atual o manda num POST de `fetch` ou formulário, e um pedido sem ele não veio de uma
 * página do app. Programas deste computador podem forjar cabeçalhos e já são confiáveis
 * (ADR-0007); a regra fecha a porta para clientes que não se identificam.
 */
export function isSameOriginRequest(headers: {
  host: string | null;
  origin: string | null;
  secFetchSite: string | null;
}): boolean {
  if (headers.secFetchSite !== null && headers.secFetchSite !== 'same-origin') return false;
  if (headers.origin === null || !headers.host) return false;
  try {
    const origin = new URL(headers.origin);
    return (
      origin.host.toLowerCase() === headers.host.trim().toLowerCase() &&
      LOCAL_HOSTNAMES.has(hostnameOf(origin.host))
    );
  } catch {
    return false;
  }
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
