import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tablePrivileges } from '../support/catalog';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * F2 — estratégia (ADR-0009): versões somente inclusão com número atribuído pelo banco,
 * pesos que somam 100, case público só com autorização e LIA com decisão única.
 */

const VERSION_TABLES = [
  'offer_versions',
  'audit_rubrics',
  'scoring_models',
  'icp_profile_versions',
  'voice_guides',
  'contact_policies',
] as const;

const offerVersion = (overrides: Record<string, unknown> = {}) => ({
  name: 'Identidade visual para clínicas',
  description: 'Rebranding completo.',
  problems: ['Marca desatualizada'],
  need_signals: ['Site sem versão mobile'],
  disqualifiers: ['Rebrand recente'],
  deliverables: ['Manual de marca'],
  value_props: [],
  price_min_cents: 1_500_000,
  price_max_cents: 4_000_000,
  ...overrides,
});

const createOffer = async (q: Queryable, overrides: Record<string, unknown> = {}) => {
  const rows = await q.query<{ id: string }>('select public.create_offer($1::jsonb) as id', [
    JSON.stringify(offerVersion(overrides)),
  ]);
  return rows[0]!.id;
};

const criterion = (key: string, weight: number) => ({
  key,
  label: key,
  description: '',
  weight,
  evidenceRequired: ['site_desktop'],
});

const insertRubric = (q: Queryable, offerId: string, criteria: unknown[]) =>
  q.query<{ version: number }>(
    'insert into public.audit_rubrics (offer_id, criteria) values ($1, $2::jsonb) returning version',
    [offerId, JSON.stringify(criteria)],
  );

const insertScoring = (
  q: Queryable,
  offerId: string,
  weights = [25, 30, 20, 15, 10],
  thresholds = [70, 70, 40, 50],
) =>
  q.query<{ version: number }>(
    `insert into public.scoring_models (
       offer_id, weight_fit, weight_need, weight_signal, weight_capacity, weight_timing,
       pursue_priority, prepare_access_potential, discard_potential, min_evidence_coverage)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning version`,
    [offerId, ...weights, ...thresholds],
  );

const lia = {
  purpose: 'Prospecção B2B de serviços de branding.',
  legitimate_interest: 'Oferecer serviço relevante ao negócio.',
  necessity: 'Só dados profissionais públicos.',
  expectations: 'Contato profissional esperado.',
  risks: 'Incômodo com mensagem não solicitada.',
  safeguards: 'Opt-out imediato.',
  conclusion: 'Interesse legítimo prevalece.',
};

/** Data de revisão válida em qualquer dia em que o teste rode (fuso da agência). */
const AGENCY_TODAY = "(now() at time zone 'America/Sao_Paulo')::date";
const IN_ONE_YEAR = `(${AGENCY_TODAY} + 365)`;

const insertLia = (q: Queryable) =>
  q.query<{ id: string; version: number }>(
    `insert into public.legal_basis_assessments (
       purpose, legitimate_interest, necessity, data_categories, data_sources,
       expectations, risks, safeguards, conclusion)
     values ($1, $2, $3, '{name,work_email}', '{company_website}', $4, $5, $6, $7)
     returning id, version`,
    [
      lia.purpose,
      lia.legitimate_interest,
      lia.necessity,
      lia.expectations,
      lia.risks,
      lia.safeguards,
      lia.conclusion,
    ],
  );

