import {
  CnpjRegistryRecord,
  type CnpjLookupFailure,
  type CnpjProvider,
} from '@prospector/contracts';
import { z } from 'zod';
import { getJson, type Fetch } from '../http';
import {
  capitalCents,
  cnae,
  companySize,
  flag,
  formatCnae,
  isoDate,
  isoDateTime,
  natureCode,
  registryStatus,
  stripCpf,
  text,
  uf,
} from './normalize';

/**
 * Adaptadores de CNPJ (research/05 §1 e §5). Lemos só os campos que o Prospector guarda; quadro
 * de sócios, e-mail, telefones e endereço de rua chegam na resposta e são descartados aqui, antes
 * de qualquer gravação ou log (regra 7, LGPD).
 */

export type ProviderResult =
  { ok: true; record: CnpjRegistryRecord } | { ok: false; failure: CnpjLookupFailure };

export interface ProviderOptions {
  fetch: Fetch;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface CnpjProviderAdapter {
  readonly id: CnpjProvider;
  fetchRecord(cnpj: string, options: ProviderOptions): Promise<ProviderResult>;
}

const Loose = z.record(z.string(), z.unknown());

function finish(draft: unknown): ProviderResult {
  const parsed = CnpjRegistryRecord.safeParse(draft);
  if (!parsed.success) return { ok: false, failure: 'invalid_response' };
  return { ok: true, record: parsed.data };
}

/** Nome empresarial ou fantasia sem CPF (no MEI, os dois podem trazer o CPF da pessoa). */
function companyName(raw: unknown): string | null {
  const name = text(raw);
  return name ? stripCpf(name) || null : null;
}

/** OpenCNPJ: `GET https://api.opencnpj.org/{cnpj}` — sem chave; 404 quando não existe. */
export const openCnpj: CnpjProviderAdapter = {
  id: 'opencnpj',
  async fetchRecord(cnpj, options) {
    const outcome = await getJson(`https://api.opencnpj.org/${encodeURIComponent(cnpj)}`, options);
    if (outcome.kind !== 'ok') {
      return { ok: false, failure: outcome.kind === 'not_found' ? 'not_found' : outcome.kind };
    }
    const body = Loose.safeParse(outcome.body);
    if (!body.success) return { ok: false, failure: 'invalid_response' };
    const raw = body.data;
    // Pedido de anonimização (LGPD): a OpenCNPJ esvazia os campos; não usamos a reserva.
    if (raw.lgpd_anonimizado === true) return { ok: false, failure: 'anonymized' };
    const mainCode = cnae(raw.cnae_principal);
    const described = Array.isArray(raw.cnaes) ? raw.cnaes : [];
    const mainDescription =
      described
        .map((item) => Loose.safeParse(item))
        .filter((item) => item.success)
        .map((item) => item.data)
        .find((item) => cnae(item.codigo) === mainCode)?.descricao ?? null;
    const secondary = (Array.isArray(raw.cnaes_secundarios) ? raw.cnaes_secundarios : [])
      .map(cnae)
      .filter((code): code is string => code !== null && code !== mainCode)
      .slice(0, 100);
    const isMei = flag(raw.opcao_mei) === true;
    const matriz = text(raw.matriz_filial)?.toLowerCase();
    return finish({
      schemaVersion: 1,
      provider: 'opencnpj',
      cnpj: text(raw.cnpj)?.toUpperCase() ?? cnpj,
      legalName: companyName(raw.razao_social),
      tradeName: companyName(raw.nome_fantasia),
      status: registryStatus(raw.situacao_cadastral),
      statusSince: isoDate(raw.data_situacao_cadastral),
      headquarters: matriz === 'matriz' ? true : matriz === 'filial' ? false : null,
      activityStart: isoDate(raw.data_inicio_atividade),
      cnaeMain: mainCode
        ? { code: formatCnae(mainCode), description: text(mainDescription) }
        : null,
      cnaeSecondary: secondary.map(formatCnae),
      legalNature: text(raw.natureza_juridica),
      legalNatureCode: natureCode(raw.codigo_natureza_juridica),
      size: isMei ? 'me' : companySize(raw.porte_empresa),
      isMei,
      simples: flag(raw.opcao_simples),
      capitalCents: capitalCents(raw.capital_social),
      city: text(raw.municipio),
      uf: uf(raw.uf),
      providerUpdatedAt: isoDateTime(raw.updated_at),
    });
  },
};

/**
 * Minha Receita: `GET https://minhareceita.org/{cnpj}` — sem chave; responde 400 para CNPJ que
 * não existe na base (conferido em 2026-11-10). Reserva da OpenCNPJ (a BrasilAPI é a mesma fonte).
 */
export const minhaReceita: CnpjProviderAdapter = {
  id: 'minhareceita',
  async fetchRecord(cnpj, options) {
    const outcome = await getJson(`https://minhareceita.org/${encodeURIComponent(cnpj)}`, {
      ...options,
      notFoundStatuses: [400, 404],
    });
    if (outcome.kind !== 'ok') {
      return { ok: false, failure: outcome.kind === 'not_found' ? 'not_found' : outcome.kind };
    }
    const body = Loose.safeParse(outcome.body);
    if (!body.success) return { ok: false, failure: 'invalid_response' };
    const raw = body.data;
    const mainCode = cnae(raw.cnae_fiscal);
    const secondary = (Array.isArray(raw.cnaes_secundarios) ? raw.cnaes_secundarios : [])
      .map((item) => {
        const parsed = Loose.safeParse(item);
        return parsed.success ? cnae(parsed.data.codigo) : null;
      })
      .filter((code): code is string => code !== null && code !== mainCode)
      .slice(0, 100);
    const isMei = flag(raw.opcao_pelo_mei) === true;
    const branch = raw.identificador_matriz_filial;
    return finish({
      schemaVersion: 1,
      provider: 'minhareceita',
      cnpj: text(raw.cnpj)?.toUpperCase() ?? cnpj,
      legalName: companyName(raw.razao_social),
      tradeName: companyName(raw.nome_fantasia),
      status:
        registryStatus(raw.situacao_cadastral) ?? registryStatus(raw.descricao_situacao_cadastral),
      statusSince: isoDate(raw.data_situacao_cadastral),
      headquarters: branch === 1 ? true : branch === 2 ? false : null,
      activityStart: isoDate(raw.data_inicio_atividade),
      cnaeMain: mainCode
        ? { code: formatCnae(mainCode), description: text(raw.cnae_fiscal_descricao) }
        : null,
      cnaeSecondary: secondary.map(formatCnae),
      legalNature: text(raw.natureza_juridica),
      legalNatureCode: natureCode(raw.codigo_natureza_juridica),
      size: isMei ? 'me' : companySize(raw.porte),
      isMei,
      simples: flag(raw.opcao_pelo_simples),
      capitalCents: capitalCents(raw.capital_social),
      city: text(raw.municipio),
      uf: uf(raw.uf),
      providerUpdatedAt: null,
    });
  },
};
