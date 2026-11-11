import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader, type AuditedTable } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * M2 — empresas e Evidence Ledger (migração 20261110170000). Criar empresa e gravar evidências são
 * RPCs atômicas com uma linha de auditoria por operação (ADR-0010); fontes, evidências e
 * dependências são só inclusão; claim só muda estado e revisão. Dados SINTÉTICOS.
 */

const TRACE = '6a5b4c3d-2e1f-4a0b-9c8d-7e6f5a4b3c2d';
const CNPJ = '11222333000181';

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'prospect.company.created',
  entityType: 'company',
  entityId: null,
  diff: {},
  withVersion: false,
  ...overrides,
});

const viaApi = (q: Queryable, header?: string) =>
  q.query("select set_config('request.headers', $1, true)", [
    JSON.stringify({
      'content-type': 'application/json',
      ...(header === undefined ? {} : { 'x-prospector-audit': header }),
    }),
  ]);

const CREATE_COVERS: AuditedTable[] = [
  'company_identifiers',
  'sources',
  'claims',
  'claim_evidence',
];
const RECORD_COVERS: AuditedTable[] = ['sources', 'claims', 'claim_evidence', 'claim_dependencies'];

let counter = 0;
/** UUID v4 determinístico por teste (o app gera os ids de fontes e claims). */
function uuid(): string {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`;
}

function source(id: string) {
  return {
    id,
    kind: 'api_record',
    url: `https://api.opencnpj.org/${CNPJ}`,
    provider: 'opencnpj',
    external_ref: CNPJ,
    captured_at: '2026-11-10T12:00:00Z',
    excerpt_text: 'Razão social: ATELIE EXEMPLO LTDA',
    title: 'Cadastro do CNPJ',
  };
}

function fact(id: string, companyId: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    subject_type: 'company',
    subject_id: companyId,
    domain: 'firmographic',
    key: 'registry.legal_name',
    statement: 'Razão social: ATELIE EXEMPLO LTDA.',
    value: { legalName: 'ATELIE EXEMPLO LTDA' },
    epistemic_type: 'fact',
    confidence: 0.6,
    status: 'active',
    valid_until: '2027-05-09T12:00:00Z',
    ...extra,
  };
}

const evidence = (claimId: string, sourceId: string) => ({
  claim_id: claimId,
  source_id: sourceId,
  quote: 'Razão social: ATELIE EXEMPLO LTDA',
  reliability_tier: 'aggregator',
  quote_verified: true,
});

