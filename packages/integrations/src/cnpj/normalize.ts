import { CPF_IN_TEXT, type CompanySize, type RegistryStatus } from '@prospector/contracts';

/**
 * Normalização comum aos provedores da base aberta da Receita. Formatos conferidos com chamadas
 * reais em 2026-11-10 (research/05 §5): textos vazios viram null, CNAE vira 7 dígitos, capital
 * vira centavos.
 */

export function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().replace(/\s+/g, ' ');
  return trimmed === '' ? null : trimmed;
}

/** `2005-11-03` (ou com hora) → `2005-11-03`; o resto vira null. */
export function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : `${match[1]}-${match[2]}-${match[3]}`;
}

/** Data e hora do provedor (a OpenCNPJ usa 7 casas de fração) → ISO 8601 em UTC. */
export function isoDateTime(value: unknown): string | null {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** CNAE em número (a Minha Receita perde o zero à esquerda) ou texto → 7 dígitos. */
export function cnae(value: unknown): string | null {
  const digits =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.replace(/\D/g, '')
        : '';
  if (digits === '' || /^0+$/.test(digits) || digits.length > 7) return null;
  return digits.padStart(7, '0');
}

/** `0600-0/01` para o contrato (`CnaeCode` aceita os dígitos e formata). */
export function formatCnae(digits: string): string {
  return `${digits.slice(0, 4)}-${digits.slice(4, 5)}/${digits.slice(5)}`;
}

/** Nome do status (OpenCNPJ) ou código (Minha Receita: 1 nula, 2 ativa, 3 suspensa, 4 inapta, 8 baixada). */
export function registryStatus(value: unknown): RegistryStatus | null {
  if (typeof value === 'number') {
    return (
      ({ 1: 'null', 2: 'active', 3: 'suspended', 4: 'unfit', 8: 'closed' } as const)[
        value as 1 | 2 | 3 | 4 | 8
      ] ?? null
    );
  }
  const raw = text(value)
    ?.normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
  switch (raw) {
    case 'ativa':
      return 'active';
    case 'suspensa':
      return 'suspended';
    case 'inapta':
      return 'unfit';
    case 'baixada':
      return 'closed';
    case 'nula':
      return 'null';
    default:
      return null;
  }
}

export function companySize(value: unknown): CompanySize | null {
  const raw = text(value)?.toUpperCase() ?? '';
  if (raw.includes('MICRO')) return 'me';
  if (raw.includes('PEQUENO')) return 'epp';
  if (raw.includes('DEMAIS')) return 'demais';
  return null;
}

/** `"205431960490,52"` (OpenCNPJ) ou `205431960000` (Minha Receita, em reais) → centavos. */
export function capitalCents(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  const raw = text(value);
  if (!raw) return null;
  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : null;
}

/** `"S"`/`"N"`/`""` (OpenCNPJ) ou boolean/null (Minha Receita). */
export function flag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  const raw = text(value)?.toUpperCase();
  if (raw === 'S' || raw === 'SIM') return true;
  if (raw === 'N' || raw === 'NAO' || raw === 'NÃO') return false;
  return null;
}

/**
 * LGPD: o nome empresarial do MEI traz o CPF da pessoa (ex.: "MARIA DA SILVA 12345678900").
 * A OpenCNPJ já remove; aqui é a garantia para qualquer provedor. Tira CPF com ou sem pontuação.
 */
export function stripCpf(name: string): string {
  return name.replace(new RegExp(CPF_IN_TEXT.source, 'g'), ' ').replace(/\s+/g, ' ').trim();
}

/** Código da natureza jurídica (`"2062"` ou `2135`) → 4 dígitos. */
export function natureCode(value: unknown): string | null {
  const raw = typeof value === 'number' ? String(value) : text(value)?.replace(/\D/g, '');
  return raw && /^\d{4}$/.test(raw) ? raw : null;
}

const UFS = new Set([
  'AC',
  'AL',
  'AM',
  'AP',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MG',
  'MS',
  'MT',
  'PA',
  'PB',
  'PE',
  'PI',
  'PR',
  'RJ',
  'RN',
  'RO',
  'RR',
  'RS',
  'SC',
  'SE',
  'SP',
  'TO',
]);

export function uf(value: unknown): string | null {
  const raw = text(value)?.toUpperCase() ?? null;
  return raw && UFS.has(raw) ? raw : null;
}
