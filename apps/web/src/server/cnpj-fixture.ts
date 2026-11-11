import 'server-only';
import type { CnpjLookup } from '@prospector/application';
import { CnpjRegistryRecord, normalizeCnpj } from '@prospector/contracts';

/**
 * Consulta de CNPJ SINTÉTICA para os testes de ponta a ponta (`PROSPECTOR_CNPJ_LOOKUP=fixture`).
 * Só funciona no modo memória (o container recusa com banco) e não usa a internet. Os CNPJs têm
 * dígitos verificadores válidos, mas os nomes deixam claro que são de teste; tudo o que vier daqui
 * é gravado com a marca de demonstração.
 *
 * - 77.888.999/0001-81: sociedade limitada com nome fantasia;
 * - 66.555.444/0001-00: MEI (a razão social é o "nome da pessoa", também sintético);
 * - 11.222.333/0001-81: simula o serviço fora do ar;
 * - qualquer outro: não encontrado.
 */
const BASE = {
  schemaVersion: 1,
  provider: 'opencnpj',
  status: 'active',
  statusSince: '2020-03-02',
  headquarters: true,
  activityStart: '2020-03-02',
  simples: true,
  city: 'CAMPINAS',
  uf: 'SP',
  providerUpdatedAt: '2026-10-15T00:00:00.000Z',
} as const;

const RECORDS: ReadonlyMap<string, CnpjRegistryRecord> = new Map(
  [
    {
      ...BASE,
      cnpj: '77888999000181',
      legalName: 'EMPRESA SINTETICA DE TESTE LTDA',
      tradeName: 'ATELIE SINTETICO',
      cnaeMain: { code: '7410202', description: 'Design de interiores' },
      cnaeSecondary: ['7319002'],
      legalNature: 'Sociedade Empresária Limitada',
      legalNatureCode: '2062',
      size: 'me',
      isMei: false,
      capitalCents: 5_000_000,
    },
    {
      ...BASE,
      cnpj: '66555444000100',
      legalName: 'PESSOA SINTETICA DE TESTE',
      tradeName: null,
      cnaeMain: { code: '7410299', description: 'Atividades de design não especificadas' },
      cnaeSecondary: [],
      legalNature: 'Empresário (Individual)',
      legalNatureCode: '2135',
      size: 'me',
      isMei: true,
      capitalCents: 100_000,
    },
  ].map((raw) => {
    const record = CnpjRegistryRecord.parse(raw);
    return [record.cnpj, record] as const;
  }),
);

const OUTAGE = '11222333000181';

export const syntheticCnpjLookup: CnpjLookup = {
  async lookup(cnpj) {
    const id = normalizeCnpj(cnpj);
    if (id === OUTAGE) return { ok: false, failure: 'unavailable', provider: 'opencnpj' };
    const record = RECORDS.get(id);
    if (!record) return { ok: false, failure: 'not_found', provider: 'opencnpj' };
    return {
      ok: true,
      record: structuredClone(record),
      fetchedAt: new Date().toISOString(),
      synthetic: true,
    };
  },
};
