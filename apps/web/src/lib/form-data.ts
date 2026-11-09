/**
 * Conversões entre campos de formulário (texto) e entradas dos contratos. Valores que não dá
 * para converter seguem como texto, para o contrato recusar com mensagem em pt-BR no campo certo.
 */

export type FormValues = Record<string, string | string[]>;

/**
 * Teto por campo, bem acima de qualquer limite dos contratos: o excesso é cortado antes de
 * qualquer conversão (o contrato ainda recusa pelo tamanho, com mensagem no campo).
 */
const MAX_FIELD_LENGTH = 100_000;

/** Todos os campos enviados (sem os internos do Next), para reexibir o que a pessoa digitou. */
export function formValues(formData: FormData): FormValues {
  const values: FormValues = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith('$')) continue;
    const all = formData
      .getAll(key)
      .filter((v): v is string => typeof v === 'string')
      .map((v) => v.slice(0, MAX_FIELD_LENGTH));
    values[key] = all.length === 1 ? (all[0] ?? '') : all;
  }
  return values;
}

export function text(values: FormValues, name: string): string {
  const value = values[name];
  return typeof value === 'string' ? value : (value?.[0] ?? '');
}

/** Campos de marcar com o mesmo nome (checkbox group). */
export function all(values: FormValues, name: string): string[] {
  const value = values[name];
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

export function checked(values: FormValues, name: string): boolean {
  return all(values, name).includes('on');
}

/** Um item por linha; linhas em branco são ignoradas. */
export function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function joinLines(items: readonly string[]): string {
  return items.join('\n');
}

/** Inteiro opcional: vazio → null; não numérico segue como texto (o contrato recusa). */
export function optionalInt(value: string): number | null | string {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

export function requiredInt(value: string): number | string {
  const trimmed = value.trim();
  return /^-?\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
}

/**
 * Valor em reais (pt-BR: "15.000,00", "15000", "1.500") → centavos. Vazio → null.
 * Formato irreconhecível segue como texto para o contrato recusar.
 */
export function brlToCents(value: string): number | null | string {
  const trimmed = value.replace(/R\$/i, '').replace(/\s/g, '');
  if (trimmed === '') return null;
  let normalized: string;
  if (/^\d{1,3}(\.\d{3})*(,\d{1,2})?$/.test(trimmed) || /^\d+(,\d{1,2})?$/.test(trimmed)) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else {
    return value.trim();
  }
  return Math.round(Number(normalized) * 100);
}

const BRL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Centavos → texto editável em reais ("15.000,00"); null → vazio. */
export function centsToBrl(cents: number | null): string {
  return cents === null ? '' : BRL.format(cents / 100);
}

/**
 * "Curitiba/PR" ou "Curitiba - PR" → { name, uf }. Sem UF reconhecível, a UF fica vazia.
 * Feito com cortes de texto, sem expressão regular sobre a linha inteira (evita ReDoS).
 */
export function parseMunicipality(line: string): { name: string; uf: string } {
  const trimmed = line.trim();
  const uf = trimmed.slice(-2);
  const rest = trimmed.slice(0, -2).trimEnd();
  const separator = rest.at(-1);
  if (!/^[A-Za-z]{2}$/.test(uf) || (separator !== '/' && separator !== '-')) {
    return { name: trimmed, uf: '' };
  }
  return { name: rest.slice(0, -1).trim(), uf: uf.toUpperCase() };
}

export function formatMunicipality(m: { name: string; uf: string }): string {
  return `${m.name}/${m.uf}`;
}
