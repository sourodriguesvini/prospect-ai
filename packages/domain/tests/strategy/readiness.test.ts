import type {
  IcpProfile,
  LiaVersion,
  Offer,
  ProofAsset,
  StrategySnapshot,
} from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { approachClearance, assessReadiness, discoveryClearance } from '../../src';

const TODAY = '2026-11-09';
const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_OFFER_ID = '22222222-2222-4222-8222-222222222222';
const ICP_ID = '33333333-3333-4333-8333-333333333333';

function offer(overrides: Partial<Offer> = {}, id = OFFER_ID): Offer {
  return {
    id,
    status: 'active',
    isDemo: false,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    current: {
      id: `${id.slice(0, -1)}a`,
      offerId: id,
      version: 2,
      createdAt: '2026-11-01T10:00:00Z',
      content: {
        name: 'Identidade visual para PMEs',
        description: '',
        problems: ['Marca inconsistente'],
        needSignals: ['Logotipos diferentes no site e nas redes'],
        disqualifiers: ['Rebranding recente'],
        deliverables: ['Sistema de identidade'],
        valueProps: [],
        priceMinCents: 1_000_000,
        priceMaxCents: 5_000_000,
      },
    },
    ...overrides,
  };
}

function icp(overrides: Partial<IcpProfile> = {}): IcpProfile {
  return {
    id: ICP_ID,
    offerId: OFFER_ID,
    status: 'active',
    isDemo: false,
    createdAt: '2026-11-01T10:00:00Z',
    updatedAt: '2026-11-01T10:00:00Z',
    current: {
      id: '44444444-4444-4444-8444-444444444444',
      icpId: ICP_ID,
      version: 1,
      createdAt: '2026-11-01T10:00:00Z',
      content: {
        name: 'Clínicas no PR',
        description: '',
        filters: {
          cnaes: ['8630-5/04'],
          ufs: ['PR'],
          municipalities: [],
          sizes: [],
          minAgeYears: null,
          maxAgeYears: null,
        },
        exclusions: { cnaes: [], municipalities: [], cnpjRoots: [], domains: [] },
      },
    },
    ...overrides,
  };
}

const approvedLia: LiaVersion = {
  id: '55555555-5555-4555-8555-555555555555',
  version: 1,
  createdAt: '2026-11-01T10:00:00Z',
  approvedAt: '2026-11-02T10:00:00Z',
  reviewDueOn: '2027-11-02',
  revokedAt: null,
  content: {
    purpose: 'p',
    legitimateInterest: 'l',
    necessity: 'n',
    dataCategories: ['name'],
    dataSources: ['company_website'],
    expectations: 'e',
    risks: 'r',
    safeguards: 's',
    conclusion: 'c',
  },
};

const publicCase: ProofAsset = {
  id: '66666666-6666-4666-8666-666666666666',
  offerId: null,
  title: 'Case',
  segment: '',
  summary: 'Resumo',
  results: '',
  publicOk: true,
  consentRef: 'E-mail de autorização',
  isDemo: false,
  archivedAt: null,
  createdAt: '2026-11-01T10:00:00Z',
  updatedAt: '2026-11-01T10:00:00Z',
};

function ready(overrides: Partial<StrategySnapshot> = {}): StrategySnapshot {
  return {
    offers: [offer()],
    rubrics: [
      {
        id: '77777777-7777-4777-8777-777777777777',
        offerId: OFFER_ID,
        version: 1,
        createdAt: '2026-11-01T10:00:00Z',
        content: {
          criteria: [
            {
              key: 'consistencia',
              label: 'Consistência',
              description: 'd',
              weight: 100,
              evidenceRequired: ['site_desktop'],
            },
          ],
        },
      },
    ],
    scoringModels: [
      {
        id: '88888888-8888-4888-8888-888888888888',
        offerId: OFFER_ID,
        version: 1,
        createdAt: '2026-11-01T10:00:00Z',
        content: {
          weights: { fit: 25, need: 30, signal: 20, capacity: 15, timing: 10 },
          thresholds: {
            pursuePriority: 70,
            prepareAccessPotential: 70,
            discardPotential: 40,
            minEvidenceCoverage: 50,
          },
        },
      },
    ],
    icps: [icp()],
    voiceGuide: {
      id: '99999999-9999-4999-8999-999999999999',
      version: 1,
      createdAt: '2026-11-01T10:00:00Z',
      content: { summary: 'Direta', principles: [], avoid: [], goodExamples: [], badExamples: [] },
    },
    contactPolicy: {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      version: 1,
      createdAt: '2026-11-01T10:00:00Z',
      content: {
        agencyName: 'Agência',
        privacyContact: 'privacidade@agencia.example',
        optOutText: 'Se não quiser mais receber mensagens, responda "remover".',
      },
    },
    liaVersions: [approvedLia],
    proofAssets: [publicCase],
    ...overrides,
  };
}

