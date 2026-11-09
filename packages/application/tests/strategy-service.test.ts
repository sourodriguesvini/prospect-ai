import type { OfferContentInput } from '@prospector/contracts';
import { DRAFT_BRANDING_RUBRIC, DRAFT_LIA, DRAFT_SCORING_MODEL } from '@prospector/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createAuditService,
  createStrategyService,
  type RequestContext,
  type StrategyService,
} from '../src';
import {
  createMemoryAuditRepository,
  createMemoryStrategyRepository,
  type MemoryStrategyRepository,
} from '../src/memory';
import { seedStrategyDemo } from './support/demo-seed';

const ctx: RequestContext = { actor: { type: 'user' }, traceId: 'trace-f2' };

const completeOffer: OfferContentInput = {
  name: 'Identidade visual para clínicas',
  problems: ['Marca desatualizada'],
  needSignals: ['Site sem versão mobile'],
  disqualifiers: ['Rebrand nos últimos 12 meses'],
  deliverables: ['Manual de marca'],
  priceMinCents: 1_500_000,
  priceMaxCents: 4_000_000,
};

const icp = {
  name: 'Clínicas em Curitiba',
  filters: { cnaes: ['8630-5/04'], ufs: ['PR'] },
  exclusions: {},
};

/** Captura o AppError lançado (falha se nada for lançado). */
async function appError(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('Esperava AppError, mas a operação foi aceita.');
}

