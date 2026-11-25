import { COMPANY_CNPJ_KEY, type CnpjRegistryRecord, type Company } from '@prospector/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createCompanyService,
  createEvidenceService,
  type CnpjLookup,
  type CnpjLookupResult,
  type CompanyService,
  type RequestContext,
  type SitePageText,
} from '../src';
import { createMemoryAuditRepository, createMemoryCompanyRepository } from '../src/memory';

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
};

/** Registros SINTÉTICOS (CNPJs de teste com DV válido; nomes de exemplo). */
const BASE: CnpjRegistryRecord = {
  schemaVersion: 1,
  provider: 'opencnpj',
  cnpj: '11222333000181',
  legalName: 'ATELIE EXEMPLO DE MARCENARIA LTDA',
  tradeName: 'ATELIE EXEMPLO',
  status: 'active',
  statusSince: '2015-03-10',
  headquarters: true,
  activityStart: '2015-03-10',
  cnaeMain: { code: '3101-2/00', description: 'Fabricação de móveis com predominância de madeira' },
  cnaeSecondary: [],
  legalNature: 'Sociedade Empresária Limitada',
  legalNatureCode: '2062',
  size: 'epp',
  isMei: false,
  simples: true,
  capitalCents: 15000000,
  city: 'CURITIBA',
  uf: 'PR',
  providerUpdatedAt: '2026-11-01T00:00:00.000Z',
};
const STORE = BASE;
const BRANCH: CnpjRegistryRecord = { ...BASE, cnpj: '11222333000262', headquarters: false };
const AGENCY: CnpjRegistryRecord = {
  ...BASE,
  cnpj: '44555666000181',
  legalName: 'AGENCIA MODELO DIGITAL LTDA',
  tradeName: 'MODELO DIGITAL',
};
const OTHER: CnpjRegistryRecord = {
  ...BASE,
  cnpj: '77888999000181',
  legalName: 'MARCENARIA OUTRA NOME LTDA',
  tradeName: null,
};
const INDIVIDUAL: CnpjRegistryRecord = {
  ...BASE,
  cnpj: '12345678000195',
  legalName: 'MARIA TESTE DA SILVA',
  tradeName: null,
  isMei: true,
  legalNature: 'Empresário (Individual)',
  legalNatureCode: '2135',
};

function fakeLookup(records: CnpjRegistryRecord[], clock: () => Date) {
  const byCnpj = new Map(records.map((record) => [record.cnpj, record]));
  const calls: Array<{ cnpj: string; fresh: boolean }> = [];
  let failure: Extract<CnpjLookupResult, { ok: false }> | null = null;
  const lookup: CnpjLookup = {
    async lookup(cnpj, options) {
      calls.push({ cnpj, fresh: options?.fresh === true });
      if (failure) return failure;
      const record = byCnpj.get(cnpj);
      if (!record) return { ok: false, failure: 'not_found', provider: 'opencnpj' };
      return { ok: true, record: structuredClone(record), fetchedAt: clock().toISOString() };
    },
  };
  return {
    lookup,
    calls,
    fail: (kind: Extract<CnpjLookupResult, { ok: false }>['failure']) => {
      failure = { ok: false, failure: kind, provider: 'opencnpj' };
    },
  };
}

/** O erro de validação que a chamada tem de lançar (falha o teste se ela não recusar). */
async function rejection(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('A chamada deveria ter sido recusada.');
}

function page(text: string, extra: Partial<SitePageText> = {}): SitePageText {
  return {
    url: 'https://atelie-exemplo.test/',
    title: 'Ateliê Exemplo',
    text,
    fetchedAt: '2026-11-25T13:00:00.000Z',
    noArchive: false,
    ...extra,
  };
}

const FOOTER = [
  'Móveis sob medida em Curitiba',
  '© 2026 Ateliê Exemplo - CNPJ: 11.222.333/0001-81',
  'Desenvolvido por Agência Modelo Digital - CNPJ 44.555.666/0001-81',
].join('\n');

