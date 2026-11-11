import {
  EMPTY_INVESTIGATION_SNAPSHOT,
  type CnpjRegistryRecord,
  type Investigation,
  type Recommendation,
  type ReplyAnalysis,
} from '@prospector/contracts';
import { DRAFT_BRANDING_RUBRIC, DRAFT_LIA, DRAFT_SCORING_MODEL } from '@prospector/domain';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createCompanyService,
  createEvidenceService,
  createInvestigationInsightsSource,
  createRelationshipService,
  createStrategyService,
  type AiOutcome,
  type ApproachAiRequest,
  type CompanyService,
  type MessageAiRequest,
  type RelationshipAi,
  type ReplyAiRequest,
  type RelationshipService,
  type RequestContext,
  type StrategyService,
} from '../src';
import {
  createMemoryAuditRepository,
  createMemoryCompanyRepository,
  createMemoryCopilotRepository,
  createMemoryRelationshipRepository,
  createMemoryStrategyRepository,
} from '../src/memory';

/**
 * Relacionamento (ADR-0014) com os adaptadores em memória e uma IA falsa. Cobre os cenários de
 * aceite A a J no serviço. Dados SINTÉTICOS (CNPJ de teste, agência e empresa de exemplo).
 */

const ctx: RequestContext = {
  actor: { type: 'user' },
  traceId: '5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c',
};

const AGENCY = 'Agência Exemplo';
const OPT_OUT = 'Se não quiser receber mais mensagens, responda "remover".';

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
  cnaeSecondary: [],
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

const UNKNOWN_ID = '99999999-9999-4999-8999-999999999999';

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

function ok(data: unknown, promptId = 'relationship-approach/v1'): AiOutcome {
  return { ok: true, data, promptId, model: 'modelo-falso', doneReason: 'stop', usage: null };
}

function fakeAi() {
  const calls: string[] = [];
  const next: { approach?: AiOutcome; message?: AiOutcome; reply?: AiOutcome } = {};
  /** Pedidos recebidos (o que o serviço mandaria ao modelo). */
  const requests: {
    approach: ApproachAiRequest[];
    message: MessageAiRequest[];
    reply: ReplyAiRequest[];
  } = {
    approach: [],
    message: [],
    reply: [],
  };
  const ai: RelationshipAi = {
    async approach(request) {
      calls.push('approach');
      requests.approach.push(request);
      return (
        next.approach ?? {
          ok: false,
          code: 'runtime_unavailable',
          promptId: 'x',
          model: null,
          usage: null,
        }
      );
    },
    async message(request) {
      calls.push('message');
      requests.message.push(request);
      return (
        next.message ?? {
          ok: false,
          code: 'runtime_unavailable',
          promptId: 'x',
          model: null,
          usage: null,
        }
      );
    },
    async analyzeReply(request) {
      calls.push('reply');
      requests.reply.push(request);
      return (
        next.reply ?? {
          ok: false,
          code: 'runtime_unavailable',
          promptId: 'x',
          model: null,
          usage: null,
        }
      );
    },
  };
  return { ai, calls, next, requests };
}

function approachOutput(claimId: string, caseId: string | null, body?: string) {
  return {
    strategy: {
      opportunity: 'Empresa ativa há dez anos, com marca registrada sem atualização aparente.',
      objective: 'conversation',
      counterpartRole: 'Sócio ou direção',
      channel: 'email',
      channelReason: 'Primeiro contato profissional e com registro.',
      argument: 'Uma identidade atualizada sustenta a próxima fase da empresa.',
      evidence: [
        { statement: 'Empresa ativa desde 2015.', claimIds: [claimId, UNKNOWN_ID] },
        { statement: 'Frase sem fonte nenhuma.', claimIds: [UNKNOWN_ID] },
      ],
      nextStep: 'Propor uma conversa de 20 minutos.',
      gaps: ['Ver o site antes de falar de presença digital.'],
      risks: ['Sem dados de presença digital.'],
      caseIds: caseId ? [caseId, UNKNOWN_ID] : [UNKNOWN_ID],
    },
    message: {
      subject: 'Identidade visual da Ateliê Exemplo',
      body:
        body ??
        `Olá! Aqui é da ${AGENCY}. Vi que a empresa está ativa desde 2015 e queria propor uma conversa curta sobre a identidade visual.`,
    },
  };
}

const analysis = (overrides: Partial<ReplyAnalysis> = {}): ReplyAnalysis => ({
  classification: 'interest',
  confidence: 'high',
  alternatives: [],
  uncertainty: null,
  summary: 'Demonstra interesse e pede horários.',
  objections: [],
  mentionedDeadline: null,
  qualifyingQuestions: ['Qual o prazo para a nova marca?'],
  nextStep: 'Responder com dois horários.',
  followUpInDays: 3,
  suggestedReply: {
    subject: null,
    body: 'Obrigado pelo retorno! Pode ser quinta às 10h ou sexta às 15h?',
  },
  caseIds: [],
  ...overrides,
});

