import { AppError } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { createServerSupabaseClient, createSupabaseStrategyRepository } from '../../src';

/**
 * Adaptador da estratégia contra respostas do PostgREST simuladas (sem Supabase real): rotas,
 * filtros, corpo em snake_case e mapeamento das linhas. O comportamento do banco (versões
 * somente inclusão, numeração, LIA) está em tests/db/strategy.test.ts.
 */

const URL_BASE = 'http://supabase.local.test';
const OFFER_ID = '11111111-1111-4111-8111-111111111111';
const LIA_ID = '22222222-2222-4222-8222-222222222222';
const AT = '2026-11-09T12:00:00+00:00';

interface Captured {
  url: URL;
  method: string;
  body: unknown;
}

function stub(respond: (req: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, 'chave-de-teste-nao-real', {
    fetch: fetchStub,
  });
  return { repo: createSupabaseStrategyRepository(client), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const path = (req: Captured) => req.url.pathname.replace('/rest/v1/', '');

const OFFER_ROW = { id: OFFER_ID, status: 'draft', is_demo: false, created_at: AT, updated_at: AT };
const OFFER_VERSION_ROW = {
  id: '33333333-3333-4333-8333-333333333333',
  offer_id: OFFER_ID,
  version: 1,
  name: 'Identidade visual',
  description: '',
  problems: ['Marca desatualizada'],
  need_signals: [],
  disqualifiers: [],
  deliverables: [],
  value_props: [],
  price_min_cents: 1500000,
  price_max_cents: '4000000',
  created_at: AT,
};
const LIA_ROW = {
  id: LIA_ID,
  version: 1,
  purpose: 'p',
  legitimate_interest: 'l',
  necessity: 'n',
  data_categories: ['name'],
  data_sources: ['company_website'],
  expectations: 'e',
  risks: 'r',
  safeguards: 's',
  conclusion: 'c',
  approved_at: AT,
  review_due_on: '2027-11-09',
  revoked_at: null,
  created_at: AT,
};

describe('createSupabaseStrategyRepository', () => {
  it('createOffer: RPC create_offer com colunas em snake_case e releitura da oferta', async () => {
    const { repo, calls } = stub((req) => {
      if (path(req) === 'rpc/create_offer') return json(200, OFFER_ID);
      if (path(req) === 'offers') return json(200, OFFER_ROW);
      return json(200, OFFER_VERSION_ROW);
    });
    const offer = await repo.createOffer({
      name: 'Identidade visual',
      description: '',
      problems: ['Marca desatualizada'],
      needSignals: [],
      disqualifiers: [],
      deliverables: [],
      valueProps: [],
      priceMinCents: 1_500_000,
      priceMaxCents: 4_000_000,
    });
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(path(calls[0]!)).toBe('rpc/create_offer');
    expect(calls[0]?.body).toEqual({
      p_version: {
        name: 'Identidade visual',
        description: '',
        problems: ['Marca desatualizada'],
        need_signals: [],
        disqualifiers: [],
        deliverables: [],
        value_props: [],
        price_min_cents: 1_500_000,
        price_max_cents: 4_000_000,
      },
    });
    expect(calls.slice(1).map(path).sort()).toEqual(['current_offer_versions', 'offers']);
    expect(offer).toMatchObject({
      id: OFFER_ID,
      status: 'draft',
      current: { version: 1, content: { priceMaxCents: 4_000_000, needSignals: [] } },
    });
  });

  it('addRubricVersion: insere só oferta e critérios; o número vem do banco', async () => {
    const { repo, calls } = stub(() =>
      json(201, {
        id: '44444444-4444-4444-8444-444444444444',
        offer_id: OFFER_ID,
        version: 3,
        criteria: [
          {
            key: 'consistencia',
            label: 'C',
            description: 'D',
            weight: 100,
            evidenceRequired: ['logo'],
          },
        ],
        created_at: AT,
      }),
    );
    const version = await repo.addRubricVersion(OFFER_ID, {
      criteria: [
        {
          key: 'consistencia',
          label: 'C',
          description: 'D',
          weight: 100,
          evidenceRequired: ['logo'],
        },
      ],
    });
    expect(path(calls[0]!)).toBe('audit_rubrics');
    expect(calls[0]?.body).not.toHaveProperty('version');
    expect(version.version).toBe(3);
  });

  it('approveLia: PATCH condicional (approved_at is null); sem linha e versão existente → conflito', async () => {
    const { repo, calls } = stub((req) =>
      req.method === 'PATCH' ? json(200, []) : json(200, LIA_ROW),
    );
    const error = await repo
      .approveLia(LIA_ID, { approvedAt: AT, reviewDueOn: '2027-11-09' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'conflict', reason: 'lia_decision_locked' });
    const [patch] = calls;
    expect(patch?.method).toBe('PATCH');
    expect(patch?.url.searchParams.get('id')).toBe(`eq.${LIA_ID}`);
    expect(patch?.url.searchParams.get('approved_at')).toBe('is.null');
    expect(patch?.body).toEqual({ approved_at: AT, review_due_on: '2027-11-09' });
  });

  it('revokeLia: exige aprovada e não revogada; devolve a versão mapeada', async () => {
    const { repo, calls } = stub(() => json(200, [{ ...LIA_ROW, revoked_at: AT }]));
    const revoked = await repo.revokeLia(LIA_ID, AT);
    expect(revoked.revokedAt).toBe(AT);
    expect(calls[0]?.url.searchParams.get('revoked_at')).toBe('is.null');
    expect(calls[0]?.url.searchParams.get('approved_at')).toBe('not.is.null');
  });

  it('loadSnapshot: lê as views de versão atual e junta com os cabeçalhos', async () => {
    const { repo, calls } = stub((req) => {
      switch (path(req)) {
        case 'offers':
          return json(200, [OFFER_ROW]);
        case 'current_offer_versions':
          return json(200, [OFFER_VERSION_ROW]);
        case 'legal_basis_assessments':
          return json(200, [LIA_ROW]);
        default:
          return json(200, []);
      }
    });
    const snapshot = await repo.loadSnapshot();
    expect(calls.map(path).sort()).toEqual([
      'contact_policies',
      'current_audit_rubrics',
      'current_icp_profile_versions',
      'current_offer_versions',
      'current_scoring_models',
      'icp_profiles',
      'legal_basis_assessments',
      'offers',
      'proof_assets',
      'voice_guides',
    ]);
    expect(snapshot.offers[0]?.current?.version).toBe(1);
    expect(snapshot.liaVersions[0]?.reviewDueOn).toBe('2027-11-09');
    expect(snapshot).toMatchObject({ voiceGuide: null, contactPolicy: null, icps: [] });
  });

  it.each([
    ['23503', 'not_found', 'not_found'],
    ['23505', 'conflict', 'concurrent_change'],
    ['23514', 'validation', 'invalid_input'],
  ])('erro %s do banco vira AppError %s/%s', async (code, appCode, reason) => {
    const { repo } = stub(() => json(409, { code, message: 'detalhe interno', details: null }));
    const error = await repo
      .addOfferVersion(OFFER_ID, {
        name: 'x',
        description: '',
        problems: [],
        needSignals: [],
        disqualifiers: [],
        deliverables: [],
        valueProps: [],
        priceMinCents: null,
        priceMaxCents: null,
      })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: appCode, reason });
  });

  it('linha fora do formato esperado falha alto (mudança de esquema)', async () => {
    const { repo } = stub(() => json(200, [{ ...LIA_ROW, data_categories: 'name' }]));
    await expect(repo.listLiaVersions()).rejects.toThrow();
  });
});