const empty: StrategySnapshot = {
  offers: [],
  rubrics: [],
  scoringModels: [],
  icps: [],
  voiceGuide: null,
  contactPolicy: null,
  liaVersions: [],
  proofAssets: [],
};

function missing(gate: { items: { code: string; ok: boolean; blocking: boolean }[] }) {
  return gate.items.filter((i) => !i.ok && i.blocking).map((i) => i.code);
}

describe('prontidão', () => {
  it('estratégia vazia: nada liberado e cada item explica o que falta', () => {
    const result = assessReadiness(empty, TODAY);
    expect(result.discover.ready).toBe(false);
    expect(result.approach.ready).toBe(false);
    expect(missing(result.approach)).toEqual([
      'offer_complete',
      'rubric',
      'scoring_model',
      'offer_active',
      'icp_active',
      'voice_guide',
      'contact_policy',
      'lia_approved',
    ]);
    for (const item of result.approach.items) expect(item.detail.length).toBeGreaterThan(5);
  });

  it('tudo configurado: descobrir e abordar liberados para a oferta', () => {
    const result = assessReadiness(ready(), TODAY);
    expect(result.discover).toMatchObject({ ready: true, offerId: OFFER_ID });
    expect(result.approach).toMatchObject({ ready: true, offerId: OFFER_ID });
    expect(missing(result.approach)).toEqual([]);
  });

  it('sem LIA aprovada: descobrir sim, abordar não, com explicação', () => {
    const result = assessReadiness(ready({ liaVersions: [] }), TODAY);
    expect(result.discover.ready).toBe(true);
    expect(result.approach.ready).toBe(false);
    // A oferta avaliada é informada mesmo bloqueada (a tela usa para os links de correção).
    expect(result.approach.offerId).toBe(OFFER_ID);
    expect(missing(result.approach)).toEqual(['lia_approved']);
    expect(result.approach.items.find((i) => i.code === 'lia_approved')?.detail).toMatch(/LIA/);
  });

  it('LIA revogada ou vencida bloqueia a abordagem', () => {
    const revoked = { ...approvedLia, revokedAt: '2026-11-05T10:00:00Z' };
    expect(missing(assessReadiness(ready({ liaVersions: [revoked] }), TODAY).approach)).toEqual([
      'lia_approved',
    ]);
    const expired = { ...approvedLia, reviewDueOn: '2026-11-08' };
    const item = assessReadiness(ready({ liaVersions: [expired] }), TODAY).approach.items.find(
      (i) => i.code === 'lia_approved',
    );
    expect(item?.ok).toBe(false);
    expect(item?.detail).toContain('08/11/2026');
  });

  it('sem oferta ativa: descobrir e abordar bloqueados', () => {
    const result = assessReadiness(ready({ offers: [offer({ status: 'draft' })] }), TODAY);
    expect(missing(result.discover)).toEqual(['offer_active']);
    expect(missing(result.approach)).toEqual(['offer_active']);
  });

  it('dados de demonstração nunca liberam nada', () => {
    const result = assessReadiness(
      ready({ offers: [offer({ isDemo: true })], icps: [icp({ isDemo: true })] }),
      TODAY,
    );
    expect(result.discover.ready).toBe(false);
    expect(result.approach.ready).toBe(false);
    expect(result.discover.items[0]?.detail).toMatch(/demonstração/);
  });

  it('ICP de demonstração não conta como ICP ativo', () => {
    const result = assessReadiness(ready({ icps: [icp({ isDemo: true })] }), TODAY);
    expect(missing(result.discover)).toEqual(['icp_active']);
  });

  it('oferta arquivada não conta, e a explicação diz isso', () => {
    const result = assessReadiness(ready({ offers: [offer({ status: 'archived' })] }), TODAY);
    expect(result.discover.ready).toBe(false);
    expect(result.discover.offerId).toBeNull();
    expect(result.discover.items.map((i) => i.detail)).toEqual([
      'Só há ofertas arquivadas; crie uma oferta nova.',
      'Depende de uma oferta.',
      'Depende de uma oferta.',
      'Depende de uma oferta.',
      'Depende de uma oferta.',
    ]);
  });

  it('case público de demonstração não conta', () => {
    const item = assessReadiness(
      ready({ proofAssets: [{ ...publicCase, isDemo: true }] }),
      TODAY,
    ).approach.items.find((i) => i.code === 'public_case');
    expect(item?.ok).toBe(false);
  });

  it('ICP ativo de outra oferta, ou sem versão atual, não conta', () => {
    for (const icps of [[icp({ offerId: OTHER_OFFER_ID })], [icp({ current: null })]]) {
      expect(missing(assessReadiness(ready({ icps }), TODAY).discover)).toEqual(['icp_active']);
    }
  });

  it('sem case público a abordagem continua liberada (só recomendação)', () => {
    const result = assessReadiness(ready({ proofAssets: [] }), TODAY);
    expect(result.approach.ready).toBe(true);
    const item = result.approach.items.find((i) => i.code === 'public_case');
    expect(item).toMatchObject({ ok: false, blocking: false });
  });

  it('case público de outra oferta não conta; case arquivado também não', () => {
    const other = { ...publicCase, offerId: OTHER_OFFER_ID };
    const archived = { ...publicCase, archivedAt: '2026-11-05T10:00:00Z' };
    for (const proofAssets of [[other], [archived]]) {
      const item = assessReadiness(ready({ proofAssets }), TODAY).approach.items.find(
        (i) => i.code === 'public_case',
      );
      expect(item?.ok).toBe(false);
    }
  });

  it('com duas ofertas, avalia a mais adiantada', () => {
    const draft = offer({ status: 'draft', current: null }, OTHER_OFFER_ID);
    const result = assessReadiness(ready({ offers: [draft, offer()] }), TODAY);
    expect(result.approach).toMatchObject({ ready: true, offerId: OFFER_ID });
  });

  describe('com escopo (barreiras das ações)', () => {
    const draftOther = offer({ status: 'draft' }, OTHER_OFFER_ID);

    it('avalia a oferta pedida, não a mais adiantada', () => {
      const s = ready({ offers: [offer(), draftOther] });
      const result = assessReadiness(s, TODAY, { offerId: OTHER_OFFER_ID });
      expect(result.approach).toMatchObject({ ready: false, offerId: OTHER_OFFER_ID });
      expect(missing(result.approach)).toEqual([
        'rubric',
        'scoring_model',
        'offer_active',
        'icp_active',
      ]);
      expect(approachClearance(s, TODAY, { offerId: OTHER_OFFER_ID })).toBeNull();
    });

    it('oferta inexistente ou de demonstração bloqueia com explicação', () => {
      const missingOffer = assessReadiness(ready(), TODAY, {
        offerId: '99999999-0000-4000-8000-000000000000',
      });
      expect(missingOffer.approach.items[0]?.detail).toBe('A oferta da ação não foi encontrada.');
      const demo = assessReadiness(ready({ offers: [offer({ isDemo: true })] }), TODAY, {
        offerId: OFFER_ID,
      });
      expect(demo.approach.items[0]?.detail).toMatch(/demonstração/);
    });

    it('ICP pedido precisa estar ativo e ser da oferta', () => {
      const paused = ready({ icps: [icp({ status: 'draft' })] });
      expect(
        missing(assessReadiness(paused, TODAY, { offerId: OFFER_ID, icpId: ICP_ID }).approach),
      ).toEqual(['icp_active']);
      const foreign = assessReadiness(ready({ offers: [offer(), draftOther] }), TODAY, {
        offerId: OTHER_OFFER_ID,
        icpId: ICP_ID,
      });
      expect(foreign.approach.items[0]?.detail).toBe('O ICP da ação não é desta oferta.');
    });

    it('liberada, devolve as versões conferidas', () => {
      expect(approachClearance(ready(), TODAY, { offerId: OFFER_ID, icpId: ICP_ID })).toEqual({
        offerId: OFFER_ID,
        offerVersionId: '11111111-1111-4111-8111-11111111111a',
        rubricVersionId: '77777777-7777-4777-8777-777777777777',
        scoringModelVersionId: '88888888-8888-4888-8888-888888888888',
        icpVersionId: '44444444-4444-4444-8444-444444444444',
        voiceGuideVersionId: '99999999-9999-4999-8999-999999999999',
        contactPolicyVersionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        liaVersionId: '55555555-5555-4555-8555-555555555555',
      });
      expect(discoveryClearance(ready(), TODAY, { icpId: ICP_ID })).toMatchObject({
        offerId: OFFER_ID,
        icpId: ICP_ID,
        icpVersionId: '44444444-4444-4444-8444-444444444444',
      });
    });

    it('armazenamento que some (modo memória) bloqueia a abordagem, não a descoberta', () => {
      const result = assessReadiness(ready(), TODAY, {}, { ephemeralStorage: true });
      expect(result.discover.ready).toBe(true);
      expect(missing(result.approach)).toEqual(['persistent_storage']);
      expect(
        approachClearance(ready(), TODAY, { offerId: OFFER_ID }, { ephemeralStorage: true }),
      ).toBeNull();
    });
  });

  it('a lista de abordagem contém os itens de descoberta e os de conformidade', () => {
    const result = assessReadiness(ready(), TODAY);
    expect(result.discover.items.map((i) => i.code)).toEqual([
      'offer_complete',
      'rubric',
      'scoring_model',
      'offer_active',
      'icp_active',
    ]);
    expect(result.approach.items.map((i) => i.code)).toEqual([
      'offer_complete',
      'rubric',
      'scoring_model',
      'offer_active',
      'icp_active',
      'voice_guide',
      'contact_policy',
      'lia_approved',
      'public_case',
    ]);
  });
});