describe('F2 — estratégia no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  beforeAll(async () => {
    db = await createTestDb();
  });
  afterAll(async () => {
    await db.close();
  });

  describe('ofertas', () => {
    it('create_offer cria cabeçalho em rascunho e a versão 1 numa chamada só', async () => {
      const id = await asServer((q) => createOffer(q));
      const [offer] = await asServer((q) =>
        q.query<{ status: string; is_demo: boolean }>(
          'select status, is_demo from public.offers where id = $1',
          [id],
        ),
      );
      expect(offer).toEqual({ status: 'draft', is_demo: false });
      const versions = await asServer((q) =>
        q.query<{ version: number; problems: string[]; price_max_cents: string | number }>(
          'select version, problems, price_max_cents from public.offer_versions where offer_id = $1',
          [id],
        ),
      );
      // bigint: o driver pg devolve texto; o PGlite, número.
      expect(versions.map((v) => ({ ...v, price_max_cents: Number(v.price_max_cents) }))).toEqual([
        { version: 1, problems: ['Marca desatualizada'], price_max_cents: 4_000_000 },
      ]);
    });

    it('o banco numera as versões por oferta e ignora o número enviado pelo app', async () => {
      const a = await asServer((q) => createOffer(q));
      const b = await asServer((q) => createOffer(q));
      const insert = (offerId: string, name: string) =>
        asServer((q) =>
          q.query<{ version: number }>(
            `insert into public.offer_versions (offer_id, version, name) values ($1, 99, $2)
             returning version`,
            [offerId, name],
          ),
        );
      expect((await insert(a, 'A2'))[0]?.version).toBe(2);
      expect((await insert(a, 'A3'))[0]?.version).toBe(3);
      expect((await insert(b, 'B2'))[0]?.version).toBe(2);
      const current = await asServer((q) =>
        q.query<{ name: string; version: number }>(
          'select name, version from public.current_offer_versions where offer_id = $1',
          [a],
        ),
      );
      expect(current).toEqual([{ name: 'A3', version: 3 }]);
    });

    it('recusa faixa invertida, item vazio e nome em branco', async () => {
      for (const overrides of [
        { price_min_cents: 10, price_max_cents: 5 },
        { problems: ['ok', '  '] },
        { name: '   ' },
        { price_min_cents: -1 },
      ]) {
        await expectDbError(
          asServer((q) => createOffer(q, overrides)),
          { code: '23514' },
        );
      }
    });

    it('servidor só troca o status do cabeçalho; is_demo e apagar ficam de fora', async () => {
      const id = await asServer((q) => createOffer(q));
      await asServer((q) =>
        q.query("update public.offers set status = 'active' where id = $1", [id]),
      );
      await expectDbError(
        asServer((q) => q.query('update public.offers set is_demo = true where id = $1', [id])),
        { code: '42501' },
      );
      await expectDbError(
        asServer((q) => q.query('delete from public.offers where id = $1', [id])),
        { code: '42501' },
      );
      await expectDbError(
        asServer((q) => q.query("update public.offers set status = 'paused' where id = $1", [id])),
        { code: '23514' },
      );
    });
  });

  describe('versões somente inclusão', () => {
    it.each(VERSION_TABLES)('%s: servidor só lê e inclui', async (table) => {
      expect(await tablePrivileges(db, 'service_role', table)).toEqual(['SELECT', 'INSERT']);
    });

    it('update, delete e truncate falham inclusive para o dono do banco', async () => {
      const id = await asServer((q) => createOffer(q));
      await expectDbError(
        asServer((q) =>
          q.query("update public.offer_versions set name = 'x' where offer_id = $1", [id]),
        ),
        { code: '42501' },
      );
      for (const table of VERSION_TABLES) {
        await expectDbError(db.query(`update public.${table} set created_at = now()`), {
          message: 'version_immutable',
        });
        await expectDbError(db.query(`delete from public.${table}`), {
          message: 'version_immutable',
        });
        await expectDbError(db.query(`truncate public.${table} cascade`), {
          message: 'version_immutable',
        });
      }
    });

    it('a versão usada continua igual depois de uma edição (nova versão)', async () => {
      const id = await asServer((q) => createOffer(q));
      const [v1] = await asServer((q) =>
        q.query<{ id: string }>(
          'select id from public.offer_versions where offer_id = $1 and version = 1',
          [id],
        ),
      );
      await asServer((q) =>
        q.query("insert into public.offer_versions (offer_id, name) values ($1, 'Nome novo')", [
          id,
        ]),
      );
      const [still] = await asServer((q) =>
        q.query<{ name: string; version: number }>(
          'select name, version from public.offer_versions where id = $1',
          [v1!.id],
        ),
      );
      expect(still).toEqual({ name: 'Identidade visual para clínicas', version: 1 });
    });
  });

  describe('datas e status vêm do banco', () => {
    it('versão ignora created_at enviado; cabeçalho nasce em rascunho mesmo pedindo ativo', async () => {
      const id = await asServer((q) => createOffer(q));
      const [version] = await asServer((q) =>
        q.query<{ created_at: string }>(
          `insert into public.offer_versions (offer_id, name, created_at)
           values ($1, 'Outro nome', '2000-01-01') returning created_at::text`,
          [id],
        ),
      );
      expect(version!.created_at.startsWith('2000')).toBe(false);
      const [header] = await asServer((q) =>
        q.query<{ status: string; created_at: string }>(
          `insert into public.offers (status, created_at) values ('active', '2000-01-01')
           returning status, created_at::text`,
        ),
      );
      expect(header!.status).toBe('draft');
      expect(header!.created_at.startsWith('2000')).toBe(false);
    });

    it('numera por pai ou por tabela em todas as tabelas de versão', async () => {
      const offerId = await asServer((q) => createOffer(q));
      const scoring = [
        (await asServer((q) => insertScoring(q, offerId)))[0]?.version,
        (await asServer((q) => insertScoring(q, offerId)))[0]?.version,
      ];
      expect(scoring).toEqual([1, 2]);
      const [icp] = await asServer((q) =>
        q.query<{ id: string }>(
          `select public.create_icp_profile($1, '{"name": "ICP"}'::jsonb) as id`,
          [offerId],
        ),
      );
      const [icpV2] = await asServer((q) =>
        q.query<{ version: number }>(
          `insert into public.icp_profile_versions (icp_id, name, version)
           values ($1, 'ICP v2', 99) returning version`,
          [icp!.id],
        ),
      );
      expect(icpV2!.version).toBe(2);
      for (const sql of [
        `insert into public.voice_guides (summary, version) values ('Direta.', 99) returning version`,
        `insert into public.contact_policies (agency_name, privacy_contact, opt_out_text, version)
         values ('Agência', 'privacidade@agencia.example', 'Responda remover.', 99) returning version`,
      ]) {
        const first = await asServer((q) => q.query<{ version: number }>(sql));
        const second = await asServer((q) => q.query<{ version: number }>(sql));
        expect(second[0]!.version).toBe(first[0]!.version + 1);
      }
    });
  });

  describe('rubrica e modelo de score', () => {
    it('aceita rubrica com pesos inteiros que somam 100 e numera por oferta', async () => {
      const id = await asServer((q) => createOffer(q));
      const v1 = await asServer((q) =>
        insertRubric(q, id, [criterion('consistencia', 60), criterion('legibilidade', 40)]),
      );
      const v2 = await asServer((q) => insertRubric(q, id, [criterion('consistencia', 100)]));
      expect([v1[0]?.version, v2[0]?.version]).toEqual([1, 2]);
    });

    it('recusa pesos que não somam 100, chave repetida, peso fracionário e lista vazia', async () => {
      const id = await asServer((q) => createOffer(q));
      for (const criteria of [
        [criterion('a_1', 60), criterion('b_1', 30)],
        [criterion('a_1', 50), criterion('a_1', 50)],
        [criterion('a_1', 50.5), criterion('b_1', 49.5)],
        [{ ...criterion('a_1', 100), evidenceRequired: [] }],
        [criterion('Chave Invalida', 100)],
        [],
      ]) {
        await expectDbError(
          asServer((q) => insertRubric(q, id, criteria)),
          { code: '23514' },
        );
      }
    });

    it('modelo de score: pesos somam 100 e descarte abaixo dos outros limiares', async () => {
      const id = await asServer((q) => createOffer(q));
      expect((await asServer((q) => insertScoring(q, id)))[0]?.version).toBe(1);
      await expectDbError(
        asServer((q) => insertScoring(q, id, [25, 30, 20, 15, 11])),
        { code: '23514' },
      );
      await expectDbError(
        asServer((q) => insertScoring(q, id, undefined, [70, 70, 70, 50])),
        { code: '23514' },
      );
      await expectDbError(
        asServer((q) => insertScoring(q, id, [101, 0, 0, 0, -1])),
        { code: '23514' },
      );
    });
  });

  describe('ICP', () => {
    const icpVersion = (overrides: Record<string, unknown> = {}) =>
      JSON.stringify({
        name: 'Clínicas em Curitiba',
        cnaes: ['8630-5/04'],
        ufs: ['PR'],
        municipalities: [{ name: 'Curitiba', uf: 'PR' }],
        sizes: ['me', 'epp'],
        min_age_years: 3,
        excluded_cnpj_roots: ['12345678'],
        excluded_domains: ['exemplo.com.br'],
        ...overrides,
      });

    it('create_icp_profile cria perfil em rascunho com a versão 1', async () => {
      const offerId = await asServer((q) => createOffer(q));
      const [row] = await asServer((q) =>
        q.query<{ id: string }>('select public.create_icp_profile($1, $2::jsonb) as id', [
          offerId,
          icpVersion(),
        ]),
      );
      const [version] = await asServer((q) =>
        q.query<{ version: number; municipalities: unknown; sizes: string[] }>(
          `select v.version, v.municipalities, v.sizes from public.current_icp_profile_versions v
           join public.icp_profiles p on p.id = v.icp_id
           where p.id = $1 and p.status = 'draft' and p.offer_id = $2`,
          [row!.id, offerId],
        ),
      );
      expect(version).toEqual({
        version: 1,
        municipalities: [{ name: 'Curitiba', uf: 'PR' }],
        sizes: ['me', 'epp'],
      });
    });

    it('recusa CNAE fora do formato, UF inexistente, porte MEI, idade invertida e oferta inexistente', async () => {
      const offerId = await asServer((q) => createOffer(q));
      for (const overrides of [
        { cnaes: ['8630504'] },
        { ufs: ['XX'] },
        { sizes: ['mei'] },
        { min_age_years: 10, max_age_years: 2 },
        { municipalities: [{ name: 'Curitiba', uf: 'pr' }] },
        { excluded_cnpj_roots: ['1234'] },
        // Itens vazios, nulos ou com vírgula (furo de array_to_string, já fechado).
        { cnaes: [''] },
        { cnaes: [null] },
        { cnaes: ['8630-5/04,8630-5/05'] },
        { excluded_cnaes: [''] },
        { excluded_cnpj_roots: [''] },
        { excluded_cnpj_roots: [null] },
      ]) {
        await expectDbError(
          asServer((q) =>
            q.query('select public.create_icp_profile($1, $2::jsonb)', [
              offerId,
              icpVersion(overrides),
            ]),
          ),
          { code: '23514' },
        );
      }
      await expectDbError(
        asServer((q) =>
          q.query('select public.create_icp_profile($1, $2::jsonb)', [
            '00000000-0000-0000-0000-000000000000',
            icpVersion(),
          ]),
        ),
        { code: '23503' },
      );
    });
  });

  describe('cases (proof_assets)', () => {
    it('case público exige autorização registrada; não se apaga, arquiva', async () => {
      await expectDbError(
        asServer((q) =>
          q.query(
            "insert into public.proof_assets (title, summary, public_ok) values ('Case', 'Resumo', true)",
          ),
        ),
        { code: '23514' },
      );
      const [row] = await asServer((q) =>
        q.query<{ id: string }>(
          `insert into public.proof_assets (title, summary, public_ok, consent_ref)
           values ('Case', 'Resumo', true, 'E-mail do cliente de 01/11/2026') returning id`,
        ),
      );
      await expectDbError(
        asServer((q) =>
          q.query("update public.proof_assets set consent_ref = '' where id = $1", [row!.id]),
        ),
        { code: '23514' },
      );
      await asServer((q) =>
        q.query('update public.proof_assets set archived_at = now() where id = $1', [row!.id]),
      );
      await expectDbError(
        asServer((q) => q.query('delete from public.proof_assets where id = $1', [row!.id])),
        { code: '42501' },
      );
      await expectDbError(
        asServer((q) =>
          q.query('update public.proof_assets set is_demo = true where id = $1', [row!.id]),
        ),
        { code: '42501' },
      );
    });
  });

  describe('LIA', () => {
    it('aprova uma vez, revoga uma vez e o conteúdo nunca muda', async () => {
      const [created] = await asServer((q) => insertLia(q));
      const id = created!.id;

      // Aprovação precisa de data de revisão (e vice-versa).
      await expectDbError(
        asServer((q) =>
          q.query('update public.legal_basis_assessments set approved_at = now() where id = $1', [
            id,
          ]),
        ),
        { code: '23514' },
      );
      // Revogar sem aprovar não faz sentido.
      await expectDbError(
        asServer((q) =>
          q.query('update public.legal_basis_assessments set revoked_at = now() where id = $1', [
            id,
          ]),
        ),
        { code: '23514' },
      );

      await asServer((q) =>
        q.query(
          `update public.legal_basis_assessments
           set approved_at = now(), review_due_on = ${IN_ONE_YEAR} where id = $1`,
          [id],
        ),
      );
      await expectDbError(
        asServer((q) =>
          q.query(
            "update public.legal_basis_assessments set review_due_on = '2028-11-09' where id = $1",
            [id],
          ),
        ),
        { message: 'lia_decision_locked' },
      );
      await asServer((q) =>
        q.query('update public.legal_basis_assessments set revoked_at = now() where id = $1', [id]),
      );
      await expectDbError(
        asServer((q) =>
          q.query(
            "update public.legal_basis_assessments set revoked_at = now() + interval '1 day' where id = $1",
            [id],
          ),
        ),
        { message: 'lia_decision_locked' },
      );

      // Conteúdo: servidor não tem privilégio; o dono do banco esbarra no trigger.
      await expectDbError(
        asServer((q) =>
          q.query("update public.legal_basis_assessments set purpose = 'x' where id = $1", [id]),
        ),
        { code: '42501' },
      );
      await expectDbError(
        db.query("update public.legal_basis_assessments set purpose = 'x' where id = $1", [id]),
        { message: 'version_immutable' },
      );
      await expectDbError(db.query('delete from public.legal_basis_assessments'), {
        message: 'version_immutable',
      });
      await expectDbError(db.query('truncate public.legal_basis_assessments'), {
        message: 'version_immutable',
      });
    });

    it('nasce rascunho; aprova só a mais recente, com revisão no prazo e instante do banco', async () => {
      // Inclusão já aprovada vira rascunho.
      const [inserted] = await asServer((q) =>
        q.query<{ id: string; approved_at: string | null; created_at: string }>(
          `insert into public.legal_basis_assessments (
             purpose, legitimate_interest, necessity, data_categories, data_sources,
             expectations, risks, safeguards, conclusion,
             approved_at, review_due_on, created_at)
           values ('p', 'l', 'n', '{name}', '{company_website}', 'e', 'r', 's', 'c',
             '2020-01-01', '2099-12-31', '2019-01-01')
           returning id, approved_at, created_at::text`,
        ),
      );
      expect(inserted!.approved_at).toBeNull();
      expect(inserted!.created_at.startsWith('2019')).toBe(false);

      const [newest] = await asServer((q) => insertLia(q));
      const approve = (id: string, due: string, extra = '') =>
        asServer((q) =>
          q.query(
            `update public.legal_basis_assessments
             set approved_at = '2000-01-01', review_due_on = ${due}${extra} where id = $1`,
            [id],
          ),
        );
      // Versão antiga não pode ser aprovada.
      await expectDbError(approve(inserted!.id, IN_ONE_YEAR), { message: 'lia_not_latest' });
      // Revisão hoje, no passado ou depois de 24 meses é recusada.
      for (const due of [AGENCY_TODAY, `(${AGENCY_TODAY} - 1)`, `(${AGENCY_TODAY} + 800)`]) {
        await expectDbError(approve(newest!.id, due), { message: 'review_date_out_of_range' });
      }
      // Aprovar e revogar na mesma instrução, não.
      await expectDbError(approve(newest!.id, IN_ONE_YEAR, ', revoked_at = now()'), {
        message: 'lia_decision_locked',
      });
      await approve(newest!.id, IN_ONE_YEAR);
      const [decided] = await asServer((q) =>
        q.query<{ approved_at: string }>(
          'select approved_at::text from public.legal_basis_assessments where id = $1',
          [newest!.id],
        ),
      );
      expect(decided!.approved_at.startsWith('2000')).toBe(false);
    });

    it('recusa categoria de dado fora da lista de minimização (ex.: CPF)', async () => {
      await expectDbError(
        asServer((q) =>
          q.query(
            `insert into public.legal_basis_assessments (
               purpose, legitimate_interest, necessity, data_categories, data_sources,
               expectations, risks, safeguards, conclusion)
             values ('p', 'l', 'n', '{name,cpf}', '{company_website}', 'e', 'r', 's', 'c')`,
          ),
        ),
        { code: '23514' },
      );
    });
  });

  describe('API pública', () => {
    it('anon e authenticated não leem, não incluem e não executam as funções de criação', async () => {
      for (const role of ['anon', 'authenticated'] as const) {
        await expectDbError(
          db.asRole(role, (q) => q.query('select id from public.offers')),
          { code: '42501' },
        );
        await expectDbError(
          db.asRole(role, (q) => q.query('select id from public.current_offer_versions')),
          { code: '42501' },
        );
        await expectDbError(
          db.asRole(role, (q) => createOffer(q)),
          { code: '42501' },
        );
        await expectDbError(
          db.asRole(role, (q) => insertLia(q)),
          { code: '42501' },
        );
      }
    });
  });
});