describe('StrategyService', () => {
  let now: Date;
  let repo: MemoryStrategyRepository;
  let auditRepo: ReturnType<typeof createMemoryAuditRepository>;
  let service: StrategyService;
  const actions = () => auditRepo.entries().map((e) => e.action);

  beforeEach(() => {
    now = new Date('2026-11-09T15:00:00Z');
    const clock = { now: () => now };
    repo = createMemoryStrategyRepository({ clock });
    auditRepo = createMemoryAuditRepository({ clock });
    service = createStrategyService({ repo, audit: createAuditService(auditRepo), clock });
  });

  async function readyOffer() {
    const offer = await service.createOffer(ctx, completeOffer);
    await service.saveRubric(ctx, offer.id, DRAFT_BRANDING_RUBRIC);
    await service.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL);
    await service.changeOfferStatus(ctx, offer.id, 'active');
    const profile = await service.createIcp(ctx, offer.id, icp);
    await service.changeIcpStatus(ctx, profile.id, 'active');
    return { offer, profile };
  }

  async function approvedLia() {
    const { value } = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Prevalece.' });
    return service.approveLia(ctx, value.id, { reviewDueOn: '2027-11-09', confirmed: true });
  }

  async function compliancePieces() {
    await service.saveVoiceGuide(ctx, { summary: 'Direta, cordial e sem jargão.' });
    await service.saveContactPolicy(ctx, {
      agencyName: 'Agência',
      privacyContact: 'privacidade@agencia.example',
      optOutText: 'Responda "remover" para não receber mais mensagens.',
    });
  }

  describe('ofertas e versões', () => {
    it('cria a oferta em rascunho com a versão 1 e audita sem o conteúdo', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      expect(offer.status).toBe('draft');
      expect(offer.current?.version).toBe(1);
      const [entry] = auditRepo.entries();
      expect(entry).toMatchObject({
        action: 'strategy.offer.created',
        entityId: offer.id,
        diff: { version: 1 },
        traceId: 'trace-f2',
      });
      expect(JSON.stringify(entry?.diff)).not.toContain('clínicas');
    });

    it('editar cria nova versão e a anterior fica igual; salvar sem mudança não cria versão', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const v1 = offer.current;
      const edited = await service.updateOffer(ctx, offer.id, { ...completeOffer, name: 'Novo' });
      expect(edited).toMatchObject({ changed: true, value: { version: 2 } });
      const same = await service.updateOffer(ctx, offer.id, { ...completeOffer, name: 'Novo' });
      expect(same).toMatchObject({ changed: false, value: { version: 2 } });
      const { versions } = await service.offerDetail(ctx, offer.id);
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[1]).toEqual(v1);
      expect(actions()).toEqual(['strategy.offer.created', 'strategy.offer.versioned']);
    });

    it('recusa faixa de investimento invertida e item repetido, apontando o campo', async () => {
      const error = await appError(
        service.createOffer(ctx, {
          ...completeOffer,
          problems: ['Marca antiga', 'marca  ANTIGA'],
          priceMinCents: 10,
          priceMaxCents: 5,
        }),
      );
      expect(error.code).toBe('validation');
      expect(Object.keys(error.fieldErrors ?? {}).sort()).toEqual(['priceMaxCents', 'problems']);
      expect(actions()).toEqual([]);
    });

    it('só ativa com conteúdo completo, rubrica e modelo de score', async () => {
      const offer = await service.createOffer(ctx, { name: 'Só o nome' });
      const blocked = await appError(service.changeOfferStatus(ctx, offer.id, 'active'));
      expect(blocked.reason).toBe('activation_blocked');
      expect(blocked.fieldErrors?._form).toHaveLength(3);

      await service.updateOffer(ctx, offer.id, completeOffer);
      await service.saveRubric(ctx, offer.id, DRAFT_BRANDING_RUBRIC);
      await service.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL);
      await service.changeOfferStatus(ctx, offer.id, 'active');
      expect((await service.offerDetail(ctx, offer.id)).offer.status).toBe('active');
      expect(auditRepo.entries().at(-1)).toMatchObject({
        action: 'strategy.offer.status_changed',
        diff: { from: 'draft', to: 'active' },
      });
    });

    it('oferta ativa não perde itens obrigatórios numa edição', async () => {
      const { offer } = await readyOffer();
      const error = await appError(
        service.updateOffer(ctx, offer.id, { ...completeOffer, disqualifiers: [] }),
      );
      expect(error.reason).toBe('offer_active_incomplete');
      expect(error.fieldErrors?._form).toEqual(['Falta: desqualificadores.']);
    });

    it('transição de status inválida e oferta inexistente', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      await service.changeOfferStatus(ctx, offer.id, 'archived');
      expect((await appError(service.changeOfferStatus(ctx, offer.id, 'active'))).reason).toBe(
        'invalid_status_change',
      );
      expect(
        (await appError(service.offerDetail(ctx, '00000000-0000-4000-8000-000000000000'))).code,
      ).toBe('not_found');
    });
  });

  describe('rubrica e modelo de score', () => {
    it('recusa pesos que não somam 100 com mensagem no campo da lista', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const [first, ...rest] = DRAFT_BRANDING_RUBRIC.criteria;
      const error = await appError(
        service.saveRubric(ctx, offer.id, { criteria: [{ ...first!, weight: 10 }, ...rest] }),
      );
      expect(error.fieldErrors?.criteria).toEqual([
        'Os pesos somam 90; precisam somar exatamente 100.',
      ]);
      expect(await repo.listRubricVersions(offer.id)).toEqual([]);
    });

    it('erro de contrato aponta o caminho completo do campo', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const error = await appError(
        service.saveRubric(ctx, offer.id, {
          criteria: [{ ...DRAFT_BRANDING_RUBRIC.criteria[0]!, weight: 150 }],
        }),
      );
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(['criteria.0.weight']);
    });

    it('modelo de score: pesos somam 100 e limiar de descarte abaixo dos demais', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const badWeights = await appError(
        service.saveScoringModel(ctx, offer.id, {
          ...DRAFT_SCORING_MODEL,
          weights: { ...DRAFT_SCORING_MODEL.weights, timing: 20 },
        }),
      );
      expect(badWeights.fieldErrors?.weights?.[0]).toContain('somam 110');
      const badOrder = await appError(
        service.saveScoringModel(ctx, offer.id, {
          ...DRAFT_SCORING_MODEL,
          thresholds: { ...DRAFT_SCORING_MODEL.thresholds, discardPotential: 80 },
        }),
      );
      expect(Object.keys(badOrder.fieldErrors ?? {})).toEqual(['thresholds.discardPotential']);
      const saved = await service.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL);
      expect(saved).toMatchObject({ changed: true, value: { version: 1 } });
    });
  });

  describe('ICP', () => {
    it('não ativa ICP sem CNAE, UF ou município, nem tira o recorte de um ICP ativo', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const empty = await service.createIcp(ctx, offer.id, {
        name: 'Sem recorte',
        filters: {},
        exclusions: {},
      });
      expect((await appError(service.changeIcpStatus(ctx, empty.id, 'active'))).reason).toBe(
        'activation_blocked',
      );

      const scoped = await service.createIcp(ctx, offer.id, icp);
      await service.changeIcpStatus(ctx, scoped.id, 'active');
      expect(
        (
          await appError(
            service.updateIcp(ctx, scoped.id, { name: 'Sem recorte', filters: {}, exclusions: {} }),
          )
        ).reason,
      ).toBe('icp_active_incomplete');
      const edited = await service.updateIcp(ctx, scoped.id, {
        ...icp,
        exclusions: { domains: ['https://www.concorrente.example/'] },
      });
      expect(edited.value.content.exclusions.domains).toEqual(['concorrente.example']);
      expect(edited.value.version).toBe(2);
    });

    it('recusa conflito entre inclusão e exclusão', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const error = await appError(
        service.createIcp(ctx, offer.id, {
          ...icp,
          exclusions: { cnaes: ['8630504'] },
        }),
      );
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(['exclusions.cnaes']);
    });
  });

  describe('prontidão e barreira de abordagem', () => {
    it('sem LIA aprovada as ações de abordagem ficam bloqueadas, com explicação', async () => {
      const { offer, profile } = await readyOffer();
      await compliancePieces();
      const readiness = await service.readiness(ctx);
      expect(readiness.discover.ready).toBe(true);
      expect(readiness.approach.ready).toBe(false);

      const error = await appError(service.assertReadyToApproach(ctx, { offerId: offer.id }));
      expect(error).toMatchObject({ code: 'conflict', reason: 'approach_blocked' });
      expect(error.fieldErrors?._form).toEqual([
        'LIA aprovada: Nenhuma LIA registrada. Preencha o modelo guiado e aprove.',
      ]);

      const lia = await approvedLia();
      const clearance = await service.assertReadyToApproach(ctx, {
        offerId: offer.id,
        icpId: profile.id,
      });
      const snapshot = (await service.overview(ctx)).snapshot;
      expect(clearance).toEqual({
        offerId: offer.id,
        offerVersionId: offer.current?.id,
        rubricVersionId: snapshot.rubrics[0]?.id,
        scoringModelVersionId: snapshot.scoringModels[0]?.id,
        icpVersionId: snapshot.icps[0]?.current?.id,
        voiceGuideVersionId: snapshot.voiceGuide?.id,
        contactPolicyVersionId: snapshot.contactPolicy?.id,
        liaVersionId: lia.id,
      });
    });

    it('a barreira é da oferta da ação: outra oferta pronta não libera', async () => {
      const { offer: ready } = await readyOffer();
      await compliancePieces();
      await approvedLia();
      const draft = await service.createOffer(ctx, { ...completeOffer, name: 'Outra oferta' });
      const blocked = await appError(service.assertReadyToApproach(ctx, { offerId: draft.id }));
      expect(blocked.fieldErrors?._form).toEqual([
        'Rubrica de auditoria: "Outra oferta" ainda não tem rubrica de auditoria visual.',
        'Modelo de score: "Outra oferta" ainda não tem modelo de score (pesos e limiares).',
        'Oferta ativa: "Outra oferta" está em rascunho; ative-a quando estiver completa.',
        'ICP ativo: Nenhum ICP ativo para "Outra oferta".',
      ]);
      // ICP de outra oferta não serve de escopo.
      const otherIcp = await service.createIcp(ctx, draft.id, icp);
      expect(
        (
          await appError(
            service.assertReadyToApproach(ctx, { offerId: ready.id, icpId: otherIcp.id }),
          )
        ).fieldErrors?._form?.[0],
      ).toBe('Oferta completa: O ICP da ação não é desta oferta.');
      expect((await service.assertReadyToApproach(ctx, { offerId: ready.id })).offerId).toBe(
        ready.id,
      );
    });

    it('oferta de volta a rascunho, arquivada ou ICP pausado bloqueiam de novo', async () => {
      const { offer, profile } = await readyOffer();
      await compliancePieces();
      await approvedLia();
      const scope = { offerId: offer.id, icpId: profile.id };
      await service.assertReadyToApproach(ctx, scope);

      await service.changeIcpStatus(ctx, profile.id, 'draft');
      expect(
        (await appError(service.assertReadyToApproach(ctx, scope))).fieldErrors?._form,
      ).toEqual([
        'ICP ativo: O ICP da ação não está ativo, não é de "Identidade visual para clínicas" ou é de demonstração.',
      ]);
      await service.changeIcpStatus(ctx, profile.id, 'active');

      await service.changeOfferStatus(ctx, offer.id, 'draft');
      expect(
        (await appError(service.assertReadyToApproach(ctx, scope))).fieldErrors?._form,
      ).toEqual([
        'Oferta ativa: "Identidade visual para clínicas" está em rascunho; ative-a quando estiver completa.',
      ]);
      await service.changeOfferStatus(ctx, offer.id, 'archived');
      expect(
        (await appError(service.assertReadyToApproach(ctx, scope))).fieldErrors?._form,
      ).toEqual([
        'Oferta ativa: "Identidade visual para clínicas" está arquivada e não pode ser usada.',
      ]);
    });

    it('sem voz ou sem opt-out a abordagem bloqueia; a descoberta não depende deles', async () => {
      const { offer, profile } = await readyOffer();
      await approvedLia();
      expect(
        (await appError(service.assertReadyToApproach(ctx, { offerId: offer.id }))).fieldErrors
          ?._form,
      ).toEqual([
        'Voz da agência: Descreva a voz da agência para orientar a redação.',
        'Opt-out e canal do titular: Defina o texto de opt-out e o canal do titular exigidos em toda primeira mensagem.',
      ]);
      const discovery = await service.assertReadyToDiscover(ctx, { icpId: profile.id });
      expect(discovery).toMatchObject({ offerId: offer.id, icpId: profile.id });
      expect(discovery.icpVersionId).toBe(profile.current?.id);
    });

    it('descoberta bloqueia ICP em rascunho; escopo malformado é recusado', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      const draftIcp = await service.createIcp(ctx, offer.id, icp);
      const error = await appError(service.assertReadyToDiscover(ctx, { icpId: draftIcp.id }));
      expect(error).toMatchObject({ code: 'conflict', reason: 'discovery_blocked' });
      expect((await appError(service.assertReadyToApproach(ctx, { offerId: 'x' }))).code).toBe(
        'validation',
      );
    });

    it('no modo memória (armazenamento que some) a abordagem nunca é liberada', async () => {
      service = createStrategyService({
        repo,
        audit: createAuditService(auditRepo),
        clock: { now: () => now },
        ephemeralStorage: true,
      });
      const { offer } = await readyOffer();
      await compliancePieces();
      await approvedLia();
      const readiness = await service.readiness(ctx);
      expect(readiness.discover.ready).toBe(true);
      expect(readiness.approach.items.find((i) => !i.ok && i.blocking)?.code).toBe(
        'persistent_storage',
      );
      const error = await appError(service.assertReadyToApproach(ctx, { offerId: offer.id }));
      expect(error.fieldErrors?._form?.[0]).toContain('Modo memória');
    });

    it('LIA aprovada que vence a revisão ou é revogada volta a bloquear', async () => {
      const { offer } = await readyOffer();
      await compliancePieces();
      const lia = await approvedLia();
      const scope = { offerId: offer.id };
      await service.assertReadyToApproach(ctx, scope);

      now = new Date('2027-11-10T15:00:00Z');
      expect(
        (await appError(service.assertReadyToApproach(ctx, scope))).fieldErrors?._form?.[0],
      ).toContain('venceu a revisão em 09/11/2027');

      now = new Date('2026-12-01T15:00:00Z');
      await service.revokeLia(ctx, lia.id);
      expect((await appError(service.assertReadyToApproach(ctx, scope))).reason).toBe(
        'approach_blocked',
      );
      expect(actions().filter((a) => a.startsWith('compliance.lia'))).toEqual([
        'compliance.lia.versioned',
        'compliance.lia.approved',
        'compliance.lia.revoked',
      ]);
    });

    it('ofertas de demonstração não contam para a prontidão', async () => {
      await seedStrategyDemo(repo);
      const { readiness, snapshot } = await service.overview(ctx);
      expect(snapshot.offers.map((o) => o.isDemo)).toEqual([true]);
      expect(readiness.discover.ready).toBe(false);
      expect(readiness.discover.items[0]?.detail).toBe(
        'Só há ofertas de demonstração; elas não contam para a prontidão.',
      );
    });
  });

  describe('LIA', () => {
    it('aprovação exige confirmação e data de revisão dentro de 24 meses', async () => {
      const { value } = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Prevalece.' });
      expect(
        Object.keys(
          (await appError(service.approveLia(ctx, value.id, { reviewDueOn: '2027-11-09' })))
            .fieldErrors ?? {},
        ),
      ).toEqual(['confirmed']);
      const late = await appError(
        service.approveLia(ctx, value.id, { reviewDueOn: '2028-11-10', confirmed: true }),
      );
      expect(Object.keys(late.fieldErrors ?? {})).toEqual(['reviewDueOn']);
      const compliance = await service.compliance(ctx);
      expect(compliance).toMatchObject({
        today: '2026-11-09',
        suggestedReviewDueOn: '2027-11-09',
        minReviewDueOn: '2026-11-10',
        maxReviewDueOn: '2028-11-09',
      });
    });

    it('a mesma versão não é aprovada duas vezes e só a mais recente pode ser aprovada', async () => {
      const first = await approvedLia();
      expect(
        (
          await appError(
            service.approveLia(ctx, first.id, { reviewDueOn: '2027-11-09', confirmed: true }),
          )
        ).fieldErrors?._form,
      ).toEqual(['Esta versão já foi aprovada. Para mudar, salve uma nova versão.']);

      const { value: v2 } = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Outra.' });
      await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Mais uma.' });
      expect(
        (
          await appError(
            service.approveLia(ctx, v2.id, { reviewDueOn: '2027-11-09', confirmed: true }),
          )
        ).fieldErrors?._form,
      ).toEqual(['Só a versão mais recente da LIA pode ser aprovada.']);
      const { liaVersions } = await service.compliance(ctx);
      expect(liaVersions.map((v) => [v.version, v.status])).toEqual([
        [3, 'draft'],
        [2, 'draft'],
        [1, 'approved'],
      ]);
    });

    it('vencimento segue o fuso da agência (America/Sao_Paulo), não o UTC', async () => {
      const { value } = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Prevalece.' });
      await service.approveLia(ctx, value.id, { reviewDueOn: '2026-11-10', confirmed: true });
      // 02:59 UTC do dia 11 ainda é dia 10 em São Paulo: vale.
      now = new Date('2026-11-11T02:59:00Z');
      expect((await service.compliance(ctx)).effectiveLia.status).toBe('approved');
      now = new Date('2026-11-11T03:00:00Z');
      expect((await service.compliance(ctx)).effectiveLia.status).toBe('expired');
    });

    it('revogar: só a LIA em vigor, uma vez; falha não audita', async () => {
      const { value: draft } = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'A.' });
      expect((await appError(service.revokeLia(ctx, draft.id))).fieldErrors?._form).toEqual([
        'Só a LIA em vigor (a última aprovada) pode ser revogada.',
      ]);
      await service.approveLia(ctx, draft.id, { reviewDueOn: '2027-11-09', confirmed: true });
      await service.revokeLia(ctx, draft.id);
      expect((await appError(service.revokeLia(ctx, draft.id))).fieldErrors?._form).toEqual([
        'Esta LIA já foi revogada.',
      ]);
      expect((await appError(service.revokeLia(ctx, 'nao-e-uuid'))).code).toBe('not_found');
      expect(actions().filter((a) => a === 'compliance.lia.revoked')).toHaveLength(1);
    });

    it('renovar: depois de revogada, salvar o mesmo texto cria nova versão para aprovar', async () => {
      const lia = await approvedLia();
      // Rascunho igual não cria versão.
      await service.revokeLia(ctx, lia.id);
      const renewed = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Prevalece.' });
      expect(renewed).toMatchObject({ changed: true, value: { version: 2 } });
      const again = await service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Prevalece.' });
      expect(again).toMatchObject({ changed: false, value: { version: 2 } });
      await service.approveLia(ctx, renewed.value.id, {
        reviewDueOn: '2027-11-09',
        confirmed: true,
      });
      expect((await service.compliance(ctx)).effectiveLia).toMatchObject({
        status: 'approved',
        version: { version: 2 },
      });
    });

    it('não aceita categoria de dado fora da minimização', async () => {
      const error = await appError(
        service.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'x', dataCategories: ['cpf'] }),
      );
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(['dataCategories.0']);
    });
  });

  describe('cases', () => {
    it('case citável exige autorização; arquivar é idempotente e auditado uma vez', async () => {
      const error = await appError(
        service.createProofAsset(ctx, { title: 'Case', summary: 'Resumo', publicOk: true }),
      );
      expect(Object.keys(error.fieldErrors ?? {})).toEqual(['consentRef']);

      const asset = await service.createProofAsset(ctx, {
        title: 'Case',
        summary: 'Resumo',
        publicOk: true,
        consentRef: 'E-mail do cliente, pasta Contratos',
      });
      await service.archiveProofAsset(ctx, asset.id);
      await service.archiveProofAsset(ctx, asset.id);
      expect((await service.proofAsset(ctx, asset.id)).archivedAt).toBe(now.toISOString());
      expect(actions()).toEqual(['strategy.proof_asset.created', 'strategy.proof_asset.archived']);
    });

    it('case arquivado não pode ser editado', async () => {
      const asset = await service.createProofAsset(ctx, { title: 'Case', summary: 'Resumo' });
      await service.archiveProofAsset(ctx, asset.id);
      const error = await appError(
        service.updateProofAsset(ctx, asset.id, { title: 'Outro', summary: 'Resumo' }),
      );
      expect([error.code, error.message]).toEqual([
        'conflict',
        'Case arquivado não pode ser editado.',
      ]);
      expect((await service.proofAsset(ctx, asset.id)).title).toBe('Case');
    });

    it('editar case audita a troca de autorização sem guardar o texto dela', async () => {
      const asset = await service.createProofAsset(ctx, { title: 'Case', summary: 'Resumo' });
      expect(
        Object.keys(
          (
            await appError(
              service.updateProofAsset(ctx, asset.id, {
                title: 'Case',
                summary: 'Resumo',
                publicOk: true,
              }),
            )
          ).fieldErrors ?? {},
        ),
      ).toEqual(['consentRef']);
      await service.updateProofAsset(ctx, asset.id, {
        title: 'Case',
        summary: 'Resumo',
        publicOk: true,
        consentRef: 'Contrato 2026-03, cláusula 7',
      });
      await service.updateProofAsset(ctx, asset.id, {
        title: 'Case editado',
        summary: 'Resumo',
        publicOk: true,
        consentRef: 'Contrato 2026-03, cláusula 7',
      });
      const updates = auditRepo
        .entries()
        .filter((e) => e.action === 'strategy.proof_asset.updated');
      expect(updates.map((e) => e.diff)).toEqual([
        { publicOk: { from: false, to: true }, consentRefChanged: true },
        { publicOk: true },
      ]);
      expect(JSON.stringify(updates)).not.toContain('cláusula');
      expect(
        (await appError(service.updateProofAsset(ctx, 'abc', { title: 'x', summary: 'y' }))).code,
      ).toBe('not_found');
    });

    it('salvar sem mudança não cria versão nem audita (rubrica, score, voz, opt-out)', async () => {
      const offer = await service.createOffer(ctx, completeOffer);
      await service.saveRubric(ctx, offer.id, DRAFT_BRANDING_RUBRIC);
      await service.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL);
      await compliancePieces();
      const before = actions().length;
      expect((await service.saveRubric(ctx, offer.id, DRAFT_BRANDING_RUBRIC)).changed).toBe(false);
      expect((await service.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL)).changed).toBe(
        false,
      );
      await compliancePieces();
      expect(actions()).toHaveLength(before);
    });

    it('case vinculado a oferta inexistente é recusado', async () => {
      const error = await appError(
        service.createProofAsset(ctx, {
          title: 'Case',
          summary: 'Resumo',
          offerId: '00000000-0000-4000-8000-000000000000',
        }),
      );
      expect(error.code).toBe('not_found');
    });
  });
});
