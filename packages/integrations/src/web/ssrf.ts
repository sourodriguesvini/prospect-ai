import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * Proteção contra SSRF do leitor de páginas (ADR-0012). Uma URL vinda do modelo, de um resultado
 * de busca ou de um redirecionamento só é lida se:
 * - o esquema é http ou https, sem usuário/senha, na porta padrão (80 ou 443);
 * - o host não é um nome interno (`localhost`, `.local`, `.internal`, nome sem ponto…);
 * - TODOS os endereços do DNS são públicos: nada de loopback, rede privada, CGNAT, link-local
 *   (inclui metadados de nuvem 169.254.169.254), multicast, reservados, documentação, nem os
 *   equivalentes IPv6 (::1, fc00::/7, fe80::/10, IPv4 embutido em ::ffff:, 64:ff9b::, 2002::).
 * A conexão usa o endereço conferido (DNS "fixado"): o host não pode trocar de IP entre a
 * conferência e a conexão (DNS rebinding).
 */

export type Resolver = (hostname: string) => Promise<string[]>;

export const systemResolver: Resolver = async (hostname) => {
  const answers = await lookup(hostname, { all: true, verbatim: true });
  return answers.map((answer) => answer.address);
};

// -----------------------------------------------------------------------------
// IPv4
// -----------------------------------------------------------------------------

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255) ? bytes : null;
}

/** [primeiro octeto, segundo, máscara em bits] dos blocos que não são internet pública. */
const IPV4_BLOCKED: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 0, 8], // "esta" rede
  [10, 0, 0, 8], // privada
  [100, 64, 0, 10], // CGNAT (inclui 100.100.100.200, metadados da Alibaba)
  [127, 0, 0, 8], // loopback
  [169, 254, 0, 16], // link-local (metadados AWS/GCP/Azure em 169.254.169.254)
  [172, 16, 0, 12], // privada
  [192, 0, 0, 24], // atribuições do IETF
  [192, 0, 2, 24], // documentação
  [192, 88, 99, 24], // relay 6to4
  [192, 168, 0, 16], // privada
  [198, 18, 0, 15], // testes de desempenho
  [198, 51, 100, 24], // documentação
  [203, 0, 113, 24], // documentação
  [224, 0, 0, 4], // multicast
  [240, 0, 0, 4], // reservado e broadcast
];

function ipv4ToNumber(bytes: readonly number[]): number {
  return (
    (((bytes[0] ?? 0) << 24) |
      ((bytes[1] ?? 0) << 16) |
      ((bytes[2] ?? 0) << 8) |
      (bytes[3] ?? 0)) >>>
    0
  );
}

function isPublicIpv4(bytes: readonly number[]): boolean {
  const value = ipv4ToNumber(bytes);
  return !IPV4_BLOCKED.some(([a, b, c, bits]) => {
    const base = ipv4ToNumber([a, b, c, 0]);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

// -----------------------------------------------------------------------------
// IPv6
// -----------------------------------------------------------------------------

/** 16 bytes do endereço IPv6 (aceita `::` e IPv4 no fim); null se inválido. */
function parseIpv6(raw: string): number[] | null {
  const ip = raw.toLowerCase();
  if (ip.includes('%')) return null; // id de zona = endereço de enlace local
  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    const pieces = part.split(':');
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index] ?? '';
      if (piece.includes('.')) {
        if (index !== pieces.length - 1) return null;
        const v4 = parseIpv4(piece);
        if (!v4) return null;
        groups.push(((v4[0] ?? 0) << 8) | (v4[1] ?? 0), ((v4[2] ?? 0) << 8) | (v4[3] ?? 0));
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(piece)) return null;
        groups.push(parseInt(piece, 16));
      }
    }
    return groups;
  };
  const head = parseGroups(halves[0] ?? '');
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  let groups: number[];
  if (halves.length === 2) {
    const missing = 8 - head.length - tail.length;
    if (missing < 1) return null;
    groups = [...head, ...Array<number>(missing).fill(0), ...tail];
  } else {
    groups = head;
  }
  if (groups.length !== 8) return null;
  return groups.flatMap((group) => [group >> 8, group & 0xff]);
}

