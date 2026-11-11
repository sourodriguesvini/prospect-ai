import type { CnpjRegistryRecord } from '@prospector/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  companyTools,
  createCompanyService,
  createEvidenceService,
  createToolRegistry,
  type CnpjLookup,
  type CnpjLookupResult,
  type CompanyService,
  type EvidenceService,
  type RequestContext,
} from '../src';
import { createMemoryAuditRepository, createMemoryCompanyRepository } from '../src/memory';

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '7c1e2d3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f',
};

/** Registro SINTÉTICO (CNPJ de teste com DV válido; nomes de exemplo). */
const RECORD: CnpjRegistryRecord = {
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
  cnaeSecondary: ['4754-7/01'],
  legalNature: 'Sociedade Empresária Limitada',
  legalNatureCode: '2062',
  size: 'epp',
  isMei: false,
  simples: true,
  capitalCents: 15000000,
  city: 'CURITIBA',
  uf: 'PR',
  providerUpdatedAt: '2026-11-01T21:47:27.195Z',
};

/** Resposta do provedor; sem `fetchedAt`, vale a hora do relógio do teste. */
type Reply =
  | { ok: true; record: CnpjRegistryRecord; fetchedAt?: string; synthetic?: boolean }
  | Extract<CnpjLookupResult, { ok: false }>;

function fakeLookup(initial: Reply, clock: () => Date) {
  let next = initial;
  const calls: string[] = [];
  const fresh: boolean[] = [];
  const lookup: CnpjLookup = {
    async lookup(cnpj, options) {
      calls.push(cnpj);
      fresh.push(options?.fresh === true);
      const reply = structuredClone(next);
      return reply.ok ? { ...reply, fetchedAt: reply.fetchedAt ?? clock().toISOString() } : reply;
    },
  };
  return { lookup, calls, fresh, respond: (result: Reply) => (next = result) };
}