describe('M2 — empresas e Evidence Ledger no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  /** Cria pelo caminho do app: RPC com o cabeçalho de auditoria. */
  function createCompany(
    options: {
      cnpj?: string | null;
      domain?: string | null;
      withFact?: boolean;
      header?: string;
    } = {},
  ) {
    const id = uuid();
    const sourceId = uuid();
    const claimId = uuid();
    const cnpj = options.cnpj === undefined ? null : options.cnpj;
    return asServer(async (q) => {
      await viaApi(q, options.header ?? encodeAuditHeader('companies', pending(), CREATE_COVERS));
      const [row] = await q.query<{ id: string }>(
        `select public.create_company($1, $2, $3, $4, $5) as id`,
        [
          JSON.stringify({
            id,
            display_name: 'Ateliê Exemplo',
            cnpj,
            primary_domain: options.domain ?? null,
            origin: options.withFact ? 'cnpj_lookup' : 'manual',
          }),
          JSON.stringify(
            cnpj
              ? [{ kind: 'cnpj', value_normalized: cnpj, strength: 'strong', verified: true }]
              : [],
          ),
          JSON.stringify(options.withFact ? [source(sourceId)] : []),
          JSON.stringify(options.withFact ? [fact(claimId, id)] : []),
          JSON.stringify(options.withFact ? [evidence(claimId, sourceId)] : []),
        ],
      );
      return { id: row!.id, sourceId, claimId };
    });
  }

  function recordEvidence(
    companyId: string,
    args: {
      patch?: Record<string, unknown>;
      sources?: unknown[];
      claims?: unknown[];
      evidence?: unknown[];
      dependencies?: unknown[];
      supersede?: string[];
    },
    action = 'prospect.company.registry_refreshed',
  ) {
    return asServer(async (q) => {
      await viaApi(
        q,
        encodeAuditHeader('companies', pending({ action, entityId: companyId }), RECORD_COVERS),
      );
      return q.query('select public.record_evidence($1, $2, $3, $4, $5, $6, $7)', [
        companyId,
        JSON.stringify(args.patch ?? {}),
        JSON.stringify(args.sources ?? []),
        JSON.stringify(args.claims ?? []),
        JSON.stringify(args.evidence ?? []),
        JSON.stringify(args.dependencies ?? []),
        args.supersede ?? [],
      ]);
    });
  }

  const auditActions = (entityId: string) =>
    db.query<{ action: string; entity_type: string }>(
      'select action, entity_type from public.audit_log where entity_id = $1 order by id',
      [entityId],
    );

  const count = async (table: string, where = 'true', params: unknown[] = []) => {
    const [row] = await db.query<{ n: string }>(
      `select count(*) as n from public.${table} where ${where}`,
      params,
    );
    return Number(row!.n);
  };

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db.close();
  });

  it('create_company grava empresa, chaves e fatos com uma única linha de auditoria', async () => {
    const { id, claimId } = await createCompany({ cnpj: CNPJ, withFact: true });
    const [company] = await db.query<{ cnpj_root: string; lifecycle: string; search_text: string }>(
      'select cnpj_root, lifecycle, search_text from public.companies where id = $1',
      [id],
    );
    expect(company).toMatchObject({ cnpj_root: '11222333', lifecycle: 'candidate' });
    // Busca sem acento: "Ateliê" vira "atelie".
    expect(company!.search_text).toContain('atelie exemplo');
    expect(await count('company_identifiers', 'company_id = $1', [id])).toBe(1);
    expect(await count('claims', 'id = $1', [claimId])).toBe(1);
    expect(await count('claim_evidence', 'claim_id = $1', [claimId])).toBe(1);
    expect(await auditActions(id)).toEqual([
      { action: 'prospect.company.created', entity_type: 'company' },
    ]);
    // Fontes e claims cobertos pelo cabeçalho não ganham linha própria.
    expect(await count('audit_log', 'entity_id = $1', [claimId])).toBe(0);
  });

  it('CNPJ ou domínio repetido: company_duplicate, e nada fica gravado', async () => {
    await createCompany({ cnpj: '12ABC34501DE35', domain: 'exemplo-duplicado.test' });
    const before = await count('companies');
    await expectDbError(createCompany({ cnpj: '12ABC34501DE35' }), {
      message: 'company_duplicate',
      code: '23505',
    });
    await expectDbError(createCompany({ domain: 'exemplo-duplicado.test' }), {
      message: 'company_duplicate',
    });
    expect(await count('companies')).toBe(before);
  });

  it('CNPJ fora do formato e ciclo de vida desconhecido são recusados pelo banco', async () => {
    await expectDbError(createCompany({ cnpj: '11.222.333/0001-81' }), { code: '23514' });
    const { id } = await createCompany();
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q, encodeAuditHeader('companies', pending({ entityId: id })));
        return q.query("update public.companies set lifecycle = 'vendida' where id = $1", [id]);
      }),
      { code: '23514' },
    );
  });

  it('record_evidence substitui o claim anterior, atualiza a projeção e audita uma vez', async () => {
    const { id, claimId } = await createCompany({ cnpj: '44555666000181', withFact: true });
    const newSource = uuid();
    const newClaim = uuid();
    const inference = uuid();
    await recordEvidence(id, {
      patch: { city: 'CURITIBA', uf: 'PR', last_investigated_at: '2026-12-10T12:00:00Z' },
      sources: [source(newSource)],
      claims: [
        fact(newClaim, id, { supersedes_id: claimId }),
        {
          id: inference,
          subject_type: 'company',
          subject_id: id,
          domain: 'firmographic',
          key: 'size.estimate',
          statement: 'Empresa pequena, provavelmente.',
          epistemic_type: 'inference',
          confidence: 0.54,
          reasoning_factor: 0.9,
          reasoning: 'EPP.',
          status: 'active',
          valid_until: '2027-05-09T12:00:00Z',
        },
      ],
      evidence: [evidence(newClaim, newSource)],
      dependencies: [{ claim_id: inference, depends_on_claim_id: newClaim }],
      supersede: [claimId],
    });
    const statuses = await db.query<{ id: string; status: string }>(
      'select id, status from public.claims where subject_id = $1 order by created_at, id',
      [id],
    );
    expect(Object.fromEntries(statuses.map((row) => [row.id, row.status]))).toEqual({
      [claimId]: 'superseded',
      [newClaim]: 'active',
      [inference]: 'active',
    });
    const [company] = await db.query<{ city: string; uf: string; legal_name: string | null }>(
      'select city, uf, legal_name from public.companies where id = $1',
      [id],
    );
    // Campo fora do patch não muda.
    expect(company).toEqual({ city: 'CURITIBA', uf: 'PR', legal_name: null });
    expect((await auditActions(id)).map((row) => row.action)).toEqual([
      'prospect.company.created',
      'prospect.company.registry_refreshed',
    ]);
  });

  it('substituir claim que já saiu de cena: concurrent_change e o lote inteiro volta', async () => {
    const { id, claimId } = await createCompany({ cnpj: '77888999000181', withFact: true });
    const first = uuid();
    await recordEvidence(id, {
      claims: [fact(first, id, { supersedes_id: claimId })],
      supersede: [claimId],
    });
    const sourcesBefore = await count('sources');
    const second = uuid();
    await expectDbError(
      recordEvidence(id, {
        sources: [source(uuid())],
        claims: [fact(second, id, { supersedes_id: claimId })],
        supersede: [claimId],
      }),
      { message: 'concurrent_change', code: '40001' },
    );
    expect(await count('claims', 'id = $1', [second])).toBe(0);
    expect(await count('sources')).toBe(sourcesBefore);
    expect((await auditActions(id)).map((row) => row.action)).toHaveLength(2);
  });

  it('lote sem claim ou de empresa inexistente é recusado', async () => {
    const { id } = await createCompany();
    await expectDbError(recordEvidence(id, { sources: [source(uuid())] }), {
      message: 'invalid_input',
    });
    const ghost = uuid();
    await expectDbError(recordEvidence(ghost, { claims: [fact(uuid(), ghost)] }), {
      message: 'not_found',
    });
  });

  it('o banco repete as regras do contrato de claim', async () => {
    const { id } = await createCompany();
    // Hipótese não tem confiança; inferência precisa de fator entre 0,5 e 0,9.
    await expectDbError(
      recordEvidence(id, {
        claims: [fact(uuid(), id, { epistemic_type: 'hypothesis', reasoning: 'Talvez.' })],
      }),
      { code: '23514' },
    );
    await expectDbError(
      recordEvidence(id, {
        claims: [fact(uuid(), id, { epistemic_type: 'inference', reasoning_factor: 0.95 })],
      }),
      { code: '23514' },
    );
    await expectDbError(
      recordEvidence(id, { claims: [fact(uuid(), id, { key: 'Chave Livre' })] }),
      { code: '23514' },
    );
  });

  it('fontes e evidências são só inclusão; claim só muda estado e revisão', async () => {
    const { id, sourceId, claimId } = await createCompany({
      cnpj: '33000167000101',
      withFact: true,
    });
    // O servidor do app não tem privilégio de alterar o conteúdo…
    await expectDbError(
      asServer((q) =>
        q.query("update public.sources set excerpt_text = 'outro' where id = $1", [sourceId]),
      ),
      { code: '42501' },
    );
    await expectDbError(
      asServer((q) =>
        q.query("update public.claims set statement = 'Outra coisa qualquer' where id = $1", [
          claimId,
        ]),
      ),
      { code: '42501' },
    );
    await expectDbError(
      asServer((q) => q.query('delete from public.claims where id = $1', [claimId])),
      { code: '42501' },
    );
    // …e o trigger barra até o dono do banco.
    await expectDbError(
      db.query("update public.sources set title = 'x' where id = $1", [sourceId]),
      { message: 'append_only' },
    );
    await expectDbError(
      db.query('delete from public.claim_evidence where claim_id = $1', [claimId]),
      { message: 'append_only' },
    );
    // Estado do claim muda, com auditoria (revisão do usuário).
    await asServer(async (q) => {
      await viaApi(
        q,
        encodeAuditHeader(
          'claims',
          pending({ action: 'prospect.claim.rejected', entityType: 'claim', entityId: claimId }),
        ),
      );
      await q.query(
        "update public.claims set status = 'rejected', reviewed_at = now() where id = $1",
        [claimId],
      );
    });
    expect(await auditActions(claimId)).toEqual([
      { action: 'prospect.claim.rejected', entity_type: 'claim' },
    ]);
    expect(id).toBeTruthy();
  });

  it('pelo PostgREST, escrita sem o registro de auditoria é recusada', async () => {
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q);
        return q.query("select public.create_company($1, '[]', '[]', '[]', '[]')", [
          JSON.stringify({ id: uuid(), display_name: 'Sem auditoria', origin: 'manual' }),
        ]);
      }),
      { message: 'audit_missing' },
    );
    // Registro que não cobre as tabelas gravadas também é recusado.
    await expectDbError(
      createCompany({
        cnpj: '55666777000181',
        withFact: true,
        header: encodeAuditHeader('companies', pending()),
      }),
      { message: 'audit_invalid' },
    );
  });

  it('a API pública não lê empresas nem chama as RPCs', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expectDbError(
        db.asRole(role, (q) => q.query('select id from public.companies')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) => q.query('select id from public.claims')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) =>
          q.query("select public.create_company('{}', '[]', '[]', '[]', '[]')"),
        ),
        { code: '42501' },
      );
    }
  });

  describe('endurecimento do ledger (migração 20261110180000)', () => {
    it('conteúdo do claim não muda nem para o dono do banco; superseded e rejected são finais', async () => {
      const { id, claimId } = await createCompany({ cnpj: '21222333000105', withFact: true });
      await expectDbError(
        db.query("update public.claims set statement = 'Outra afirmação' where id = $1", [claimId]),
        { message: 'append_only' },
      );
      await expectDbError(
        db.query('update public.claims set confidence = 0.9 where id = $1', [claimId]),
        { message: 'append_only' },
      );
      await expectDbError(db.query('truncate public.claims cascade'), { message: 'append_only' });
      const replacement = uuid();
      await recordEvidence(id, { claims: [fact(replacement, id, { supersedes_id: claimId })] });
      // A lista de substituídos sai dos próprios claims (p_supersede vazio).
      const [old] = await db.query<{ status: string }>(
        'select status from public.claims where id = $1',
        [claimId],
      );
      expect(old?.status).toBe('superseded');
      await expectDbError(
        asServer(async (q) => {
          await viaApi(
            q,
            encodeAuditHeader(
              'claims',
              pending({
                action: 'prospect.claim.restored',
                entityType: 'claim',
                entityId: claimId,
              }),
            ),
          );
          return q.query("update public.claims set status = 'active' where id = $1", [claimId]);
        }),
        { message: 'claim_final_status' },
      );
    });

    it('o lote só grava claims, evidências e substituições da própria empresa', async () => {
      const a = await createCompany({ cnpj: '31222333000102', withFact: true });
      const b = await createCompany({ cnpj: '41222333000109', withFact: true });
      // Claim de outra empresa no lote.
      await expectDbError(recordEvidence(a.id, { claims: [fact(uuid(), b.id)] }), {
        message: 'invalid_input',
      });
      // Claim novo que já nasce substituído.
      await expectDbError(
        recordEvidence(a.id, { claims: [fact(uuid(), a.id, { status: 'superseded' })] }),
        { message: 'invalid_input' },
      );
      // Evidência para claim fora do lote.
      await expectDbError(
        recordEvidence(a.id, {
          claims: [fact(uuid(), a.id, { key: 'registry.status' })],
          evidence: [evidence(b.claimId, b.sourceId)],
        }),
        { message: 'invalid_input' },
      );
      // Substituir claim de outra empresa, ou de outra chave.
      await expectDbError(
        recordEvidence(a.id, { claims: [fact(uuid(), a.id, { supersedes_id: b.claimId })] }),
        { message: 'invalid_input' },
      );
      await expectDbError(
        recordEvidence(a.id, {
          claims: [fact(uuid(), a.id, { key: 'registry.status', supersedes_id: a.claimId })],
        }),
        { message: 'invalid_input' },
      );
      // p_supersede que não bate com os claims.
      await expectDbError(
        recordEvidence(a.id, {
          claims: [fact(uuid(), a.id, { supersedes_id: a.claimId })],
          supersede: [b.claimId],
        }),
        { message: 'invalid_input' },
      );
      const [row] = await db.query<{ status: string }>(
        'select status from public.claims where id = $1',
        [b.claimId],
      );
      expect(row?.status).toBe('active');
    });

    it('a chave conferida aponta para a fonte da consulta', async () => {
      const { id, sourceId } = await createCompany({ cnpj: '51222333000106', withFact: true });
      const [key] = await db.query<{ source_id: string | null; verified: boolean }>(
        "select source_id, verified from public.company_identifiers where company_id = $1 and kind = 'cnpj'",
        [id],
      );
      expect(key).toEqual({ source_id: sourceId, verified: true });
    });

    it('o servidor não altera CNPJ, origem nem demo, e não apaga empresa nem chave', async () => {
      const { id } = await createCompany({ cnpj: '61222333000103' });
      for (const change of ["cnpj = '11222333000181'", "origin = 'discovery'", 'is_demo = true']) {
        await expectDbError(
          asServer(async (q) => {
            await viaApi(q, encodeAuditHeader('companies', pending({ entityId: id })));
            return q.query(`update public.companies set ${change} where id = $1`, [id]);
          }),
          { code: '42501' },
        );
      }
      for (const table of ['companies', 'company_identifiers']) {
        const column = table === 'companies' ? 'id' : 'company_id';
        await expectDbError(
          asServer((q) => q.query(`delete from public.${table} where ${column} = $1`, [id])),
          { code: '42501' },
        );
      }
    });
  });
});