function startsWith(bytes: readonly number[], prefix: readonly number[], bits: number): boolean {
  for (let bit = 0; bit < bits; bit += 1) {
    const byte = bit >> 3;
    const mask = 0x80 >> (bit & 7);
    if (((bytes[byte] ?? 0) & mask) !== ((prefix[byte] ?? 0) & mask)) return false;
  }
  return true;
}

function isPublicIpv6(bytes: readonly number[]): boolean {
  const zeros = (count: number) => bytes.slice(0, count).every((byte) => byte === 0);
  // ::ffff:a.b.c.d (IPv4 mapeado) e ::a.b.c.d (compatível, obsoleto): vale o IPv4.
  if (zeros(10) && bytes[10] === 0xff && bytes[11] === 0xff) return isPublicIpv4(bytes.slice(12));
  if (zeros(12)) return false; // ::, ::1 e IPv4 compatível
  // NAT64 conhecido (64:ff9b::/96): vale o IPv4 embutido.
  if (startsWith(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) {
    return isPublicIpv4(bytes.slice(12));
  }
  // 6to4 (2002::/16): o IPv4 está nos bytes 2 a 5.
  if (startsWith(bytes, [0x20, 0x02], 16)) return isPublicIpv4(bytes.slice(2, 6));
  // Só unicast global (2000::/3) é internet pública.
  if (!startsWith(bytes, [0x20], 3)) return false;
  const blocked: ReadonlyArray<readonly [readonly number[], number]> = [
    [[0x20, 0x01, 0x00, 0x00], 23], // atribuições do IETF (Teredo, ORCHID, testes)
    [[0x20, 0x01, 0x0d, 0xb8], 32], // documentação
    [[0x3f, 0xff], 20], // documentação (RFC 9637)
  ];
  return !blocked.some(([prefix, bits]) => startsWith(bytes, prefix, bits));
}

/** true se o texto é um IP (v4 ou v6) da internet pública. Texto que não é IP: false. */
export function isPublicAddress(ip: string): boolean {
  const trimmed = ip.replace(/^\[|\]$/g, '');
  const version = isIP(trimmed);
  if (version === 4) {
    const bytes = parseIpv4(trimmed);
    return bytes !== null && isPublicIpv4(bytes);
  }
  if (version === 6) {
    const bytes = parseIpv6(trimmed);
    return bytes !== null && isPublicIpv6(bytes);
  }
  return false;
}

// -----------------------------------------------------------------------------
// URL e DNS
// -----------------------------------------------------------------------------

const INTERNAL_SUFFIXES = [
  'localhost',
  'local',
  'internal',
  'intranet',
  'lan',
  'home',
  'corp',
  'home.arpa',
  'localdomain',
];

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: 'blocked_address' };

/** Confere esquema, credenciais, porta e nome do host (sem DNS). */
export function checkUrl(raw: string | URL): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw.toString());
  } catch {
    return { ok: false, reason: 'blocked_address' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: 'blocked_address' };
  }
  if (url.username || url.password) return { ok: false, reason: 'blocked_address' };
  if (url.port !== '' && url.port !== '80' && url.port !== '443') {
    return { ok: false, reason: 'blocked_address' };
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return { ok: false, reason: 'blocked_address' };
  const literal = host.replace(/^\[|\]$/g, '');
  if (isIP(literal)) {
    return isPublicAddress(literal) ? { ok: true, url } : { ok: false, reason: 'blocked_address' };
  }
  if (!host.includes('.')) return { ok: false, reason: 'blocked_address' };
  if (INTERNAL_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return { ok: false, reason: 'blocked_address' };
  }
  return { ok: true, url };
}

export type ResolvedTarget =
  | { ok: true; address: string; family: 4 | 6 }
  | { ok: false; reason: 'blocked_address' | 'unavailable' };

/**
 * Resolve o host e escolhe o endereço da conexão. Se QUALQUER resposta do DNS for interna, recusa
 * (um nome não pode misturar endereço público e interno para enganar a conferência).
 */
export async function resolvePublicTarget(url: URL, resolver: Resolver): Promise<ResolvedTarget> {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await resolver(host);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }
  if (addresses.length === 0) return { ok: false, reason: 'unavailable' };
  if (!addresses.every(isPublicAddress)) return { ok: false, reason: 'blocked_address' };
  const preferred = addresses.find((address) => isIP(address) === 4) ?? addresses[0] ?? '';
  return { ok: true, address: preferred, family: isIP(preferred) === 6 ? 6 : 4 };
}
