import type { PendingAudit } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { createServerSupabaseClient, createSupabaseCompanyRepository, searchTerm } from '../../src';

/**
 * Adaptador de empresas contra respostas HTTP do PostgREST simuladas: caminho, filtros, cabeçalho
 * de auditoria e mapeamento das linhas. O comportamento do banco está em tests/db/companies.
 */

const URL_BASE = 'http://supabase.local.test';
const TRACE = '0b7c6d3e-4f2a-4b8c-9d1e-2f3a4b5c6d7e';
const COMPANY_ID = '2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f';

interface Captured {
  url: URL;
  method: string;
  headers: Headers;
  body: string | null;
}

function stub(respond: (req: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: typeof init?.body === 'string' ? init.body : null,
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, 'chave-de-teste-nao-real', {
    fetch: fetchStub,
  });
  return { repo: createSupabaseCompanyRepository(client), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const ROW = {
  id: COMPANY_ID,
  display_name: 'Ateliê Exemplo',
  legal_name: 'ATELIE EXEMPLO LTDA',
  cnpj: '11222333000181',
  cnpj_root: '11222333',
  primary_domain: null,
  city: 'CURITIBA',
  uf: 'PR',
  cnae_main: '3101-2/00',
  size_band: 'epp',
  lifecycle: 'candidate',
  origin: 'cnpj_lookup',
  last_investigated_at: '2026-11-10T12:00:00.123456+00:00',
  is_demo: false,
  created_at: '2026-11-10T12:00:00.123456+00:00',
  updated_at: '2026-11-10T12:00:00+00:00',
};

const audit: PendingAudit = {
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'prospect.company.created',
  entityType: 'company',
  entityId: null,
  diff: { origin: 'manual' },
  withVersion: false,
};

function decodeAudit(call: Captured | undefined) {
  const header = call?.headers.get('x-prospector-audit');
  return header
    ? (JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as Record<string, unknown>)
    : null;
}

describe('busca de empresas', () => {
  it('dobra o termo como a coluna search_text e tira curingas', () => {
    expect(searchTerm('  Ateliê  EXEMPLO ')).toBe('atelie exemplo');
    expect(searchTerm('11.222.333/0001-81')).toBe('11222333000181');
    expect(searchTerm('12.ABC.345/01DE-35')).toBe('12abc34501de35');
    expect(searchTerm('100%_*,(x)')).toBe('100 x');
    expect(searchTerm('exemplo.com.br')).toBe('exemplo.com.br');
  });
});

describe('createSupabaseCompanyRepository', () => {
  it('list: filtra por busca e esconde arquivadas, mais recentes primeiro', async () => {
    const { repo, calls } = stub(() => json(200, [ROW]));
    const list = await repo.list({
      search: 'Ateliê',
      lifecycle: null,
      includeArchived: false,
      limit: 20,
    });
    expect(list).toEqual([
      expect.objectContaining({
        id: COMPANY_ID,
        displayName: 'Ateliê Exemplo',
        cnpjRoot: '11222333',
        lastInvestigatedAt: '2026-11-10T12:00:00.123Z',
        createdAt: '2026-11-10T12:00:00.123Z',
      }),
    ]);
    const url = calls[0]?.url;
    expect(url?.pathname).toBe('/rest/v1/companies');
    expect(url?.searchParams.get('search_text')).toBe('ilike.%atelie%');
    expect(url?.searchParams.get('lifecycle')).toBe('neq.archived');
    expect(url?.searchParams.get('order')).toBe('updated_at.desc');
    expect(url?.searchParams.get('limit')).toBe('20');
  });

  it('create: RPC com o registro de auditoria em companies, cobrindo as demais tabelas', async () => {
    const { repo, calls } = stub((req) =>
      req.url.pathname.endsWith('/rpc/create_company') ? json(200, COMPANY_ID) : json(200, ROW),
    );
    const company = await repo.create(
      {
        id: COMPANY_ID,
        displayName: 'Ateliê Exemplo',
        legalName: null,
        cnpj: '11222333000181',
        primaryDomain: null,
        city: null,
        uf: null,
        cnaeMain: null,
        sizeBand: null,
        origin: 'manual',
        lastInvestigatedAt: null,
        isDemo: false,
      },
      [{ kind: 'cnpj', valueNormalized: '11222333000181', strength: 'strong', verified: false }],
      { sources: [], claims: [], evidence: [] },
      audit,
    );
    expect(company.id).toBe(COMPANY_ID);
    const [rpc] = calls;
    expect(rpc?.method).toBe('POST');
    expect(rpc?.url.pathname).toBe('/rest/v1/rpc/create_company');
    expect(JSON.parse(rpc?.body ?? '{}')).toMatchObject({
      p_company: { id: COMPANY_ID, display_name: 'Ateliê Exemplo', origin: 'manual' },
      p_identifiers: [{ kind: 'cnpj', value_normalized: '11222333000181', strength: 'strong' }],
      p_sources: [],
      p_claims: [],
      p_evidence: [],
    });
    expect(decodeAudit(rpc)).toMatchObject({
      table: 'companies',
      covers: ['company_identifiers', 'sources', 'claims', 'claim_evidence'],
      action: 'prospect.company.created',
      traceId: TRACE,
    });
  });

  it('create: CNPJ repetido vira conflito com motivo próprio', async () => {
    const { repo } = stub(() => json(409, { code: '23505', message: 'company_duplicate' }));
    await expect(
      repo.create(
        {
          id: COMPANY_ID,
          displayName: 'X',
          legalName: null,
          cnpj: '11222333000181',
          primaryDomain: null,
          city: null,
          uf: null,
          cnaeMain: null,
          sizeBand: null,
          origin: 'manual',
          lastInvestigatedAt: null,
          isDemo: false,
        },
        [],
        { sources: [], claims: [], evidence: [] },
        audit,
      ),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'company_duplicate' });
  });

  it('record: só os campos do patch vão para a RPC; corrida vira concurrent_change', async () => {
    const { repo, calls } = stub(() => json(409, { code: '40001', message: 'concurrent_change' }));
    await expect(
      repo.record(
        COMPANY_ID,
        { city: 'CURITIBA', lastInvestigatedAt: '2026-11-10T12:00:00.000Z' },
        { sources: [], claims: [], evidence: [], dependencies: [], supersede: ['x'] },
        { ...audit, action: 'prospect.company.registry_refreshed', entityId: COMPANY_ID },
      ),
    ).rejects.toMatchObject({ code: 'conflict', reason: 'concurrent_change' });
    expect(JSON.parse(calls[0]?.body ?? '{}')).toMatchObject({
      p_company_id: COMPANY_ID,
      p_company_patch: { city: 'CURITIBA', last_investigated_at: '2026-11-10T12:00:00.000Z' },
      p_supersede: ['x'],
      p_dependencies: [],
    });
    expect(Object.keys(JSON.parse(calls[0]?.body ?? '{}').p_company_patch)).toEqual([
      'city',
      'last_investigated_at',
    ]);
    expect(decodeAudit(calls[0])).toMatchObject({
      table: 'companies',
      covers: ['sources', 'claims', 'claim_evidence', 'claim_dependencies'],
    });
  });

  it('linha fora do contrato falha alto (não chega torta à tela)', async () => {
    const { repo } = stub(() => json(200, [{ ...ROW, lifecycle: 'vendida' }]));
    await expect(
      repo.list({ search: '', lifecycle: null, includeArchived: true, limit: 5 }),
    ).rejects.toThrow();
  });
});
