import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader, type AuditedTable } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * Migrações de 2026-11-27 (diretriz de 2026-11-26): perfis comerciais, pessoas com base legal e
 * prazo (regra 7), supressão de pessoa e a pesquisa extensa do Copiloto, com as correções da
 * revisão de conformidade. Dados SINTÉTICOS.
 */

const TRACE = '6f5e4d3c-2b1a-4f9e-8d7c-6b5a4f3e2d1c';
const HASH = (n: number) => n.toString(16).padStart(64, '0');

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'test.write',
  entityType: 'test',
  entityId: null,
  diff: {},
  withVersion: false,
  ...overrides,
});

const viaApi = (
  q: Queryable,
  table: AuditedTable,
  overrides: Partial<PendingAudit> = {},
  covers: AuditedTable[] = [],
) =>
  q.query("select set_config('request.headers', $1, true)", [
    JSON.stringify({
      'content-type': 'application/json',
      'x-prospector-audit': encodeAuditHeader(table, pending(overrides), covers),
    }),
  ]);

const VERIFIED = '2026-11-27T10:00:00Z';
/** Sem LIA que cubra: até 90 dias. */
const SHORT = '2027-02-20T10:00:00Z';

describe('perfis comerciais, pessoas e pesquisa do Copiloto no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);
  let foundStudio = '';
  let blummy = '';

  const insertPerson = (
    values: Record<string, unknown> = {},
    dedupe = HASH(1),
    profile?: string,
  ): Promise<string> =>
    asServer(async (q) => {
      await viaApi(q, 'people', { action: 'person.create', entityType: 'person' });
      const row = {
        profile_id: profile ?? blummy,
        full_name: 'Pessoa Sintética da Silva',
        profession: 'Terapeuta ocupacional',
        city: 'Campinas',
        uf: 'SP',
        work_email: 'contato@exemplo.test',
        source_url: 'https://exemplo.test/equipe',
        source_kind: 'company_website',
        source_quote: 'Pessoa Sintética da Silva, terapeuta ocupacional',
        verified_at: VERIFIED,
        retention_until: SHORT,
        dedupe_key: dedupe,
        ...values,
      };
      const keys = Object.keys(row);
      const rows = await q.query<{ id: string }>(
        `insert into public.people (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')}) returning id`,
        Object.values(row),
      );
      return rows[0]!.id;
    });

  const createThread = () =>
    asServer(async (q) => {
      await viaApi(q, 'copilot_threads', { action: 'copilot.thread.create' });
      const rows = await q.query<{ id: string }>(
        "insert into public.copilot_threads (title) values ('Pesquisa sintética') returning id",
      );
      return rows[0]!.id;
    });

  const createResearch = (threadId: string) =>
    asServer(async (q) => {
      await viaApi(q, 'copilot_research', { action: 'copilot.research.create' });
      const rows = await q.query<{ id: string }>(
        `insert into public.copilot_research
           (thread_id, profile_id, request, objective, audience, criteria, requested_count,
            credit_cap, trace_id, retention_until)
         values ($1, $2, 'Quero 100 terapeutas ocupacionais', 'Apresentar a Blummy',
                 'terapeutas ocupacionais', '{"entityKinds": ["person", "organization"]}', 100, 40, $3,
                 now() + interval '12 months')
         returning id`,
        [threadId, blummy, TRACE],
      );
      return rows[0]!.id;
    });

  /** LIA sintética aprovada, com as origens e as categorias de dados dadas. */
  const approvedLia = (
    sources: string[],
    categories: string[] = ['name', 'profession', 'location', 'work_email'],
  ) =>
    asServer(async (q) => {
      await viaApi(q, 'legal_basis_assessments', {
        action: 'strategy.lia.create',
        entityType: 'legal_basis_assessment',
      });
      const rows = await q.query<{ id: string; version: number }>(
        `insert into public.legal_basis_assessments
           (purpose, legitimate_interest, necessity, data_categories, data_sources, expectations,
            risks, safeguards, conclusion)
         values ('Prospecção sintética', 'Interesse sintético', 'Necessidade sintética',
                 $2, $1, 'Expectativa sintética',
                 'Riscos sintéticos', 'Salvaguardas sintéticas', 'Conclusão sintética')
         returning id, version`,
        [sources, categories],
      );
      const lia = rows[0]!;
      await viaApi(q, 'legal_basis_assessments', {
        action: 'strategy.lia.approve',
        entityType: 'legal_basis_assessment',
        entityId: lia.id,
      });
      await q.query(
        `update public.legal_basis_assessments
           set approved_at = now(), review_due_on = current_date + 180
         where id = $1`,
        [lia.id],
      );
      return lia.version;
    });

  beforeAll(async () => {
    db = await createTestDb();
    const profiles = await db.query<{ id: string; key: string; is_default: boolean }>(
      'select id, key, is_default from public.commercial_profiles order by key',
    );
    blummy = profiles.find((row) => row.key === 'blummy')!.id;
    foundStudio = profiles.find((row) => row.key === 'found-studio')!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  it('os dois perfis existem, a Found Studio é o padrão e uma oferta nova sem perfil vai para ela', async () => {
    const profiles = await db.query<{ key: string; is_default: boolean; kind: string }>(
      'select key, is_default, kind from public.commercial_profiles order by key',
    );
    expect(profiles).toEqual([
      { key: 'blummy', is_default: false, kind: 'product' },
      { key: 'found-studio', is_default: true, kind: 'services' },
    ]);
    const offerId = await asServer(async (q) => {
      await viaApi(q, 'offers', { action: 'strategy.offer.create', entityType: 'offer' });
      const rows = await q.query<{ id: string; profile_id: string }>(
        'insert into public.offers default values returning id, profile_id',
      );
      expect(rows[0]!.profile_id).toBe(foundStudio);
      return rows[0]!.id;
    });
    expect(offerId).toBeTruthy();
    // Um segundo padrão é recusado.
    await expectDbError(
      db.query("update public.commercial_profiles set is_default = true where key = 'blummy'"),
      { code: '23505' },
    );
  });

  it('pessoa guarda origem, base legal e prazo; a mesma pessoa no mesmo perfil não entra duas vezes', async () => {
    const id = await insertPerson();
    const [row] = await db.query<Record<string, unknown>>(
      'select legal_basis, purpose, audience_role, opted_out_at, lia_version from public.people where id = $1',
      [id],
    );
    expect(row).toEqual({
      legal_basis: 'legitimate_interest',
      purpose: 'commercial_prospecting',
      audience_role: 'unknown',
      opted_out_at: null,
      lia_version: null,
    });
    await expectDbError(insertPerson({}, HASH(1)), { code: '23505' });
    // Sem origem não entra.
    await expectDbError(insertPerson({ source_quote: '' }, HASH(2)), { code: '23514' });
    // O nome tem de estar no trecho da fonte.
    await expectDbError(
      insertPerson({ source_quote: 'Equipe de terapia ocupacional da clínica' }, HASH(5)),
      { code: '23514' },
    );
    // Prazo antes da conferência não entra.
    await expectDbError(insertPerson({ retention_until: '2020-01-01T00:00:00Z' }, HASH(3)), {
      code: '23514',
    });
    // Sem LIA que cubra, o prazo é de no máximo 90 dias.
    await expectDbError(insertPerson({ retention_until: '2027-05-27T10:00:00Z' }, HASH(6)), {
      code: '23514',
    });
    // E-mail fora do formato (com maiúscula) não entra.
    await expectDbError(insertPerson({ work_email: 'Contato@Exemplo.test' }, HASH(4)), {
      code: '23514',
    });
  });

  it('a versão da LIA tem de estar aprovada, ser a vigente e cobrir a fonte e os dados da linha', async () => {
    // Versão inexistente: recusada (o gatilho confere antes da chave estrangeira).
    await expectDbError(insertPerson({ lia_version: 999 }, HASH(30)), {
      message: /person_lia_not_covering/,
    });
    const version = await approvedLia(['company_website', 'professional_directory']);
    // Coberta: entra, com prazo de até 12 meses.
    const covered = await insertPerson(
      { lia_version: version, retention_until: '2027-11-20T10:00:00Z' },
      HASH(31),
    );
    expect(covered).toBeTruthy();
    // Fonte fora da LIA (resultado de busca): recusada.
    await expectDbError(
      insertPerson({ lia_version: version, source_kind: 'search_result' }, HASH(32)),
      { message: /person_lia_not_covering/ },
    );
    // Trocar a fonte da linha para uma que a LIA não cobre também é recusado.
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q, 'people', {
          action: 'person.update',
          entityType: 'person',
          entityId: covered,
        });
        await q.query("update public.people set source_kind = 'press' where id = $1", [covered]);
      }),
      { message: /person_lia_not_covering/ },
    );
    // Acrescentar depois um dado que a LIA não avaliou (cargo) também é recusado.
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q, 'people', {
          action: 'person.update',
          entityType: 'person',
          entityId: covered,
        });
        await q.query("update public.people set role_title = 'Coordenadora' where id = $1", [
          covered,
        ]);
      }),
      { message: /person_lia_not_covering/ },
    );

    // Uma LIA que não avaliou e-mail não cobre uma linha com e-mail.
    const withoutEmail = await approvedLia(
      ['company_website', 'search_result'],
      ['name', 'profession', 'location'],
    );
    await expectDbError(
      insertPerson(
        { lia_version: withoutEmail, retention_until: '2027-11-20T10:00:00Z' },
        HASH(33),
      ),
      { message: /person_lia_not_covering/ },
    );
    const noEmail = await insertPerson(
      {
        lia_version: withoutEmail,
        work_email: null,
        source_kind: 'search_result',
        retention_until: '2027-11-20T10:00:00Z',
      },
      HASH(34),
    );
    expect(noEmail).toBeTruthy();
    // A versão anterior foi substituída pela nova aprovada: não cobre mais nada novo.
    await expectDbError(
      insertPerson({ lia_version: version, retention_until: '2027-11-20T10:00:00Z' }, HASH(35)),
      { message: /person_lia_not_covering/ },
    );

    // Opt-out passa mesmo com a versão da linha substituída (só apaga).
    await asServer(async (q) => {
      await viaApi(
        q,
        'people',
        { action: 'person.opt_out', entityType: 'person', entityId: covered },
        ['person_suppressions'],
      );
      await q.query(
        `update public.people
           set opted_out_at = now(), work_email = null, work_phone = null, profile_url = null
         where id = $1`,
        [covered],
      );
    });
  });

  it('opt-out apaga os meios de contato, é final e vale para todos os perfis, mesmo depois do expurgo', async () => {
    const id = await insertPerson({ profile_url: 'https://perfil.exemplo.test/pessoa' }, HASH(10));
    // Marcar opt-out mantendo o e-mail (ou o perfil) é recusado.
    await expectDbError(
      asServer(async (q) => {
        await viaApi(
          q,
          'people',
          { action: 'person.opt_out', entityType: 'person', entityId: id },
          ['person_suppressions'],
        );
        await q.query(
          'update public.people set opted_out_at = now(), work_email = null where id = $1',
          [id],
        );
      }),
      { code: '23514' },
    );
    await asServer(async (q) => {
      await viaApi(q, 'people', { action: 'person.opt_out', entityType: 'person', entityId: id }, [
        'person_suppressions',
      ]);
      await q.query(
        `update public.people
           set opted_out_at = now(), work_email = null, work_phone = null, profile_url = null
         where id = $1`,
        [id],
      );
    });
    // A identidade entrou na supressão na mesma transação.
    const suppressed = await db.query<{ kind: string; reason: string }>(
      'select kind, reason from public.person_suppressions where value_hash = $1',
      [HASH(10)],
    );
    expect(suppressed).toEqual([{ kind: 'identity', reason: 'opt_out' }]);
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q, 'people', { action: 'person.update', entityType: 'person', entityId: id });
        await q.query("update public.people set work_email = 'outro@exemplo.test' where id = $1", [
          id,
        ]);
      }),
      { message: /person_opted_out/ },
    );
    const audit = await db.query<{ action: string }>(
      'select action from public.audit_log where entity_id = $1 order by id',
      [id],
    );
    expect(audit.map((row) => row.action)).toEqual(['person.create', 'person.opt_out']);

    // Expurgo da linha: a supressão fica, e nenhum perfil grava a mesma pessoa de novo.
    await asServer(async (q) => {
      await viaApi(q, 'people', { action: 'person.purge', entityType: 'person', entityId: id }, [
        'copilot_research_items',
      ]);
      await q.query('delete from public.people where id = $1', [id]);
    });
    await expectDbError(insertPerson({}, HASH(10), foundStudio), {
      message: /person_suppressed/,
    });
    await expectDbError(insertPerson({}, HASH(10), blummy), { message: /person_suppressed/ });
  });

  it('opt-out numa linha marca a mesma pessoa no outro perfil e apaga os contatos dela', async () => {
    const inBlummy = await insertPerson({}, HASH(12), blummy);
    const inStudio = await insertPerson(
      { profile_url: 'https://perfil.exemplo.test/outra' },
      HASH(12),
      foundStudio,
    );
    const other = await insertPerson({}, HASH(13), foundStudio);
    await asServer(async (q) => {
      await viaApi(
        q,
        'people',
        { action: 'person.opt_out', entityType: 'person', entityId: inBlummy },
        ['person_suppressions'],
      );
      await q.query(
        `update public.people
           set opted_out_at = now(), work_email = null, work_phone = null, profile_url = null
         where id = $1`,
        [inBlummy],
      );
    });
    const rows = await db.query<{
      id: string;
      opted_out: boolean;
      work_email: string | null;
      profile_url: string | null;
    }>(
      `select id, opted_out_at is not null as opted_out, work_email, profile_url
         from public.people where id = any($1) order by id`,
      [[inBlummy, inStudio, other]],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(inStudio)).toMatchObject({
      opted_out: true,
      work_email: null,
      profile_url: null,
    });
    expect(byId.get(inBlummy)).toMatchObject({ opted_out: true, work_email: null });
    // Outra pessoa do mesmo perfil não é tocada.
    expect(byId.get(other)).toMatchObject({ opted_out: false, work_email: 'contato@exemplo.test' });
  });

  it('pesquisa do Copiloto: item de pessoa só aponta para `people` e some quando a pessoa é apagada', async () => {
    const threadId = await createThread();
    const researchId = await createResearch(threadId);
    const personId = await insertPerson({}, HASH(20));
    await asServer(async (q) => {
      await viaApi(q, 'copilot_research_items', { action: 'copilot.research.items' });
      await q.query(
        `insert into public.copilot_research_items
           (research_id, kind, person_id, segment, fit_reason, verified_at, retention_until,
            dedupe_key)
         values ($1, 'person', $2, 'independent_professional',
                 'Atende de forma independente: usa e decide a compra.', now(),
                 now() + interval '90 days', $3)`,
        [researchId, personId, HASH(21)],
      );
      await q.query(
        `insert into public.copilot_research_items
           (research_id, kind, name, city, uf, source_url, source_quote, segment, fit_reason,
            verified_at, retention_until, dedupe_key)
         values ($1, 'organization', 'Clínica Sintética', 'Belo Horizonte', 'MG',
                 'https://clinica.test', 'Clínica Sintética de terapia ocupacional', 'clinic',
                 'Clínica com equipe: quem compra é o gestor.', now(),
                 now() + interval '12 months', $2)`,
        [researchId, HASH(22)],
      );
    });
    const refused = (sql: string, params: unknown[]) =>
      expectDbError(
        asServer(async (q) => {
          await viaApi(q, 'copilot_research_items', { action: 'copilot.research.items' });
          await q.query(sql, params);
        }),
        { code: '23514' },
      );
    // Item de pessoa sem pessoa.
    await refused(
      `insert into public.copilot_research_items
         (research_id, kind, segment, fit_reason, verified_at, retention_until, dedupe_key)
       values ($1, 'person', 'unknown', 'Sem pessoa.', now(), now() + interval '30 days', $2)`,
      [researchId, HASH(23)],
    );
    // Organização sem fonte.
    await refused(
      `insert into public.copilot_research_items
         (research_id, kind, name, segment, fit_reason, verified_at, retention_until, dedupe_key)
       values ($1, 'organization', 'Sem fonte', 'clinic', 'Sem fonte.', now(),
               now() + interval '30 days', $2)`,
      [researchId, HASH(24)],
    );
    // Organização com segmento de pessoa (profissional autônomo guardado fora de `people`).
    await refused(
      `insert into public.copilot_research_items
         (research_id, kind, name, source_url, source_quote, public_email, segment, fit_reason,
          verified_at, retention_until, dedupe_key)
       values ($1, 'organization', 'Consultório Sintético', 'https://consultorio.test',
               'Consultório Sintético de terapia', 'consultorio@exemplo.test',
               'independent_professional', 'Autônomo.', now(), now() + interval '30 days', $2)`,
      [researchId, HASH(25)],
    );
    // Item de pessoa com contato duplicado fora de `people`.
    await refused(
      `insert into public.copilot_research_items
         (research_id, kind, person_id, public_email, segment, fit_reason, verified_at,
          retention_until, dedupe_key)
       values ($1, 'person', $2, 'contato@exemplo.test', 'independent_professional',
               'Contato duplicado.', now(), now() + interval '30 days', $3)`,
      [researchId, personId, HASH(26)],
    );
    // Prazo do item acima de 12 meses.
    await refused(
      `insert into public.copilot_research_items
         (research_id, kind, name, source_url, source_quote, segment, fit_reason, verified_at,
          retention_until, dedupe_key)
       values ($1, 'organization', 'Clínica Longa', 'https://longa.test', 'Clínica Longa',
               'clinic', 'Prazo longo.', now(), now() + interval '13 months', $2)`,
      [researchId, HASH(27)],
    );

    // Prazo vencido: o servidor apaga a pessoa (auditado) e o item vai junto.
    await asServer(async (q) => {
      await viaApi(
        q,
        'people',
        { action: 'person.purge', entityType: 'person', entityId: personId },
        ['copilot_research_items'],
      );
      await q.query('delete from public.people where id = $1', [personId]);
    });
    const items = await db.query<{ kind: string }>(
      'select kind from public.copilot_research_items where research_id = $1',
      [researchId],
    );
    expect(items).toEqual([{ kind: 'organization' }]);
    const purge = await db.query<{ action: string }>(
      "select action from public.audit_log where entity_id = $1 and action = 'person.purge'",
      [personId],
    );
    expect(purge).toHaveLength(1);

    // A pesquisa também pode ser apagada (prazo), com os itens.
    await asServer(async (q) => {
      await viaApi(
        q,
        'copilot_research',
        { action: 'copilot.research.purge', entityId: researchId },
        ['copilot_research_items'],
      );
      await q.query('delete from public.copilot_research where id = $1', [researchId]);
    });
    const left = await db.query<{ n: number }>(
      'select count(*)::int as n from public.copilot_research_items where research_id = $1',
      [researchId],
    );
    expect(left).toEqual([{ n: 0 }]);
  });

  it('pesquisa encerrada exige data de fim, e a fila aceita o tipo copilot_research', async () => {
    const threadId = await createThread();
    const researchId = await createResearch(threadId);
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q, 'copilot_research', {
          action: 'copilot.research.update',
          entityId: researchId,
        });
        await q.query("update public.copilot_research set status = 'done' where id = $1", [
          researchId,
        ]);
      }),
      { code: '23514' },
    );
    await asServer((q) =>
      q.query(
        `insert into public.ai_jobs (kind, idempotency_key, payload, trace_id)
         values ('copilot_research', $1, $2, $3)`,
        [`copilot_research:${researchId}:1`, JSON.stringify({ researchId }), TRACE],
      ),
    );
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.ai_jobs (kind, idempotency_key, trace_id)
           values ('outro_tipo', 'x', $1)`,
          [TRACE],
        ),
      ),
      { code: '23514' },
    );
  });

  it('a pesquisa entra na fila ao ser criada, a cada lote, a cada mudança e ao reabrir; cancelar marca as tarefas', async () => {
    const threadId = await createThread();
    const researchId = await createResearch(threadId);
    const jobs = () =>
      db.query<{ idempotency_key: string; payload: Record<string, unknown>; cancel: boolean }>(
        `select idempotency_key, payload, cancel_requested_at is not null as cancel
           from public.ai_jobs
          where kind = 'copilot_research' and payload ->> 'researchId' = $1
          order by created_at, idempotency_key`,
        [researchId],
      );
    const update = (sql: string, params: unknown[] = []) =>
      asServer(async (q) => {
        await viaApi(q, 'copilot_research', {
          action: 'copilot.research.update',
          entityId: researchId,
        });
        await q.query(sql, [researchId, ...params]);
      });

    expect((await jobs()).map((job) => job.idempotency_key)).toEqual([
      `copilot_research:${researchId}:1:0`,
    ]);
    expect((await jobs())[0]!.payload).toEqual({ researchId, version: 1, batch: 0 });

    // Lote concluído: o seguinte entra na fila.
    await update(
      `update public.copilot_research
          set status = 'running', progress = '{"batches": 1}', found_count = 10
        where id = $1`,
    );
    // Gravação que não conclui lote nem muda a pesquisa: nada novo.
    await update('update public.copilot_research set found_count = 11 where id = $1');
    // Mudança pedida pela pessoa (versão sobe), com a quantidade nova.
    await update(
      'update public.copilot_research set version = 2, requested_count = 150 where id = $1',
    );
    expect((await jobs()).map((job) => job.idempotency_key)).toEqual([
      `copilot_research:${researchId}:1:0`,
      `copilot_research:${researchId}:1:1`,
      `copilot_research:${researchId}:2:1`,
    ]);

    // Concluída e depois reaberta ("mais 50"): volta à fila.
    await update(
      "update public.copilot_research set status = 'done', finished_at = now() where id = $1",
    );
    expect(await jobs()).toHaveLength(3);
    await update(
      `update public.copilot_research
          set status = 'queued', finished_at = null, version = 3
        where id = $1`,
    );
    expect((await jobs()).map((job) => job.idempotency_key)).toContain(
      `copilot_research:${researchId}:3:1`,
    );

    // Cancelada: as tarefas abertas ficam marcadas (quem roda para na renovação do lease).
    await update(
      "update public.copilot_research set status = 'cancelled', finished_at = now() where id = $1",
    );
    const after = await jobs();
    expect(after.every((job) => job.cancel)).toBe(true);
  });

  it('toda gravação na pesquisa sobe `row_version` (concorrência otimista entre lote e mudança)', async () => {
    const threadId = await createThread();
    const researchId = await createResearch(threadId);
    const rowVersion = async () =>
      (
        await db.query<{ row_version: number }>(
          'select row_version from public.copilot_research where id = $1',
          [researchId],
        )
      )[0]!.row_version;
    expect(await rowVersion()).toBe(1);
    const write = (sql: string) =>
      asServer(async (q) => {
        await viaApi(q, 'copilot_research', {
          action: 'copilot.research.update',
          entityId: researchId,
        });
        await q.query(sql, [researchId]);
      });
    await write('update public.copilot_research set found_count = 3 where id = $1');
    await write('update public.copilot_research set found_count = 4 where id = $1');
    expect(await rowVersion()).toBe(3);
    // Só o gatilho mexe nela: o servidor do app não consegue "voltar" a versão da linha.
    await expectDbError(write('update public.copilot_research set row_version = 1 where id = $1'), {
      code: '42501',
    });
    expect(await rowVersion()).toBe(3);
  });

  it('impressão da chave das pessoas: uma linha, a primeira fica e não muda', async () => {
    await asServer((q) =>
      q.query(
        'insert into public.people_key_checks (value_hash) values ($1) on conflict (id) do nothing',
        [HASH(77)],
      ),
    );
    await asServer((q) =>
      q.query(
        'insert into public.people_key_checks (value_hash) values ($1) on conflict (id) do nothing',
        [HASH(78)],
      ),
    );
    const rows = await db.query<{ value_hash: string }>(
      'select value_hash from public.people_key_checks',
    );
    expect(rows).toEqual([{ value_hash: HASH(77) }]);
    await expectDbError(
      asServer((q) => q.query('update public.people_key_checks set value_hash = $1', [HASH(79)])),
      { code: '42501' },
    );
    await expectDbError(
      asServer((q) => q.query('delete from public.people_key_checks')),
      { code: '42501' },
    );
    await expectDbError(
      asServer((q) =>
        q.query('insert into public.people_key_checks (id, value_hash) values (2, $1)', [HASH(80)]),
      ),
      { code: '23514' },
    );
    await expectDbError(
      db.asRole('anon', (q) => q.query('select * from public.people_key_checks')),
      { code: '42501' },
    );
  });

  it('a API pública não lê pessoas, supressões nem pesquisas', async () => {
    await expectDbError(
      db.asRole('anon', (q) => q.query('select * from public.people')),
      { code: '42501' },
    );
    await expectDbError(
      db.asRole('anon', (q) => q.query('select * from public.person_suppressions')),
      { code: '42501' },
    );
    await expectDbError(
      db.asRole('authenticated', (q) => q.query('select * from public.copilot_research')),
      { code: '42501' },
    );
  });
});