describe('CompanyService (M2)', () => {
  let now: Date;
  let audit: ReturnType<typeof createMemoryAuditRepository>;
  let repo: ReturnType<typeof createMemoryCompanyRepository>;
  let cnpj: ReturnType<typeof fakeLookup>;
  let evidence: EvidenceService;
  let service: CompanyService;
  const actions = () => audit.entries().map((entry) => entry.action);

  beforeEach(() => {
    now = new Date('2026-11-10T12:00:00Z');
    const clock = { now: () => now };
    audit = createMemoryAuditRepository({ clock });
    repo = createMemoryCompanyRepository({ audit, clock });
    cnpj = fakeLookup({ ok: true, record: RECORD }, () => now);
    evidence = createEvidenceService({ evidence: repo, clock });
    service = createCompanyService({
      companies: repo,
      evidence: repo,
      evidenceService: evidence,
      cnpjLookup: cnpj.lookup,
      clock,
    });
  });

  describe('cadastro manual', () => {
    it('cria a empresa com as chaves de deduplicação e uma linha de auditoria', async () => {
      const result = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo',
        cnpj: '11.222.333/0001-81',
        primaryDomain: 'https://www.atelie-exemplo.test/contato',
        city: 'Curitiba',
        uf: 'PR',
      });
      expect(result.status).toBe('created');
      expect(result.company).toMatchObject({
        displayName: 'Ateliê Exemplo',
        cnpj: '11222333000181',
        cnpjRoot: '11222333',
        primaryDomain: 'atelie-exemplo.test',
        lifecycle: 'candidate',
        origin: 'manual',
        isDemo: false,
      });
      const keys = await repo.identifiers(result.company.id);
      expect(keys.map((key) => `${key.kind}:${key.strength}:${key.verified}`).sort()).toEqual([
        'cnpj:strong:false',
        'cnpj_root:weak:false',
        'domain:strong:false',
      ]);
      expect(audit.entries()).toEqual([
        expect.objectContaining({
          action: 'prospect.company.created',
          entityType: 'company',
          entityId: result.company.id,
          traceId: ctx.traceId,
          diff: { origin: 'manual' },
        }),
      ]);
      // Cadastro manual não consulta a Receita nem grava fatos.
      expect(cnpj.calls).toEqual([]);
      expect(await repo.claimsFor('company', result.company.id)).toEqual([]);
    });

    it('mesmo CNPJ ou domínio devolve a empresa existente, sem gravar', async () => {
      const first = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo',
        cnpj: '11222333000181',
      });
      const byCnpj = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Outro nome',
        cnpj: '11.222.333/0001-81',
      });
      expect(byCnpj).toEqual({ status: 'duplicate', company: first.company });
      await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Com site',
        primaryDomain: 'exemplo.test',
      });
      const byDomain = await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Mesmo site',
        primaryDomain: 'www.exemplo.test',
      });
      expect(byDomain.status).toBe('duplicate');
      expect(actions()).toEqual(['prospect.company.created', 'prospect.company.created']);
    });

    it('CNPJ com dígito errado é recusado no campo', async () => {
      await expect(
        service.create(ctx, { schemaVersion: 1, displayName: 'X Ltda', cnpj: '11222333000182' }),
      ).rejects.toMatchObject({ code: 'validation', fieldErrors: { cnpj: expect.any(Array) } });
    });
  });

  describe('importar pelo CNPJ', () => {
    it('cria a empresa com uma fonte e um fato por campo, tudo de uma vez', async () => {
      const result = await service.importFromCnpj(ctx, { cnpj: '11.222.333/0001-81' });
      expect(result.status).toBe('created');
      if (result.status !== 'created') return;
      const { company } = result;
      expect(company).toMatchObject({
        displayName: 'ATELIE EXEMPLO',
        legalName: 'ATELIE EXEMPLO DE MARCENARIA LTDA',
        cnpj: '11222333000181',
        city: 'CURITIBA',
        uf: 'PR',
        cnaeMain: '3101-2/00',
        sizeBand: 'epp',
        origin: 'cnpj_lookup',
        lastInvestigatedAt: now.toISOString(),
      });
      expect(cnpj.calls).toEqual(['11222333000181']);

      const dossier = await service.dossier(ctx, company.id);
      expect(dossier.claims.length).toBeGreaterThanOrEqual(10);
      expect(dossier.summary).toMatchObject({ facts: dossier.claims.length, stale: 0 });
      const sources = new Set(dossier.claims.flatMap((c) => c.evidence.map((e) => e.source?.id)));
      expect(sources.size).toBe(1);
      for (const view of dossier.claims) {
        expect(view.claim.epistemicType).toBe('fact');
        expect(view.claim.key).toMatch(/^registry\./);
        expect(view.status).toBe('active');
        const [item] = view.evidence;
        expect(item?.evidence.quoteVerified).toBe(true);
        // Provedor não oficial: agregador pela regra do doc 08 §2.2 (decisão pendente, doc 14).
        expect(item?.evidence.reliabilityTier).toBe('aggregator');
        expect(view.claim.confidence).toBe(0.6);
        expect(view.band).toBe('medium');
        expect(item?.source).toMatchObject({
          kind: 'api_record',
          provider: 'opencnpj',
          externalRef: '11222333000181',
          url: 'https://api.opencnpj.org/11222333000181',
          capturedAt: now.toISOString(),
        });
        expect(item?.source?.excerptText).toContain(item?.evidence.quote ?? '?');
      }
      const capital = dossier.claims.find((c) => c.claim.key === 'registry.share_capital');
      expect(capital?.claim.domain).toBe('financial_proxy');
      // Vence em 2× a validade do domínio (firmográfico: 90 dias → 180), regra do doc 08 §2.3.
      const status = dossier.claims.find((c) => c.claim.key === 'registry.status');
      expect(status?.claim.validUntil).toBe('2027-05-09T12:00:00.000Z');

      // Uma linha de auditoria para a operação inteira, sem conteúdo do cadastro.
      expect(audit.entries()).toEqual([
        expect.objectContaining({
          action: 'prospect.company.created',
          entityId: company.id,
          diff: { origin: 'cnpj_lookup', provider: 'opencnpj', claims: dossier.claims.length },
        }),
      ]);
      expect(JSON.stringify(audit.entries())).not.toContain('MARCENARIA');
    });

    it('a data da coleta é a da resposta do provedor, e a fonte tem prazo de guarda', async () => {
      cnpj.respond({ ok: true, record: RECORD, fetchedAt: '2026-11-09T08:00:00.000Z' });
      const result = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (result.status !== 'created') throw new Error('esperava criar');
      expect(result.company.lastInvestigatedAt).toBe('2026-11-09T08:00:00.000Z');
      const dossier = await service.dossier(ctx, result.company.id);
      expect(dossier.claims[0]?.evidence[0]?.source).toMatchObject({
        capturedAt: '2026-11-09T08:00:00.000Z',
        retentionUntil: '2027-11-09T08:00:00.000Z',
      });
    });

    it('registro sintético (consulta de teste) vira empresa, fonte e fatos marcados DEMO', async () => {
      cnpj.respond({ ok: true, record: RECORD, synthetic: true });
      const result = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (result.status !== 'created') throw new Error('esperava criar');
      expect(result.company.isDemo).toBe(true);
      const dossier = await service.dossier(ctx, result.company.id);
      expect(dossier.claims.every((view) => view.claim.isDemo)).toBe(true);
      expect(dossier.claims[0]?.evidence[0]?.source?.isDemo).toBe(true);
    });

    it('MEI: o nome da pessoa fica só no cadastro, fora de fontes e fatos', async () => {
      cnpj.respond({
        ok: true,
        record: {
          ...RECORD,
          legalName: 'MARIA EXEMPLO',
          tradeName: null,
          legalNature: 'Empresário (Individual)',
          legalNatureCode: '2135',
          isMei: true,
          size: 'me',
        },
      });
      const result = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (result.status !== 'created') throw new Error('esperava criar');
      expect(result.company).toMatchObject({ legalName: 'MARIA EXEMPLO' });
      const dossier = await service.dossier(ctx, result.company.id);
      const ledger = JSON.stringify(
        dossier.claims.map((view) => [
          view.claim,
          view.evidence.map((e) => [e.evidence, e.source]),
        ]),
      );
      expect(ledger).not.toContain('MARIA');
      expect(dossier.claims.map((view) => view.claim.key)).not.toContain('registry.legal_name');
      expect(dossier.individual).toBe(true);
    });

    it('nome de exibição escolhido na tela vale sobre o nome fantasia', async () => {
      const result = await service.importFromCnpj(ctx, {
        cnpj: '11222333000181',
        displayName: '  Ateliê Exemplo ',
      });
      expect(result.status === 'created' && result.company.displayName).toBe('Ateliê Exemplo');
    });

    it('CNPJ inválido no cadastro pelo CNPJ aponta o campo e não consulta', async () => {
      await expect(
        service.importFromCnpj(ctx, { cnpj: '11.222.333/0001-82' }),
      ).rejects.toMatchObject({
        code: 'validation',
        fieldErrors: { cnpj: expect.any(Array) },
      });
      expect(cnpj.calls).toEqual([]);
    });

    it('CNPJ já cadastrado não consulta de novo nem grava', async () => {
      const first = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      const again = await service.importFromCnpj(ctx, { cnpj: '11.222.333/0001-81' });
      expect(again.status).toBe('duplicate');
      expect(first.status === 'created' && again.status === 'duplicate').toBe(true);
      expect(cnpj.calls).toHaveLength(1);
      expect(actions()).toEqual(['prospect.company.created']);
    });

    it('falha da consulta vira mensagem em pt-BR e nada é gravado', async () => {
      cnpj.respond({ ok: false, failure: 'not_found', provider: 'opencnpj' });
      const result = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      expect(result).toEqual({
        status: 'failed',
        failure: 'not_found',
        message: expect.stringContaining('Receita'),
      });
      expect(await service.list(ctx)).toEqual([]);
      expect(audit.entries()).toEqual([]);
    });

    it('sem consulta configurada: indisponível, com a saída de cadastrar à mão', async () => {
      const offline = createCompanyService({
        companies: repo,
        evidence: repo,
        evidenceService: evidence,
        cnpjLookup: null,
      });
      const preview = await offline.lookupCnpj(ctx, '11222333000181');
      expect(preview).toMatchObject({ ok: false, failure: 'unavailable' });
      expect(!preview.ok && preview.message).toMatch(/à mão/);
    });

    it('a prévia não grava nada e avisa se o CNPJ já está cadastrado', async () => {
      const preview = await service.lookupCnpj(ctx, '11.222.333/0001-81');
      expect(preview).toMatchObject({
        ok: true,
        existing: null,
        record: { cnpj: '11222333000181' },
      });
      expect(audit.entries()).toEqual([]);
      await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      const again = await service.lookupCnpj(ctx, '11222333000181');
      expect(again.ok && again.existing?.cnpj).toBe('11222333000181');
    });
  });

  describe('nova consulta', () => {
    it('fatos novos substituem os anteriores da mesma chave; o histórico fica guardado', async () => {
      const created = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (created.status !== 'created') throw new Error('esperava criar');
      const before = await service.dossier(ctx, created.company.id);

      now = new Date('2026-12-10T12:00:00Z');
      cnpj.respond({
        ok: true,
        record: { ...RECORD, city: 'SAO JOSE DOS PINHAIS', capitalCents: 30000000 },
      });
      const refreshed = await service.refreshFromCnpj(ctx, created.company.id);
      expect(refreshed).toMatchObject({
        status: 'updated',
        claims: before.claims.length,
        superseded: before.claims.length,
        changed: 2,
        company: { city: 'SAO JOSE DOS PINHAIS', lastInvestigatedAt: now.toISOString() },
      });
      // A nova consulta pedida pelo usuário não usa o cache.
      expect(cnpj.fresh).toEqual([false, true]);

      const after = await service.dossier(ctx, created.company.id);
      expect(after.claims).toHaveLength(before.claims.length);
      expect(after.historyCount).toBe(before.claims.length);
      const capital = after.claims.find((c) => c.claim.key === 'registry.share_capital');
      expect(capital?.claim.statement).toBe('Capital social declarado: R$ 300.000,00.');
      expect(capital?.claim.supersedesId).toBe(
        before.claims.find((c) => c.claim.key === 'registry.share_capital')?.claim.id,
      );
      expect(actions()).toEqual([
        'prospect.company.created',
        'prospect.company.registry_refreshed',
      ]);
      expect(audit.entries()[1]?.diff).toEqual({
        claims: before.claims.length,
        sources: 1,
        superseded: before.claims.length,
      });
    });

    it('mesmo conteúdo da última consulta: nada é gravado nem auditado', async () => {
      const created = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (created.status !== 'created') throw new Error('esperava criar');
      const firstAt = now.toISOString();
      now = new Date('2026-11-11T09:00:00Z');
      const refreshed = await service.refreshFromCnpj(ctx, created.company.id);
      expect(refreshed).toMatchObject({
        status: 'unchanged',
        checkedAt: now.toISOString(),
        lastCapturedAt: firstAt,
      });
      const dossier = await service.dossier(ctx, created.company.id);
      expect(dossier.historyCount).toBe(0);
      expect(actions()).toEqual(['prospect.company.created']);
    });

    it('dado que sumiu do registro tira a versão antiga de cena', async () => {
      const created = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (created.status !== 'created') throw new Error('esperava criar');
      cnpj.respond({ ok: true, record: { ...RECORD, tradeName: null } });
      const refreshed = await service.refreshFromCnpj(ctx, created.company.id);
      expect(refreshed).toMatchObject({ status: 'updated', changed: 1 });
      const after = await service.dossier(ctx, created.company.id);
      const trade = after.claims.find((c) => c.claim.key === 'registry.trade_name');
      expect(trade?.claim.value).toEqual({ informed: false });
      expect(trade?.evidence[0]?.evidence.quoteVerified).toBe(true);
    });

    it('registro de outro CNPJ que não o pedido é recusado sem gravar', async () => {
      const created = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (created.status !== 'created') throw new Error('esperava criar');
      cnpj.respond({ ok: true, record: { ...RECORD, cnpj: '77888999000181' } });
      const refreshed = await service.refreshFromCnpj(ctx, created.company.id);
      expect(refreshed).toMatchObject({ status: 'failed', failure: 'invalid_response' });
      // A empresa já existe: a mensagem não manda cadastrar à mão.
      expect(refreshed.status === 'failed' && refreshed.message).toMatch(/continuam como estavam/);
      expect(actions()).toEqual(['prospect.company.created']);
    });

    it('empresa arquivada ou sem CNPJ não é consultada', async () => {
      const manual = await service.create(ctx, { schemaVersion: 1, displayName: 'Sem CNPJ' });
      await expect(service.refreshFromCnpj(ctx, manual.company.id)).rejects.toMatchObject({
        code: 'validation',
      });
      const imported = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (imported.status !== 'created') throw new Error('esperava criar');
      await service.changeLifecycle(ctx, { companyId: imported.company.id, lifecycle: 'archived' });
      await expect(service.refreshFromCnpj(ctx, imported.company.id)).rejects.toMatchObject({
        reason: 'company_archived',
      });
      expect(cnpj.calls).toHaveLength(1);
    });
  });

  describe('ciclo de vida e lista', () => {
    it('troca o ciclo de vida com auditoria; repetir não grava', async () => {
      const { company } = await service.create(ctx, { schemaVersion: 1, displayName: 'Loja X' });
      const changed = await service.changeLifecycle(ctx, {
        companyId: company.id,
        lifecycle: 'investigating',
      });
      expect(changed.lifecycle).toBe('investigating');
      await service.changeLifecycle(ctx, { companyId: company.id, lifecycle: 'investigating' });
      expect(audit.entries().at(-1)).toMatchObject({
        action: 'prospect.company.lifecycle_changed',
        diff: { from: 'candidate', to: 'investigating' },
      });
      expect(actions()).toHaveLength(2);
      await expect(
        service.changeLifecycle(ctx, { companyId: company.id, lifecycle: 'vendida' }),
      ).rejects.toBeInstanceOf(AppError);
    });

    it('busca por nome sem acento, por CNPJ e esconde arquivadas', async () => {
      await service.create(ctx, {
        schemaVersion: 1,
        displayName: 'Ateliê Exemplo',
        cnpj: '11222333000181',
      });
      const other = await service.create(ctx, { schemaVersion: 1, displayName: 'Clínica Exemplo' });
      expect((await service.list(ctx, { search: 'atelie' })).map((c) => c.displayName)).toEqual([
        'Ateliê Exemplo',
      ]);
      expect((await service.list(ctx, { search: '11.222.333' })).map((c) => c.displayName)).toEqual(
        ['Ateliê Exemplo'],
      );
      await service.changeLifecycle(ctx, { companyId: other.company.id, lifecycle: 'archived' });
      expect((await service.list(ctx)).map((c) => c.displayName)).toEqual(['Ateliê Exemplo']);
      expect(await service.list(ctx, { includeArchived: true })).toHaveLength(2);
    });

    it('dossiê de empresa inexistente ou id inválido: não encontrado', async () => {
      await expect(
        service.dossier(ctx, '00000000-0000-4000-8000-000000000000'),
      ).rejects.toMatchObject({
        code: 'not_found',
      });
      await expect(service.dossier(ctx, '../x')).rejects.toMatchObject({ code: 'not_found' });
    });
  });

  describe('EvidenceService', () => {
    async function company() {
      const created = await service.importFromCnpj(ctx, { cnpj: '11222333000181' });
      if (created.status !== 'created') throw new Error('esperava criar');
      const dossier = await service.dossier(ctx, created.company.id);
      return { id: created.company.id, dossier };
    }

    it('inferência apoiada em fato do ledger, com fator limitado e uma linha de auditoria', async () => {
      const { id, dossier } = await company();
      const fact = dossier.claims.find((c) => c.claim.key === 'registry.size');
      const batch = await evidence.record(
        ctx,
        id,
        {
          claims: [
            {
              id: '0d1e2f3a-4b5c-4d6e-8f7a-8b9c0d1e2f3a',
              claim: {
                schemaVersion: 1,
                subjectType: 'company',
                subjectId: id,
                domain: 'firmographic',
                key: 'size.estimate',
                statement: 'Empresa de pequeno porte, provavelmente com menos de 50 pessoas.',
                epistemicType: 'inference',
                dependsOn: [fact?.claim.id ?? ''],
                reasoning: 'EPP na Receita costuma ter equipe pequena.',
                reasoningFactor: 0.95,
              },
            },
          ],
        },
        { action: 'prospect.evidence.recorded' },
      );
      const [claim] = batch.claims;
      // 0,6 (fato de agregador) × fator limitado a 0,9.
      expect(claim).toMatchObject({ reasoningFactor: 0.9, confidence: 0.54, status: 'active' });
      expect(batch.dependencies).toEqual([
        { claimId: claim?.id, dependsOnClaimId: fact?.claim.id },
      ]);
      expect(actions().at(-1)).toBe('prospect.evidence.recorded');
      expect((await service.dossier(ctx, id)).summary.inferences).toBe(1);
    });

    it('trecho que não está na fonte, claim de outra empresa e chave trocada são recusados', async () => {
      const { id, dossier } = await company();
      const sourceId = dossier.claims[0]?.evidence[0]?.source?.id ?? '';
      const base = {
        schemaVersion: 1 as const,
        subjectType: 'company' as const,
        subjectId: id,
        domain: 'firmographic' as const,
        key: 'registry.legal_name',
        statement: 'Faturamento anual acima de 10 milhões.',
        epistemicType: 'fact' as const,
        evidence: [{ sourceId, quote: 'Faturamento: R$ 10 milhões' }],
      };
      const attempt = (claim: typeof base, supersedes?: string) =>
        evidence.record(
          ctx,
          id,
          { claims: [{ id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d', claim, supersedes }] },
          { action: 'prospect.evidence.recorded' },
        );
      await expect(attempt(base)).rejects.toMatchObject({
        code: 'validation',
        fieldErrors: { 'claims.0.evidence.0.quote': [expect.stringContaining('não aparece')] },
      });
      await expect(
        attempt({ ...base, subjectId: '9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f' }),
      ).rejects.toMatchObject({ fieldErrors: { 'claims.0.subjectId': expect.any(Array) } });
      const legal = dossier.claims.find((c) => c.claim.key === 'registry.legal_name');
      await expect(
        attempt(
          { ...base, key: 'registry.trade_name', evidence: [{ sourceId, quote: 'Razão social:' }] },
          legal?.claim.id,
        ),
      ).rejects.toMatchObject({ fieldErrors: { 'claims.0.supersedes': expect.any(Array) } });
      expect(actions()).toEqual(['prospect.company.created']);
    });

    it('substituir um claim que outra gravação já substituiu: conflito, nada gravado', async () => {
      const { id, dossier } = await company();
      const legal = dossier.claims.find((c) => c.claim.key === 'registry.legal_name');
      const sourceId = legal?.evidence[0]?.source?.id ?? '';
      const draft = (claimId: string) => ({
        claims: [
          {
            id: claimId,
            supersedes: legal?.claim.id ?? null,
            claim: {
              schemaVersion: 1 as const,
              subjectType: 'company' as const,
              subjectId: id,
              domain: 'firmographic' as const,
              key: 'registry.legal_name',
              statement: 'Razão social: ATELIE EXEMPLO DE MARCENARIA LTDA.',
              epistemicType: 'fact' as const,
              evidence: [{ sourceId, quote: 'Razão social: ATELIE EXEMPLO DE MARCENARIA LTDA' }],
            },
          },
        ],
      });
      const prepared = await evidence.prepare(
        { companyId: id },
        draft('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e'),
      );
      await evidence.record(ctx, id, draft('3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f'), {
        action: 'prospect.evidence.recorded',
      });
      await expect(
        repo.record(id, {}, prepared, {
          actorType: 'user',
          actorLabel: null,
          traceId: ctx.traceId,
          action: 'prospect.evidence.recorded',
          entityType: 'company',
          entityId: id,
          diff: {},
          withVersion: false,
        }),
      ).rejects.toMatchObject({ code: 'conflict', reason: 'concurrent_change' });
      expect(actions()).toEqual(['prospect.company.created', 'prospect.evidence.recorded']);
    });
  });

  describe('ferramentas do Copiloto', () => {
    it('list_companies e get_company_dossier devolvem tipo, confiança e fonte', async () => {
      const recorded: unknown[] = [];
      const registry = createToolRegistry({
        tools: companyTools({ companies: service }),
        // Só o que a telemetria grava importa aqui.
        telemetry: {
          recordToolCall: async (call: unknown) => void recorded.push(call),
        } as never,
      });
      expect(registry.specs().map((spec) => spec.name)).toEqual([
        'list_companies',
        'get_company_dossier',
      ]);
      const empty = await registry.execute(ctx, {
        id: 'c1',
        name: 'list_companies',
        arguments: {},
      });
      expect(empty.result).toMatchObject({
        status: 'ok',
        summary: 'Nenhuma empresa cadastrada ainda.',
      });

      await service.importFromCnpj(ctx, { cnpj: '11222333000181', displayName: 'Ateliê Exemplo' });
      const listed = await registry.execute(ctx, {
        id: 'c2',
        name: 'list_companies',
        arguments: { busca: 'atelie' },
      });
      expect(listed.result.summary).toBe('1 empresa para "atelie".');
      expect(listed.forModel).toContain('11.222.333/0001-81');

      const dossier = await registry.execute(ctx, {
        id: 'c3',
        name: 'get_company_dossier',
        arguments: { empresa: 'ateliê exemplo' },
      });
      expect(dossier.result.status).toBe('ok');
      // A telemetria (só inclusão) guarda o tipo da referência e contagens, nunca o nome.
      expect(recorded).toHaveLength(3);
      expect(JSON.stringify(recorded)).not.toMatch(/ateli/i);
      expect(recorded[2]).toMatchObject({
        inputRedacted: { empresa: '[nome]' },
        outputSummary: expect.stringMatching(/^Dossiê: /),
      });
      expect(dossier.result.refs).toEqual([
        expect.objectContaining({ kind: 'company', label: 'Ateliê Exemplo' }),
      ]);
      const data = JSON.parse(dossier.forModel) as {
        dados: { registros: Array<{ tipo: string; confianca: string; fonte: string }> };
      };
      expect(data.dados.registros[0]).toMatchObject({
        tipo: 'fato',
        confianca: 'Média',
        fonte: 'Cadastro do CNPJ 11.222.333/0001-81',
      });

      const missing = await registry.execute(ctx, {
        id: 'c4',
        name: 'get_company_dossier',
        arguments: { empresa: 'Padaria Inexistente' },
      });
      expect(missing.result).toMatchObject({ status: 'error', errorCode: 'not_found' });
    });
  });
});