describe('RelationshipService (ADR-0014)', () => {
  let now: Date;
  let audit: ReturnType<typeof createMemoryAuditRepository>;
  let telemetry: ReturnType<typeof createMemoryCopilotRepository>;
  let strategy: StrategyService;
  let companies: CompanyService;
  let fake: ReturnType<typeof fakeAi>;
  let service: RelationshipService;
  let companyRepo: ReturnType<typeof createMemoryCompanyRepository>;
  /** Investigações de Empresas que o adaptador do KI-129 lê (vazio = sem diagnóstico). */
  let investigations: Investigation[];

  const actions = () => audit.entries().map((entry) => entry.action);

  function build(options: { ephemeralStorage?: boolean } = {}) {
    const clock = { now: () => now };
    audit = createMemoryAuditRepository({ clock });
    telemetry = createMemoryCopilotRepository({ audit, clock });
    const strategyRepo = createMemoryStrategyRepository({ clock, audit });
    strategy = createStrategyService({
      repo: strategyRepo,
      clock,
      ephemeralStorage: options.ephemeralStorage ?? false,
    });
    companyRepo = createMemoryCompanyRepository({ audit, clock });
    companies = createCompanyService({
      companies: companyRepo,
      evidence: companyRepo,
      evidenceService: createEvidenceService({ evidence: companyRepo, clock }),
      cnpjLookup: {
        lookup: async () => ({ ok: true, record: RECORD, fetchedAt: now.toISOString() }),
      },
      clock,
    });
    fake = fakeAi();
    investigations = [];
    service = createRelationshipService({
      repo: createMemoryRelationshipRepository({ audit, companies: companyRepo, clock }),
      companies,
      strategy,
      ai: fake.ai,
      // O adaptador real do KI-129, sobre o ledger em memória.
      insights: createInvestigationInsightsSource({
        investigations: { history: async () => investigations },
        evidence: companyRepo,
        clock,
      }),
      telemetry,
      clock,
    });
  }

  beforeEach(() => {
    now = new Date('2026-11-11T15:00:00Z');
    build();
  });

  /**
   * Investigação SINTÉTICA concluída, com diagnóstico que cita `claimId` e avalia `offerId`. Sem
   * `summaryClaimId`, o diagnóstico fica parcial (sem resumo em vigor).
   */
  function diagnosed(
    companyId: string,
    claimId: string,
    offerId: string,
    versionId: string,
    options: { summaryClaimId?: string; recommendation?: Recommendation } = {},
  ) {
    const recommendation = options.recommendation ?? 'pursue';
    const investigation: Investigation = {
      id: '40000000-0000-4000-8000-000000000001',
      companyId,
      status: 'succeeded',
      trigger: 'user',
      pipelineVersion: 1,
      steps: [],
      usage: {
        searches: 0,
        searchCredits: 0,
        pagesRead: 0,
        captures: 0,
        captureBytes: 0,
        modelCalls: 0,
        modelMs: 0,
      },
      models: [{ agent: 'diagnosis', model: 'modelo-falso', promptVersion: 'diagnosis/v1' }],
      diagnosis: {
        summaryClaimId: options.summaryClaimId ?? null,
        factClaimIds: [claimId],
        inferenceClaimIds: [],
        hypothesisClaimIds: [],
        opportunityClaimIds: [],
        gaps: [],
        offers: [
          {
            offerId,
            offerVersionId: versionId,
            offerName: 'Oferta recomendada',
            scoringModelId: null,
            icpVersionId: null,
            fit: { score: 100, checks: [] },
            opportunity: { score: 80, claimIds: [claimId] },
            confidence: { score: 80, coveredDimensions: 3 },
            potential: 70,
            priority: 80,
            recommendation,
            gates: [],
            readingClaimId: null,
          },
        ],
        // A investigação sempre marca a oferta de maior prioridade, mesmo quando não manda seguir.
        recommendedOfferId: offerId,
        recommendation,
        nextStep: recommendation === 'pursue' ? 'prepare_approach' : 'investigate_more',
        confidence: 80,
        verification: { discarded: 0, reasons: [] },
      },
      snapshot: EMPTY_INVESTIGATION_SNAPSHOT,
      changes: [],
      previousId: null,
      jobId: null,
      issue: null,
      cancelRequestedAt: null,
      startedAt: '2026-11-11T10:00:00.000Z',
      finishedAt: '2026-11-11T11:00:00.000Z',
      isDemo: true,
      createdAt: '2026-11-11T10:00:00.000Z',
      updatedAt: '2026-11-11T11:00:00.000Z',
    };
    investigations = [investigation];
    return investigation;
  }

  /** Estratégia completa: oferta ativa, voz, política de contato, case autorizado; LIA opcional. */
  async function readyStrategy(options: { lia?: boolean } = {}) {
    const offer = await strategy.createOffer(ctx, {
      name: 'Identidade visual para indústrias',
      problems: ['Marca desatualizada'],
      needSignals: ['Fachada antiga'],
      disqualifiers: ['Rebrand recente'],
      deliverables: ['Manual de marca'],
      priceMinCents: 1_500_000,
      priceMaxCents: 4_000_000,
    });
    await strategy.saveRubric(ctx, offer.id, DRAFT_BRANDING_RUBRIC);
    await strategy.saveScoringModel(ctx, offer.id, DRAFT_SCORING_MODEL);
    await strategy.changeOfferStatus(ctx, offer.id, 'active');
    const profile = await strategy.createIcp(ctx, offer.id, {
      name: 'Indústrias no PR',
      filters: { cnaes: ['3101-2/00'], ufs: ['PR'] },
      exclusions: {},
    });
    await strategy.changeIcpStatus(ctx, profile.id, 'active');
    await strategy.saveVoiceGuide(ctx, { summary: 'Direta, cordial e sem jargão.' });
    await strategy.saveContactPolicy(ctx, {
      agencyName: AGENCY,
      privacyContact: 'privacidade@agencia.example',
      optOutText: OPT_OUT,
    });
    const asset = await strategy.createProofAsset(ctx, {
      title: 'Case sintético de marcenaria',
      summary: 'Reposicionamento de uma marcenaria (exemplo).',
      publicOk: true,
      consentRef: 'Autorização sintética de teste',
    });
    if (options.lia ?? true) await approveLia();
    return { offer, caseId: asset.id };
  }

  async function approveLia() {
    const { value } = await strategy.saveLia(ctx, { ...DRAFT_LIA, conclusion: 'Prevalece.' });
    await strategy.approveLia(ctx, value.id, { reviewDueOn: '2027-11-09', confirmed: true });
  }

  async function companyWithFacts() {
    const result = await companies.importFromCnpj(ctx, { cnpj: RECORD.cnpj });
    if (result.status !== 'created') throw new Error('empresa não criada');
    const dossier = await companies.dossier(ctx, result.company.id);
    return {
      company: result.company,
      claimId: dossier.claims[0]!.claim.id,
      // Outro claim do dossiê, usado como resumo do diagnóstico nos testes do KI-129.
      otherClaimId: dossier.claims[1]!.claim.id,
    };
  }

  /** Segunda oferta ativa: com duas, sem diagnóstico, o serviço pede para escolher. */
  async function secondActiveOffer() {
    const second = await strategy.createOffer(ctx, {
      name: 'Rebranding para serviços',
      problems: ['Marca genérica'],
      needSignals: ['Site antigo'],
      disqualifiers: ['Marca refeita há menos de um ano'],
      deliverables: ['Nova marca'],
      priceMinCents: 1_000_000,
      priceMaxCents: 3_000_000,
    });
    await strategy.saveRubric(ctx, second.id, DRAFT_BRANDING_RUBRIC);
    await strategy.saveScoringModel(ctx, second.id, DRAFT_SCORING_MODEL);
    await strategy.changeOfferStatus(ctx, second.id, 'active');
    return second;
  }

  async function prepared(options: { lia?: boolean; body?: string } = {}) {
    const { offer, caseId } = await readyStrategy({ lia: options.lia ?? true });
    const { company, claimId } = await companyWithFacts();
    fake.next.approach = ok(approachOutput(claimId, caseId, options.body));
    const result = await service.prepareApproach(ctx, { companyId: company.id });
    if (result.status !== 'created')
      throw new Error(`abordagem não criada: ${result.failure.code}`);
    return { ...result, company, offer, claimId, caseId };
  }

  describe('KI-129 — diagnóstico de Empresas na abordagem', () => {
    it('sem investigação, a abordagem diz que falta o diagnóstico e fica com base limitada', async () => {
      const { plan, company } = await prepared();
      expect(plan.basis).toBe('limited');
      expect(plan.content.gaps).toContain(
        'Diagnóstico de marca ainda não feito para esta empresa.',
      );
      const panel = await service.forCompany(ctx, company.id);
      expect(panel.insights.diagnosis).toBeNull();
    });

    it('com diagnóstico completo, a abordagem usa o diagnóstico e a oferta recomendada', async () => {
      const { offer: first, caseId } = await readyStrategy();
      const second = await secondActiveOffer();
      const { company, claimId, otherClaimId } = await companyWithFacts();
      const investigation = diagnosed(company.id, claimId, second.id, second.current!.id, {
        summaryClaimId: otherClaimId,
      });

      const panel = await service.forCompany(ctx, company.id);
      expect(panel.insights.diagnosis).toMatchObject({
        status: 'complete',
        promptId: 'diagnosis/v1',
      });
      expect(panel.insights.recommendedService).toMatchObject({
        offerId: second.id,
        confidence: 'high',
      });
      expect(panel.insights.qualification?.priority).toBe('high');

      fake.next.approach = ok(approachOutput(claimId, caseId));
      const result = await service.prepareApproach(ctx, { companyId: company.id });
      if (result.status !== 'created') throw new Error('abordagem não criada');
      // Sem oferta escolhida, vale a recomendada pelo diagnóstico (não a primeira cadastrada).
      expect(result.opportunity.offerId).toBe(second.id);
      expect(result.opportunity.offerId).not.toBe(first.id);
      // Completo e com achado citável: base suficiente.
      expect(result.plan.basis).toBe('sufficient');
      expect(result.plan.content.gaps).not.toContain(
        'Diagnóstico de marca ainda não feito para esta empresa.',
      );
      expect(result.plan.content.gaps).not.toContain(
        'Serviço recomendado ainda não definido: a oferta é a que você escolher.',
      );
      expect(result.plan.content.gaps).not.toContain(
        'Diagnóstico parcial: a investigação terminou com lacunas.',
      );
      // A IA recebe o diagnóstico com o tipo de cada achado e o claim que o sustenta.
      const sent = fake.requests.approach.at(-1)!;
      expect(sent.insights.diagnosis?.findings).toEqual([
        { statement: expect.stringMatching(/^Fato observado: /), claimIds: [claimId] },
      ]);
      expect(sent.insights.recommendedService?.claimIds).toEqual([claimId]);
      // A auditoria registra de qual investigação veio o diagnóstico.
      const generated = audit
        .entries()
        .find((entry) => entry.action === 'relationship.approach.generated');
      expect(generated?.diff).toMatchObject({ basis: 'sufficient', diagnosisId: investigation.id });

      const detail = await service.opportunity(ctx, result.opportunity.id);
      expect(detail.insights.recommendedService?.offerId).toBe(second.id);
      expect(detail.basis.basis).toBe('sufficient');
    });

    it('com diagnóstico parcial, a base fica limitada, com lacuna própria', async () => {
      const { caseId } = await readyStrategy();
      const second = await secondActiveOffer();
      const { company, claimId } = await companyWithFacts();
      const investigation = diagnosed(company.id, claimId, second.id, second.current!.id);

      const panel = await service.forCompany(ctx, company.id);
      expect(panel.insights.diagnosis?.status).toBe('partial');

      fake.next.approach = ok(approachOutput(claimId, caseId));
      const result = await service.prepareApproach(ctx, { companyId: company.id });
      if (result.status !== 'created') throw new Error('abordagem não criada');
      expect(result.opportunity.offerId).toBe(second.id);
      expect(result.plan.basis).toBe('limited');
      expect(result.plan.content.gaps).toContain(
        'Diagnóstico parcial: a investigação terminou com lacunas.',
      );
      expect(result.plan.content.gaps).not.toContain(
        'Diagnóstico de marca ainda não feito para esta empresa.',
      );
      const generated = audit
        .entries()
        .find((entry) => entry.action === 'relationship.approach.generated');
      expect(generated?.diff).toMatchObject({ basis: 'limited', diagnosisId: investigation.id });
      const detail = await service.opportunity(ctx, result.opportunity.id);
      expect(detail.basis.basis).toBe('limited');
    });

    it('quando a investigação não manda seguir, não há oferta recomendada: a pessoa escolhe', async () => {
      await readyStrategy();
      const second = await secondActiveOffer();
      const { company, claimId, otherClaimId } = await companyWithFacts();
      diagnosed(company.id, claimId, second.id, second.current!.id, {
        summaryClaimId: otherClaimId,
        recommendation: 'insufficient_evidence',
      });

      const panel = await service.forCompany(ctx, company.id);
      expect(panel.insights.diagnosis?.status).toBe('complete');
      expect(panel.insights.recommendedService).toBeNull();
      expect(panel.insights.qualification?.recommendation).toMatch(/^Sem base suficiente/);
      // Duas ofertas ativas e nenhuma recomendada: o serviço pede a escolha e não chama a IA.
      const error = await appError(service.prepareApproach(ctx, { companyId: company.id }));
      expect(error.reason).toBe('invalid_input');
      expect(fake.calls).not.toContain('approach');
    });
  });

  describe('A — abordagem a partir de empresa investigada', () => {
    it('gera estratégia baseada em evidências e salva a mensagem como rascunho', async () => {
      const { opportunity, plan, message, claimId, caseId } = await prepared();
      expect(opportunity.stage).toBe('approach_ready');
      expect(plan.basis).toBe('limited');
      // Só o que o dossiê sustenta: id desconhecido sai, ponto sem fonte sai.
      expect(plan.content.evidence).toEqual([
        { statement: 'Empresa ativa desde 2015.', claimIds: [claimId] },
      ]);
      expect(plan.claimIds).toEqual([claimId]);
      expect(plan.content.caseIds).toEqual([caseId]);
      // As lacunas do Prospector vêm antes das do modelo (não somem no corte).
      expect(plan.content.gaps[0]).toBe('Diagnóstico de marca ainda não feito para esta empresa.');
      expect(message).toMatchObject({
        status: 'draft',
        origin: 'ai',
        version: 1,
        channel: 'email',
      });
      // Rodapé garantido pelo sistema no primeiro contato: opt-out e canal do titular.
      expect(message.body).toContain(OPT_OUT);
      expect(message.body.endsWith('privacidade@agencia.example')).toBe(true);
      expect(actions()).toEqual(
        expect.arrayContaining([
          'relationship.opportunity.opened',
          'relationship.approach.generated',
          'relationship.message.generated',
        ]),
      );
      expect(telemetry.llmCalls()).toHaveLength(1);
      expect(telemetry.llmCalls()[0]).toMatchObject({
        status: 'ok',
        promptVersion: 'relationship-approach/v1',
      });
    });

    it('sem nenhum fato nem diagnóstico, não gera (e não chama a IA)', async () => {
      await readyStrategy();
      const created = await companies.create(ctx, {
        schemaVersion: 1,
        displayName: 'Empresa Vazia',
      });
      const error = await appError(service.prepareApproach(ctx, { companyId: created.company.id }));
      expect(error.reason).toBe('approach_basis_insufficient');
      expect(fake.calls).toEqual([]);
      expect(await service.listOpportunities(ctx)).toEqual([]);
    });

    it('falha da IA ou saída fora do formato não grava nada', async () => {
      await readyStrategy();
      const { company } = await companyWithFacts();
      const failed = await service.prepareApproach(ctx, { companyId: company.id });
      expect(failed).toMatchObject({
        status: 'ai_failed',
        failure: { code: 'runtime_unavailable' },
      });
      fake.next.approach = ok({ strategy: { opportunity: 'curto' }, message: {} });
      const invalid = await service.prepareApproach(ctx, { companyId: company.id });
      expect(invalid).toMatchObject({ status: 'ai_failed', failure: { code: 'invalid_output' } });
      // Pedido que não cabe na janela do modelo: mensagem própria, nada gravado.
      fake.next.approach = {
        ok: false,
        code: 'context_too_large',
        promptId: 'relationship-approach/v1',
        model: null,
        usage: null,
      };
      const tooLarge = await service.prepareApproach(ctx, { companyId: company.id });
      expect(tooLarge).toMatchObject({
        status: 'ai_failed',
        failure: { code: 'context_too_large', message: expect.stringMatching(/encurte/i) },
      });
      expect(await service.listOpportunities(ctx)).toEqual([]);
      // Saída fora do formato conta como erro na telemetria (registrada depois da validação).
      expect(telemetry.llmCalls().map((call) => [call.status, call.errorCode])).toEqual([
        ['error', 'runtime_unavailable'],
        ['error', 'invalid_output'],
        ['error', 'context_too_large'],
      ]);
    });

    it('abrir oportunidade é idempotente (Descoberta e Empresas chamam a mesma porta)', async () => {
      const { company } = await companyWithFacts();
      const first = await service.openOpportunity(ctx, {
        companyId: company.id,
        source: 'discovery',
      });
      const second = await service.openOpportunity(ctx, { companyId: company.id });
      expect(first.created).toBe(true);
      expect(second).toEqual({ opportunity: first.opportunity, created: false });
      expect(actions().filter((a) => a === 'relationship.opportunity.opened')).toHaveLength(1);
    });
  });

  describe('B e J — aprovação e nada sai sem autorização', () => {
    it('sem LIA aprovada, a aprovação fica bloqueada pela barreira de conformidade', async () => {
      const { message } = await prepared({ lia: false });
      const error = await appError(
        service.approveMessage(ctx, { messageId: message.id, payloadHash: message.payloadHash }),
      );
      expect(error.reason).toBe('approach_blocked');
      expect(error.fieldErrors?._form?.join(' ')).toMatch(/LIA/);
      const detail = await service.opportunity(ctx, message.opportunityId);
      expect(detail.compliance.ready).toBe(false);
    });

    it('no modo memória a aprovação também fica bloqueada (sem armazenamento persistente)', async () => {
      build({ ephemeralStorage: true });
      const { message } = await prepared();
      const error = await appError(
        service.approveMessage(ctx, { messageId: message.id, payloadHash: message.payloadHash }),
      );
      expect(error.reason).toBe('approach_blocked');
      expect(error.fieldErrors?._form?.[0]).toContain('Modo memória');
    });

    it('aprova o conteúdo exato; texto mudado na tela ou sem identificação é recusado', async () => {
      const { message } = await prepared();
      const stale = await appError(
        service.approveMessage(ctx, { messageId: message.id, payloadHash: 'a'.repeat(64) }),
      );
      expect(stale.reason).toBe('concurrent_change');
      const approval = await service.approveMessage(ctx, {
        messageId: message.id,
        payloadHash: message.payloadHash,
      });
      expect(approval).toMatchObject({ status: 'approved', payloadHash: message.payloadHash });
      // Validade de 72 horas (docs/12 §2).
      expect(Date.parse(approval.expiresAt) - now.getTime()).toBe(3 * 86_400_000);
      expect(approval.clearance.liaVersionId).toBeTruthy();
    });

    it('primeiro contato sem o nome da agência não pode ser aprovado', async () => {
      const { message } = await prepared({
        body: 'Olá! Queria propor uma conversa sobre a sua marca, sem dizer quem escreve.',
      });
      const error = await appError(
        service.approveMessage(ctx, { messageId: message.id, payloadHash: message.payloadHash }),
      );
      expect(error.reason).toBe('message_blocked');
      expect(error.fieldErrors?.body?.join(' ')).toContain(AGENCY);
    });

    it('rascunho não aprovado não pode ser registrado como contato feito', async () => {
      const { message } = await prepared();
      const error = await appError(
        service.recordOutbound(ctx, { messageId: message.id, occurredAt: now.toISOString() }),
      );
      expect(error.reason).toBe('approval_invalid');
      expect(error.fieldErrors?._form).toContain('A mensagem ainda não foi aprovada.');
    });

    it('editar depois de aprovar cria nova versão e a aprovação anterior deixa de valer', async () => {
      const { message } = await prepared();
      await service.approveMessage(ctx, {
        messageId: message.id,
        payloadHash: message.payloadHash,
      });
      const edited = await service.editMessage(ctx, {
        messageId: message.id,
        subject: message.subject,
        body: `${message.body}\nAté breve.`,
      });
      expect(edited).toMatchObject({ version: 2, status: 'draft', threadId: message.threadId });
      const error = await appError(
        service.recordOutbound(ctx, { messageId: message.id, occurredAt: now.toISOString() }),
      );
      expect(error.reason).toBe('approval_invalid');
      expect(error.fieldErrors?._form).toContain(
        'A mensagem foi editada depois da aprovação. Aprove a versão nova.',
      );
      const detail = await service.opportunity(ctx, message.opportunityId);
      expect(detail.threads).toHaveLength(1);
      expect(detail.threads[0]!.message.id).toBe(edited.id);
      expect(detail.previousVersions[message.threadId]).toHaveLength(1);
    });

    it('aprovação revogada ou vencida não vale no momento do registro', async () => {
      const { message } = await prepared();
      const approval = await service.approveMessage(ctx, {
        messageId: message.id,
        payloadHash: message.payloadHash,
      });
      now = new Date(now.getTime() + 31 * 86_400_000);
      const expired = await appError(
        service.recordOutbound(ctx, { messageId: message.id, occurredAt: now.toISOString() }),
      );
      expect(expired.fieldErrors?._form).toContain('A aprovação venceu. Revise e aprove de novo.');
      await service.revokeApproval(ctx, { approvalId: approval.id, reason: 'Mudei o texto' });
      const revoked = await appError(
        service.recordOutbound(ctx, { messageId: message.id, occurredAt: now.toISOString() }),
      );
      expect(revoked.fieldErrors?._form).toContain('A aprovação foi revogada.');
    });
  });

  describe('C, D e E — contato, resposta e follow-up', () => {
    async function contacted() {
      const base = await prepared();
      await service.approveMessage(ctx, {
        messageId: base.message.id,
        payloadHash: base.message.payloadHash,
      });
      const interaction = await service.recordOutbound(ctx, {
        messageId: base.message.id,
        occurredAt: now.toISOString(),
        counterpartRole: 'Sócio',
        moveToContacted: true,
      });
      return { ...base, interaction };
    }

    it('C — contato feito fica na empresa e na oportunidade, e move só quando pedido', async () => {
      const { interaction, opportunity, company } = await contacted();
      expect(interaction).toMatchObject({
        direction: 'outbound',
        companyId: company.id,
        opportunityId: opportunity.id,
        counterpartRole: 'Sócio',
      });
      const detail = await service.opportunity(ctx, opportunity.id);
      expect(detail.opportunity.stage).toBe('contacted');
      expect(detail.opportunity.lastOutboundAt).toBe(now.toISOString());
      expect(detail.stageChanges.map((change) => change.toStage)).toEqual([
        'approach_ready',
        'contacted',
      ]);
    });

    it('D — resposta registrada, interpretada e com sugestão de resposta em rascunho', async () => {
      const { opportunity } = await contacted();
      const { interaction, stopDetected } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: 'Oi! Tenho interesse sim, podemos conversar esta semana?',
        moveToInConversation: true,
      });
      expect(stopDetected).toBe(false);
      fake.next.reply = ok(analysis(), 'relationship-reply/v1');
      const result = await service.analyzeReply(ctx, interaction.id);
      expect(result).toMatchObject({ status: 'analyzed', suppressedByAi: false });
      if (result.status !== 'analyzed') return;
      expect(result.interaction.analysis?.classification).toBe('interest');
      const reply = await service.draftSuggestedReply(ctx, interaction.id);
      expect(reply).toMatchObject({
        kind: 'reply',
        status: 'draft',
        replyToInteractionId: interaction.id,
      });
      const detail = await service.opportunity(ctx, opportunity.id);
      expect(detail.opportunity.stage).toBe('in_conversation');
      expect(detail.opportunity.lastInboundAt).toBe(now.toISOString());
    });

    it('E — follow-up aparece na central: hoje e vencido', async () => {
      const { opportunity } = await contacted();
      await service.createTask(ctx, {
        opportunityId: opportunity.id,
        title: 'Retomar contato',
        dueAt: new Date(now.getTime() + 2 * 3_600_000).toISOString(),
      });
      await service.createTask(ctx, {
        opportunityId: opportunity.id,
        title: 'Enviar portfólio',
        dueAt: new Date(now.getTime() - 3 * 86_400_000).toISOString(),
      });
      const overview = await service.overview(ctx);
      expect(overview.tasksToday).toBe(1);
      expect(overview.tasksOverdue).toBe(1);
      expect(overview.attention.map((item) => item.kind)).toEqual(
        expect.arrayContaining(['task_overdue', 'task_due_today']),
      );
      expect(overview.attention[0]!.kind).toBe('task_overdue');
    });

    it('pedido para parar: suprime na hora, cancela follow-ups e bloqueia novo contato', async () => {
      const { opportunity, company } = await contacted();
      const task = await service.createTask(ctx, {
        opportunityId: opportunity.id,
        title: 'Retomar contato',
        dueAt: new Date(now.getTime() + 86_400_000).toISOString(),
      });
      const draft = await service.writeMessage(ctx, {
        opportunityId: opportunity.id,
        kind: 'follow_up',
        channel: 'email',
        subject: 'Retomando',
        body: 'Olá, retomando a conversa sobre a identidade visual.',
      });
      const { stopDetected } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: 'Por favor, me tirem da lista de vocês.',
      });
      expect(stopDetected).toBe(true);
      const detail = await service.opportunity(ctx, opportunity.id);
      expect(detail.activeSuppressions).toHaveLength(1);
      expect(detail.opportunity.suppressed).toBe(true);
      expect(detail.tasks.find((item) => item.id === task.id)).toMatchObject({
        status: 'cancelled',
        cancelReason: 'opt_out',
      });
      // Etapa não muda sozinha.
      expect(detail.opportunity.stage).toBe('contacted');
      for (const attempt of [
        () => service.approveMessage(ctx, { messageId: draft.id, payloadHash: draft.payloadHash }),
        () => service.prepareApproach(ctx, { companyId: company.id }),
        () =>
          service.createTask(ctx, {
            opportunityId: opportunity.id,
            title: 'Insistir',
            dueAt: now.toISOString(),
          }),
      ]) {
        expect((await appError(attempt())).reason).toBe('company_suppressed');
      }
      const overview = await service.overview(ctx);
      expect(overview.attention.filter((item) => item.opportunityId === opportunity.id)).toEqual(
        [],
      );
    });

    it('a IA também reconhece o pedido para parar e retira a sugestão de resposta', async () => {
      const { opportunity } = await contacted();
      const { interaction, stopDetected } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: 'Agradeço, mas esse tipo de abordagem não é bem-vinda por aqui.',
      });
      expect(stopDetected).toBe(false);
      fake.next.reply = ok(
        analysis({ classification: 'stop_request', confidence: 'medium' }),
        'relationship-reply/v1',
      );
      const result = await service.analyzeReply(ctx, interaction.id);
      expect(result).toMatchObject({ status: 'analyzed', suppressedByAi: true });
      if (result.status !== 'analyzed') return;
      expect(result.interaction.analysis?.suggestedReply).toBeNull();
      expect((await service.opportunity(ctx, opportunity.id)).opportunity.suppressed).toBe(true);
    });

    it('a IA lê só as palavras da empresa e a nossa mensagem sem o rodapé; recusa não ganha sugestão', async () => {
      const { opportunity, caseId } = await contacted();
      const { interaction, stopDetected } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: [
          'Não temos interesse, obrigado.',
          '',
          `Em ter., 10 de nov. de 2026 às 09:00, ${AGENCY} escreveu:`,
          `> Olá! Aqui é da ${AGENCY}.`,
          `> ${OPT_OUT}`,
        ].join('\n'),
      });
      expect(stopDetected).toBe(false);
      fake.next.reply = ok(
        analysis({
          classification: 'refusal',
          caseIds: [caseId],
          qualifyingQuestions: ['Qual o prazo para a nova marca?'],
        }),
        'relationship-reply/v1',
      );
      const result = await service.analyzeReply(ctx, interaction.id);
      const request = fake.requests.reply[0]!;
      expect(request.replyBody).toBe('Não temos interesse, obrigado.');
      expect(request.lastOutbound?.body).toContain(AGENCY);
      expect(request.lastOutbound?.body).not.toContain(OPT_OUT);
      expect(request.lastOutbound?.body).not.toContain('privacidade@agencia.example');
      expect(result).toMatchObject({ status: 'analyzed', suppressedByAi: false });
      if (result.status !== 'analyzed') return;
      expect(result.interaction.analysis).toMatchObject({
        classification: 'refusal',
        suggestedReply: null,
        followUpInDays: null,
        caseIds: [],
        qualifyingQuestions: [],
      });
    });

    it('resposta automática de ausência: sem sugestão de resposta, mas com a data de retomada', async () => {
      const { opportunity } = await contacted();
      const { interaction } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: 'Estou de férias até 20/11, com acesso limitado ao e-mail.',
      });
      fake.next.reply = ok(
        analysis({ classification: 'out_of_office', followUpInDays: 10 }),
        'relationship-reply/v1',
      );
      const result = await service.analyzeReply(ctx, interaction.id);
      if (result.status !== 'analyzed') throw new Error('não interpretada');
      expect(result.interaction.analysis).toMatchObject({
        suggestedReply: null,
        followUpInDays: 10,
        qualifyingQuestions: [],
        caseIds: [],
      });
    });

    it('sugestão de resposta fora do e-mail vira rascunho sem assunto', async () => {
      const { opportunity } = await contacted();
      const { interaction } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'linkedin_manual',
        occurredAt: now.toISOString(),
        body: 'Oi! Vi sua mensagem, me conta mais sobre o trabalho de vocês.',
      });
      fake.next.reply = ok(
        analysis({
          suggestedReply: {
            subject: 'Re: identidade visual',
            body: 'Obrigado pelo retorno! Podemos combinar uma conversa curta?',
          },
        }),
        'relationship-reply/v1',
      );
      await service.analyzeReply(ctx, interaction.id);
      const reply = await service.draftSuggestedReply(ctx, interaction.id);
      expect(reply).toMatchObject({ channel: 'linkedin_manual', subject: null });
    });

    it('reescrever manda a versão anterior sem o rodapé; o rodapé volta uma vez só', async () => {
      const { message } = await prepared();
      fake.next.message = ok(
        { subject: message.subject, body: `Olá! Aqui é da ${AGENCY}. Versão mais curta.` },
        'relationship-message/v1',
      );
      const result = await service.regenerateMessage(ctx, {
        messageId: message.id,
        instruction: 'Mais curto.',
      });
      const request = fake.requests.message[0]!;
      expect(request.previous?.body).toContain(AGENCY);
      expect(request.previous?.body).not.toContain(OPT_OUT);
      expect(request.previous?.body).not.toContain('privacidade@agencia.example');
      if (result.status !== 'created') throw new Error('não reescrita');
      expect(result.message.body.split(OPT_OUT)).toHaveLength(2);
    });

    it('retirar a supressão exige motivo e fica auditado', async () => {
      const { company, opportunity } = await contacted();
      const entry = await service.suppressCompany(ctx, { companyId: company.id });
      expect(
        (
          await appError(
            service.liftSuppression(ctx, {
              companyId: company.id,
              suppressionId: entry.id,
              reason: 'curto',
            }),
          )
        ).reason,
      ).toBe('invalid_input');
      await service.liftSuppression(ctx, {
        companyId: company.id,
        suppressionId: entry.id,
        reason: 'A empresa pediu para voltar a receber.',
      });
      expect((await service.opportunity(ctx, opportunity.id)).opportunity.suppressed).toBe(false);
      expect(actions()).toContain('relationship.suppression.lifted');
    });

    it('retirada só no dossiê da empresa dona; pedido de titular (LGPD) não sai', async () => {
      const { company } = await contacted();
      const legal = await service.suppressCompany(ctx, {
        companyId: company.id,
        reason: 'legal_request',
      });
      expect(
        (
          await appError(
            service.liftSuppression(ctx, {
              companyId: company.id,
              suppressionId: legal.id,
              reason: 'Tentando retirar o pedido de titular.',
            }),
          )
        ).reason,
      ).toBe('suppression_locked');
      const manual = await service.suppressCompany(ctx, { companyId: company.id });
      expect(manual.id).not.toBe(legal.id);
      expect(
        (
          await appError(
            service.liftSuppression(ctx, {
              companyId: UNKNOWN_ID,
              suppressionId: manual.id,
              reason: 'Retirando pelo dossiê de outra empresa.',
            }),
          )
        ).reason,
      ).toBe('suppression_inherited');
    });

    it('o pedido da própria empresa fica registrado mesmo com supressão manual, ligado à resposta', async () => {
      const { company, opportunity } = await contacted();
      await service.suppressCompany(ctx, { companyId: company.id });
      const { interaction, stopDetected } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: 'Remova meu e-mail da base, por favor.',
      });
      expect(stopDetected).toBe(true);
      const active = (await service.opportunity(ctx, opportunity.id)).activeSuppressions;
      expect(active.map((entry) => entry.reason).sort()).toEqual(['manual', 'opt_out']);
      const own = active.find((entry) => entry.reason === 'opt_out')!;
      expect(own).toMatchObject({ source: 'reply_rule', interactionId: interaction.id });
      // Retirar a manual não apaga o pedido da empresa.
      const manual = active.find((entry) => entry.reason === 'manual')!;
      await service.liftSuppression(ctx, {
        companyId: company.id,
        suppressionId: manual.id,
        reason: 'Supressão manual feita por engano.',
      });
      expect((await service.opportunity(ctx, opportunity.id)).opportunity.suppressed).toBe(true);
    });

    it('nota que relata um pedido para parar suprime na hora, ligada à nota', async () => {
      const { opportunity } = await contacted();
      const plain = await service.recordNote(ctx, {
        opportunityId: opportunity.id,
        channel: 'phone',
        occurredAt: now.toISOString(),
        summary: 'Liguei e combinamos de falar na quinta.',
      });
      expect(plain.stopDetected).toBe(false);
      const { interaction, stopDetected } = await service.recordNote(ctx, {
        opportunityId: opportunity.id,
        channel: 'phone',
        occurredAt: now.toISOString(),
        summary: 'Liguei de novo; o sócio pediu: não nos procurem.',
      });
      expect(stopDetected).toBe(true);
      const detail = await service.opportunity(ctx, opportunity.id);
      expect(detail.opportunity.suppressed).toBe(true);
      expect(detail.activeSuppressions[0]).toMatchObject({
        reason: 'opt_out',
        source: 'user',
        interactionId: interaction.id,
      });
    });

    it('recusa não gera sugestão de resposta nem de follow-up, e não suprime sozinha', async () => {
      const { opportunity } = await contacted();
      const { interaction } = await service.recordInbound(ctx, {
        opportunityId: opportunity.id,
        channel: 'email',
        occurredAt: now.toISOString(),
        body: 'Obrigado pelo contato, mas não temos interesse.',
      });
      fake.next.reply = ok(
        analysis({ classification: 'refusal', confidence: 'high' }),
        'relationship-reply/v1',
      );
      const result = await service.analyzeReply(ctx, interaction.id);
      expect(result).toMatchObject({ status: 'analyzed', suppressedByAi: false });
      if (result.status !== 'analyzed') return;
      expect(result.interaction.analysis).toMatchObject({
        suggestedReply: null,
        followUpInDays: null,
      });
      expect((await service.opportunity(ctx, opportunity.id)).opportunity.suppressed).toBe(false);
    });

    it('a aprovação vale para um contato só, e o contato não é anterior à aprovação', async () => {
      const base = await prepared();
      await service.approveMessage(ctx, {
        messageId: base.message.id,
        payloadHash: base.message.payloadHash,
      });
      const before = new Date(now.getTime() - 60_000).toISOString();
      const early = await appError(
        service.recordOutbound(ctx, { messageId: base.message.id, occurredAt: before }),
      );
      expect(early.fieldErrors?.occurredAt).toBeTruthy();
      await service.recordOutbound(ctx, {
        messageId: base.message.id,
        occurredAt: now.toISOString(),
      });
      expect(
        (
          await appError(
            service.recordOutbound(ctx, {
              messageId: base.message.id,
              occurredAt: now.toISOString(),
            }),
          )
        ).reason,
      ).toBe('approval_used');
      const detail = await service.opportunity(ctx, base.opportunity.id);
      expect(detail.threads[0]!.problems).toEqual(['used']);
    });

    it('depois do primeiro contato, follow-up leva o opt-out (sem o canal do titular) e WhatsApp fica bloqueado', async () => {
      const { opportunity } = await contacted();
      const draft = await service.writeMessage(ctx, {
        opportunityId: opportunity.id,
        kind: 'follow_up',
        channel: 'email',
        subject: 'Retomando',
        body: 'Olá, retomando a conversa sobre a identidade visual.',
      });
      expect(draft.body).toContain(OPT_OUT);
      expect(draft.body).not.toContain('privacidade@agencia.example');
      const whatsapp = await service.writeMessage(ctx, {
        opportunityId: opportunity.id,
        kind: 'follow_up',
        channel: 'whatsapp_optin',
        subject: null,
        body: 'Olá, retomando a conversa sobre a identidade visual.',
      });
      const blocked = await appError(
        service.approveMessage(ctx, { messageId: whatsapp.id, payloadHash: whatsapp.payloadHash }),
      );
      expect(blocked.reason).toBe('message_blocked');
      expect(blocked.fieldErrors?.channel?.[0]).toContain('WhatsApp');
    });

    it('aprovada e revogada: o mesmo texto vira rascunho novo para aprovar de novo', async () => {
      const base = await prepared();
      const approval = await service.approveMessage(ctx, {
        messageId: base.message.id,
        payloadHash: base.message.payloadHash,
      });
      await service.revokeApproval(ctx, { approvalId: approval.id, reason: 'Revisar o texto.' });
      const again = await service.editMessage(ctx, {
        messageId: base.message.id,
        subject: base.message.subject,
        body: base.message.body,
      });
      expect(again).toMatchObject({
        status: 'draft',
        version: 2,
        threadId: base.message.threadId,
        body: base.message.body,
      });
    });
  });

  describe('F — pipeline', () => {
    it('movimentação persistida e auditada; etapa desatualizada e perda sem motivo são recusadas', async () => {
      const { company } = await companyWithFacts();
      const { opportunity } = await service.openOpportunity(ctx, { companyId: company.id });
      const moved = await service.changeStage(ctx, {
        opportunityId: opportunity.id,
        fromStage: 'identified',
        toStage: 'meeting',
      });
      expect(moved.stage).toBe('meeting');
      expect(
        (
          await appError(
            service.changeStage(ctx, {
              opportunityId: opportunity.id,
              fromStage: 'identified',
              toStage: 'proposal',
            }),
          )
        ).reason,
      ).toBe('concurrent_change');
      const noReason = await appError(
        service.changeStage(ctx, {
          opportunityId: opportunity.id,
          fromStage: 'meeting',
          toStage: 'lost',
        }),
      );
      expect(noReason.fieldErrors?.note).toBeDefined();
      const lost = await service.changeStage(ctx, {
        opportunityId: opportunity.id,
        fromStage: 'meeting',
        toStage: 'lost',
        note: 'Sem orçamento neste ano',
      });
      expect(lost).toMatchObject({ stage: 'lost', lostReason: 'Sem orçamento neste ano' });
      expect(lost.closedAt).toBe(now.toISOString());
      const entries = audit
        .entries()
        .filter((e) => e.action === 'relationship.opportunity.stage_changed');
      expect(entries.map((e) => e.diff)).toEqual([
        { from: 'identified', to: 'meeting' },
        { from: 'meeting', to: 'lost' },
      ]);
      expect(await service.listOpportunities(ctx)).toEqual([]);
      expect(await service.listOpportunities(ctx, { includeClosed: true })).toHaveLength(1);
    });

    it('valor só com base informada', async () => {
      const { company } = await companyWithFacts();
      const { opportunity } = await service.openOpportunity(ctx, { companyId: company.id });
      const error = await appError(
        service.updateOpportunity(ctx, {
          opportunityId: opportunity.id,
          offerId: null,
          priority: 'high',
          valueEstimateCents: 2_000_000,
        }),
      );
      expect(error.fieldErrors?.valueBasis).toBeDefined();
      const updated = await service.updateOpportunity(ctx, {
        opportunityId: opportunity.id,
        offerId: null,
        priority: 'high',
        valueEstimateCents: 2_000_000,
        valueBasis: 'Orçamento citado na reunião',
      });
      expect(updated).toMatchObject({ priority: 'high', valueEstimateCents: 2_000_000 });
      const overview = await service.overview(ctx);
      expect(overview.valueWithBasisCents).toBe(2_000_000);
    });
  });

  it('I — sem dados, a visão geral vem vazia (nada simulado)', async () => {
    const overview = await service.overview(ctx);
    expect(overview).toMatchObject({
      opportunities: [],
      attention: [],
      openCount: 0,
      draftsToReview: 0,
    });
    const queue = await service.approvalQueue(ctx);
    expect(queue.pending).toEqual([]);
    expect(queue.recent).toEqual([]);
  });

  it('a fila de aprovações mostra o rascunho com o que falta para aprovar', async () => {
    const { message } = await prepared({ lia: false });
    const queue = await service.approvalQueue(ctx);
    expect(queue.pending.map((item) => item.view.message.id)).toEqual([message.id]);
    expect(queue.compliance.ready).toBe(false);
  });
});