describe('CNPJ vinculado depois do cadastro (KI-152)', () => {
  let now: Date;
  let audit: ReturnType<typeof createMemoryAuditRepository>;
  let repo: ReturnType<typeof createMemoryCompanyRepository>;
  let cnpj: ReturnType<typeof fakeLookup>;
  let service: CompanyService;
  let company: Company;

  beforeEach(async () => {
    now = new Date('2026-11-25T13:05:00Z');
    const clock = { now: () => now };
    audit = createMemoryAuditRepository({ clock });
    repo = createMemoryCompanyRepository({ audit, clock });
    cnpj = fakeLookup([STORE, BRANCH, AGENCY, OTHER, INDIVIDUAL], () => now);
    service = createCompanyService({
      companies: repo,
      evidence: repo,
      evidenceService: createEvidenceService({ evidence: repo, clock }),
      cnpjLookup: cnpj.lookup,
      clock,
    });
    const created = await service.createFromDiscovery(ctx, {
      schemaVersion: 1,
      displayName: 'Ateliê Exemplo',
      primaryDomain: 'atelie-exemplo.test',
      city: 'Curitiba',
      uf: 'PR',
    });
    company = created.company;
  });

  describe('lido no site (investigação)', () => {
    it('vincula o CNPJ do rodapé e grava os fatos da Receita, sem o da agência', async () => {
      const result = await service.linkCnpjFromSite(ctx, company.id, [page(FOOTER)]);
      expect(result).toMatchObject({
        status: 'linked',
        cnpj: STORE.cnpj,
        url: 'https://atelie-exemplo.test/',
      });
      // A agência que fez o site nem é consultada.
      expect(cnpj.calls.map((call) => call.cnpj)).toEqual([STORE.cnpj]);

      const dossier = await service.dossier(ctx, company.id);
      expect(dossier.company.cnpj).toBeNull();
      expect(dossier.company).toMatchObject({
        legalName: STORE.legalName,
        cnaeMain: '3101-2/00',
        sizeBand: 'epp',
      });
      expect(dossier.linkedCnpj).toMatchObject({
        cnpj: STORE.cnpj,
        origin: 'company_site',
        url: 'https://atelie-exemplo.test/',
      });
      const keys = dossier.claims.map((view) => view.claim.key);
      expect(keys).toContain(COMPANY_CNPJ_KEY);
      expect(keys).toContain('registry.cnae_main');
      expect(keys).toContain('registry.size');
      const fact = dossier.claims.find((view) => view.claim.key === COMPANY_CNPJ_KEY);
      expect(fact?.claim.statement).toBe(
        'CNPJ da empresa: 11.222.333/0001-81, publicado no site atelie-exemplo.test.',
      );
      expect(fact?.evidence[0]?.source).toMatchObject({
        kind: 'web_page',
        url: 'https://atelie-exemplo.test/',
        excerptText: 'CNPJ: 11.222.333/0001-81',
      });
      expect(fact?.evidence[0]?.evidence.reliabilityTier).toBe('company_owned');
      expect(audit.entries().map((entry) => entry.action)).toContain(
        'prospect.company.cnpj_linked',
      );

      // Já vinculado: a próxima investigação não consulta de novo.
      expect(await service.linkCnpjFromSite(ctx, company.id, [page(FOOTER)])).toEqual({
        status: 'skipped',
        reason: 'has_cnpj',
      });
    });

    it('não vincula CNPJ de outra empresa nem só o de quem fez o site', async () => {
      const other = 'Atendimento: CNPJ 77.888.999/0001-81';
      expect(await service.linkCnpjFromSite(ctx, company.id, [page(other)])).toEqual({
        status: 'skipped',
        reason: 'no_match',
      });
      const agency = 'Site por Agência Modelo Digital - CNPJ 44.555.666/0001-81';
      expect(await service.linkCnpjFromSite(ctx, company.id, [page(agency)])).toEqual({
        status: 'skipped',
        reason: 'third_party_only',
      });
      expect((await service.dossier(ctx, company.id)).claims).toHaveLength(0);
    });

    it('com vários CNPJs, só vincula se exatamente um tiver o nome da empresa', async () => {
      const two = 'Matriz CNPJ 11.222.333/0001-81\nFilial CNPJ 11.222.333/0002-62';
      expect(await service.linkCnpjFromSite(ctx, company.id, [page(two)])).toEqual({
        status: 'skipped',
        reason: 'ambiguous',
      });
      const oneOfTwo = 'Loja CNPJ 11.222.333/0001-81\nFornecedor CNPJ 77.888.999/0001-81';
      expect(await service.linkCnpjFromSite(ctx, company.id, [page(oneOfTwo)])).toMatchObject({
        status: 'linked',
        cnpj: STORE.cnpj,
      });
    });

    it('não lê página que pediu para não guardar cópia nem procura com CNPJ no cadastro', async () => {
      expect(
        await service.linkCnpjFromSite(ctx, company.id, [page(FOOTER, { noArchive: true })]),
      ).toEqual({ status: 'skipped', reason: 'none_found' });
      const withCnpj = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Outra Empresa',
        cnpj: '77.888.999/0001-81',
        primaryDomain: '',
        city: '',
        uf: '',
      });
      expect(await service.linkCnpjFromSite(ctx, withCnpj.company.id, [page(FOOTER)])).toEqual({
        status: 'skipped',
        reason: 'has_cnpj',
      });
      expect(cnpj.calls).toHaveLength(0);
    });

    it('CNPJ que já é de outra empresa cadastrada, ou consulta fora do ar: nada é gravado', async () => {
      await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo Matriz',
        cnpj: STORE.cnpj,
        primaryDomain: '',
        city: '',
        uf: '',
      });
      expect(await service.linkCnpjFromSite(ctx, company.id, [page(FOOTER)])).toEqual({
        status: 'skipped',
        reason: 'duplicate',
      });
      cnpj.fail('unavailable');
      const fresh = await service.createFromDiscovery(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo Filial',
        primaryDomain: 'filial-exemplo.test',
        city: 'Curitiba',
        uf: 'PR',
      });
      expect(
        await service.linkCnpjFromSite(ctx, fresh.company.id, [
          page('CNPJ 11.222.333/0002-62', { url: 'https://filial-exemplo.test/' }),
        ]),
      ).toEqual({ status: 'skipped', reason: 'lookup_failed' });
      expect((await service.dossier(ctx, fresh.company.id)).claims).toHaveLength(0);
    });
  });

  describe('informado por você (dossiê)', () => {
    it('vincula com o nome conferido e permite consultar a Receita de novo', async () => {
      const result = await service.linkCnpj(ctx, {
        companyId: company.id,
        cnpj: '11.222.333/0001-81',
      });
      expect(result).toMatchObject({ status: 'linked', cnpj: STORE.cnpj });
      const dossier = await service.dossier(ctx, company.id);
      expect(dossier.linkedCnpj).toMatchObject({ cnpj: STORE.cnpj, origin: 'user', url: null });
      const fact = dossier.claims.find((view) => view.claim.key === COMPANY_CNPJ_KEY);
      expect(fact?.claim.statement).toBe(
        'CNPJ da empresa: 11.222.333/0001-81, informado por você.',
      );
      expect(fact?.evidence[0]?.source?.kind).toBe('user_note');

      now = new Date('2026-12-26T13:00:00Z');
      const refreshed = await service.refreshFromCnpj(ctx, company.id);
      expect(refreshed.status).not.toBe('failed');
      expect(cnpj.calls.at(-1)).toEqual({ cnpj: STORE.cnpj, fresh: true });
    });

    it('nome diferente na Receita: pede confirmação e só grava com ela', async () => {
      const error = await rejection(
        service.linkCnpj(ctx, { companyId: company.id, cnpj: OTHER.cnpj }),
      );
      expect(error.fieldErrors?.confirmName?.[0]).toContain('"MARCENARIA OUTRA NOME LTDA"');
      expect((await service.dossier(ctx, company.id)).claims).toHaveLength(0);

      const confirmed = await service.linkCnpj(ctx, {
        companyId: company.id,
        cnpj: OTHER.cnpj,
        confirmName: true,
      });
      expect(confirmed.status).toBe('linked');
    });

    it('empresa individual: a conferência não mostra o nome da pessoa', async () => {
      const error = await rejection(
        service.linkCnpj(ctx, { companyId: company.id, cnpj: INDIVIDUAL.cnpj }),
      );
      const message = error.fieldErrors?.confirmName?.[0] ?? '';
      expect(message).toContain('empresa individual');
      expect(message).not.toContain('MARIA');
    });

    it('o CNPJ vinculado vira chave de duplicada e a raiz vale para a supressão (KI-160)', async () => {
      await service.linkCnpj(ctx, { companyId: company.id, cnpj: STORE.cnpj });
      const dossier = await service.dossier(ctx, company.id);
      expect(dossier.company.cnpj).toBeNull();
      expect(dossier.company.cnpjRoot).toBe('11222333');
      expect(
        dossier.identifiers.map(({ kind, valueNormalized, strength, verified }) => ({
          kind,
          valueNormalized,
          strength,
          verified,
        })),
      ).toEqual(
        expect.arrayContaining([
          { kind: 'cnpj', valueNormalized: STORE.cnpj, strength: 'strong', verified: true },
          { kind: 'cnpj_root', valueNormalized: '11222333', strength: 'weak', verified: true },
        ]),
      );
      const added = audit
        .entries()
        .filter((entry) => entry.action === 'prospect.company.identifiers_added');
      expect(added).toHaveLength(2);
      expect(added[0]).toMatchObject({
        entityType: 'company_identifier',
        diff: { companyId: company.id, origin: 'user' },
      });

      // Cadastro novo com o mesmo CNPJ cai na empresa que já o tem vinculado.
      const again = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo de novo',
        cnpj: '11.222.333/0001-81',
        primaryDomain: '',
        city: '',
        uf: '',
      });
      expect(again).toMatchObject({ status: 'duplicate', company: { id: company.id } });
      // E outra empresa não vincula o mesmo CNPJ lido no site.
      const fresh = await service.createFromDiscovery(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo Filial',
        primaryDomain: 'filial-exemplo.test',
        city: 'Curitiba',
        uf: 'PR',
      });
      expect(
        await service.linkCnpjFromSite(ctx, fresh.company.id, [
          page(FOOTER, { url: 'https://filial-exemplo.test/' }),
        ]),
      ).toEqual({ status: 'skipped', reason: 'duplicate' });
    });

    it('CNPJ que outra empresa vinculou no meio do caminho: devolve a duplicada sem gravar fatos', async () => {
      const owner = await service.createFromDiscovery(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo Matriz',
        primaryDomain: 'matriz-exemplo.test',
        city: 'Curitiba',
        uf: 'PR',
      });
      await service.linkCnpj(ctx, { companyId: owner.company.id, cnpj: STORE.cnpj });
      // A primeira busca de duplicada não vê o vínculo (corrida); a gravação da chave vê.
      let misses = 1;
      const racing = createCompanyService({
        companies: {
          ...repo,
          findByStrongIdentifier: async (keys) => {
            if (misses-- > 0) return null;
            return repo.findByStrongIdentifier(keys);
          },
        },
        evidence: repo,
        evidenceService: createEvidenceService({ evidence: repo, clock: { now: () => now } }),
        cnpjLookup: cnpj.lookup,
        clock: { now: () => now },
      });
      expect(await racing.linkCnpj(ctx, { companyId: company.id, cnpj: STORE.cnpj })).toMatchObject(
        { status: 'duplicate', company: { id: owner.company.id } },
      );
      const dossier = await service.dossier(ctx, company.id);
      expect(dossier.claims).toHaveLength(0);
      expect(dossier.linkedCnpj).toBeNull();
      expect(dossier.company.cnpjRoot).toBeNull();
    });

    it('recusa CNPJ inválido, de outra empresa, não encontrado e empresa que já tem CNPJ', async () => {
      await expect(
        service.linkCnpj(ctx, { companyId: company.id, cnpj: '11.222.333/0001-80' }),
      ).rejects.toMatchObject({ code: 'validation' });
      expect(
        await service.linkCnpj(ctx, { companyId: company.id, cnpj: '99.999.999/0001-91' }),
      ).toMatchObject({ status: 'failed', failure: 'not_found' });

      const owner = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Marcenaria Outra Nome',
        cnpj: OTHER.cnpj,
        primaryDomain: '',
        city: '',
        uf: '',
      });
      expect(
        await service.linkCnpj(ctx, { companyId: company.id, cnpj: OTHER.cnpj, confirmName: true }),
      ).toMatchObject({ status: 'duplicate', company: { id: owner.company.id } });
      await expect(
        service.linkCnpj(ctx, { companyId: owner.company.id, cnpj: STORE.cnpj }),
      ).rejects.toMatchObject({ fieldErrors: { cnpj: ['Esta empresa já tem CNPJ no cadastro.'] } });
    });
  });
});
