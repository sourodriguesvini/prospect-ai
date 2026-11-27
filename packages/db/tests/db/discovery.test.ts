import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader, type AuditedTable } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * F4 — Descoberta e fila durável (migração 20261111120000, ADR-0011 e ADR-0013).
 * - pesquisa confirmada entra na fila na mesma transação, uma tarefa só por pesquisa;
 * - rascunho do Copiloto só vai para a fila com a confirmação da pessoa (auditada);
 * - o trabalhador pega uma tarefa por vez, renova o lease, retoma a que caiu e para ao cancelar;
 * - decisões da pessoa são auditadas; progresso do trabalhador não precisa de cabeçalho;
 * - empresas deduplicadas pela chave; sinais pela impressão digital;
 * - só o servidor do app acessa (anon/authenticated não).
 */

const TRACE = '0b7c3d2e-1f4a-4b5c-8d6e-7f8a9b0c1d2e';
const FINGERPRINT = 'a'.repeat(64);

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'discovery.run.created',
  entityType: 'discovery_run',
  entityId: null,
  diff: {},
  withVersion: false,
  ...overrides,
});

/** Simula um pedido do PostgREST (cabeçalhos em request.headers), com ou sem auditoria. */
const viaApi = (q: Queryable, table?: AuditedTable, audit?: PendingAudit) =>
  q.query("select set_config('request.headers', $1, true)", [
    JSON.stringify({
      'content-type': 'application/json',
      ...(table && audit ? { 'x-prospector-audit': encodeAuditHeader(table, audit) } : {}),
    }),
  ]);

const LIMITS = JSON.stringify({ maxSearches: 3, maxPages: 3, maxProspects: 15 });

const insertRun = (q: Queryable, status: 'queued' | 'draft' = 'queued') =>
  q.query<{ id: string }>(
    `insert into public.discovery_runs (request, trigger, status, limits, trace_id, confirmed_at)
     values ('Encontre clínicas em Ribeirão Preto', $1, $2, $3::jsonb, $4, $5)
     returning id`,
    [
      status === 'draft' ? 'copilot' : 'user',
      status,
      LIMITS,
      TRACE,
      status === 'draft' ? null : new Date().toISOString(),
    ],
  );

const insertProspect = (q: Queryable, runId: string, dedupeKey = 'domain:vidaplena.com.br') =>
  q.query<{ id: string }>(
    `insert into public.discovery_prospects (
       dedupe_key, display_name, name_key, domain, priority, confidence, first_seen_at, last_seen_at,
       first_run_id, last_run_id
     ) values ($1, 'Clínica Vida Plena', 'clinica vida plena', 'vidaplena.com.br', 'medium', 'medium', now(), now(), $2, $2)
     returning id`,
    [dedupeKey, runId],
  );

describe('F4 — Descoberta e fila no banco', () => {
  let db: TestDb;
  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  const jobsFor = (runId: string) =>
    db.query<{ id: string; status: string; attempts: number; cancel_requested_at: string | null }>(
      `select id, status, attempts, cancel_requested_at from public.ai_jobs
       where idempotency_key = $1`,
      [`discovery_run:${runId}`],
    );

  const auditActions = (entityId: string) =>
    db
      .query<{ action: string }>(
        'select action from public.audit_log where entity_id = $1 order by id',
        [entityId],
      )
      .then((rows) => rows.map((row) => row.action));

  /** Esvazia a fila (SQL direto) para cada teste da fila começar do zero. */
  const clearQueue = () =>
    db.query(
      `update public.ai_jobs set status = 'cancelled', lease_owner = null,
         lease_expires_at = null, finished_at = now() where status in ('queued', 'running')`,
    );

  beforeAll(async () => {
    db = await createTestDb();
  });

  afterAll(async () => {
    await db?.close();
  });

  it('pesquisa criada pelo app é auditada e entra na fila uma vez só', async () => {
    const [run] = await asServer(async (q) => {
      await viaApi(q, 'discovery_runs', pending());
      return insertRun(q);
    });
    expect(await auditActions(run!.id)).toEqual(['discovery.run.created']);
    const jobs = await jobsFor(run!.id);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.status).toBe('queued');

    // Mudar o status de novo para "queued" não cria outra tarefa.
    await db.query("update public.discovery_runs set status = 'queued' where id = $1", [run!.id]);
    expect(await jobsFor(run!.id)).toHaveLength(1);
  });

  it('pelo app, gravar pesquisa sem o registro de auditoria é recusado', async () => {
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q);
        return insertRun(q);
      }),
      { code: '42501', message: 'audit_missing' },
    );
  });

  it('o progresso do trabalhador não precisa de auditoria', async () => {
    const [run] = await asServer((q) => insertRun(q));
    await asServer(async (q) => {
      await viaApi(q);
      await q.query(
        `update public.discovery_runs set status = 'running', stage = 'searching',
           progress = '{"searchesDone": 1}'::jsonb, started_at = now() where id = $1`,
        [run!.id],
      );
    });
    const [row] = await db.query<{ stage: string }>(
      'select stage from public.discovery_runs where id = $1',
      [run!.id],
    );
    expect(row!.stage).toBe('searching');
  });

  it('rascunho do Copiloto só entra na fila com a confirmação da pessoa', async () => {
    const [draft] = await asServer(async (q) => {
      await viaApi(
        q,
        'discovery_runs',
        pending({ actorType: 'agent', actorLabel: 'copilot', action: 'discovery.run.prepared' }),
      );
      return insertRun(q, 'draft');
    });
    expect(await jobsFor(draft!.id)).toEqual([]);

    // Sem confirmação, não vai para a fila.
    await expectDbError(
      db.query("update public.discovery_runs set status = 'queued' where id = $1", [draft!.id]),
      { code: '23514' },
    );

    await asServer(async (q) => {
      await viaApi(
        q,
        'discovery_runs',
        pending({ action: 'discovery.run.confirmed', entityId: draft!.id }),
      );
      await q.query(
        "update public.discovery_runs set status = 'queued', confirmed_at = now() where id = $1",
        [draft!.id],
      );
    });
    expect(await jobsFor(draft!.id)).toHaveLength(1);
    expect(await auditActions(draft!.id)).toEqual([
      'discovery.run.prepared',
      'discovery.run.confirmed',
    ]);
  });

  it('o trabalhador pega uma tarefa por vez, e a de quem caiu volta com nova tentativa', async () => {
    await clearQueue();
    const [first] = await asServer((q) => insertRun(q));
    const [second] = await asServer((q) => insertRun(q));

    const claim = (worker: string, lease = 60) =>
      asServer((q) =>
        q.query<{ id: string; attempts: number; payload: { runId: string } }>(
          "select * from public.claim_ai_job($1, array['discovery_run'], $2)",
          [worker, lease],
        ),
      );

    const [a] = await claim('worker-a');
    const [b] = await claim('worker-b');
    expect(a!.payload.runId).toBe(first!.id);
    expect(b!.payload.runId).toBe(second!.id);
    expect(await claim('worker-c')).toEqual([]);

    // worker-a "caiu": o lease vence e a tarefa volta para outro trabalhador.
    await db.query(
      "update public.ai_jobs set lease_expires_at = now() - interval '1 second' where id = $1",
      [a!.id],
    );
    const [again] = await claim('worker-c');
    expect(again!.id).toBe(a!.id);
    expect(again!.attempts).toBe(2);

    // Quem perdeu o lease não renova nem encerra.
    const lost = await asServer((q) =>
      q.query<{ ok: boolean }>('select public.heartbeat_ai_job($1, $2, 60) as ok', [
        a!.id,
        'worker-a',
      ]),
    );
    expect(lost[0]!.ok).toBe(false);
    const finishedByOther = await asServer((q) =>
      q.query<{ ok: boolean }>(
        "select public.finish_ai_job($1, 'worker-a', 'succeeded', null, null) as ok",
        [a!.id],
      ),
    );
    expect(finishedByOther[0]!.ok).toBe(false);

    const done = await asServer((q) =>
      q.query<{ ok: boolean }>(
        "select public.finish_ai_job($1, 'worker-c', 'succeeded', null, null) as ok",
        [a!.id],
      ),
    );
    expect(done[0]!.ok).toBe(true);
    expect((await jobsFor(first!.id))[0]!.status).toBe('succeeded');
  });

  it('nova tentativa volta para a fila com espera; sem tentativas sobrando, vira falha', async () => {
    await clearQueue();
    const [run] = await asServer((q) => insertRun(q));
    const claim = () =>
      asServer((q) =>
        q.query<{ id: string; attempts: number }>(
          "select * from public.claim_ai_job('w', array['discovery_run'], 60)",
        ),
      );
    const [job] = await claim();
    await asServer((q) =>
      q.query("select public.finish_ai_job($1, 'w', 'retry', 'ai_busy', 600)", [job!.id]),
    );
    expect(await claim()).toEqual([]); // espera de 10 minutos
    await db.query('update public.ai_jobs set run_after = now() where id = $1', [job!.id]);
    await claim();
    await db.query('update public.ai_jobs set run_after = now() where id = $1', [job!.id]);
    await asServer((q) =>
      q.query("select public.finish_ai_job($1, 'w', 'retry', 'ai_busy', 0)", [job!.id]),
    );
    await db.query('update public.ai_jobs set run_after = now() where id = $1', [job!.id]);
    const [third] = await claim();
    expect(third!.attempts).toBe(3);
    // Terceira (e última) tentativa pede retry: não há mais tentativas, vira falha.
    await asServer((q) =>
      q.query("select public.finish_ai_job($1, 'w', 'retry', 'ai_busy', 0)", [job!.id]),
    );
    const [row] = await jobsFor(run!.id);
    expect(row!.status).toBe('failed');
  });

  it('tarefa que caiu sem tentativas sobrando é encerrada e devolvida ao app', async () => {
    await clearQueue();
    const [run] = await asServer((q) => insertRun(q));
    await db.query(
      `update public.ai_jobs set status = 'running', attempts = 3, lease_owner = 'w',
         lease_expires_at = now() - interval '1 minute' where idempotency_key = $1`,
      [`discovery_run:${run!.id}`],
    );
    const expired = await asServer((q) =>
      q.query<{ status: string; last_error_code: string; payload: { runId: string } }>(
        'select * from public.expire_ai_jobs()',
      ),
    );
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      status: 'failed',
      last_error_code: 'attempts_exhausted',
      payload: { runId: run!.id },
    });
  });

  it('cancelar a pesquisa marca a tarefa: ela não é pega e o lease não renova', async () => {
    await clearQueue();
    const [queued] = await asServer((q) => insertRun(q));
    const [running] = await asServer((q) => insertRun(q));
    const [job] = await asServer((q) =>
      q.query<{ id: string; payload: { runId: string } }>(
        "select * from public.claim_ai_job('w', array['discovery_run'], 60)",
      ),
    );
    expect(job!.payload.runId).toBe(queued!.id);

    for (const run of [queued!, running!]) {
      await asServer(async (q) => {
        await viaApi(
          q,
          'discovery_runs',
          pending({ action: 'discovery.run.cancelled', entityId: run.id }),
        );
        await q.query(
          'update public.discovery_runs set cancel_requested_at = now() where id = $1',
          [run.id],
        );
      });
      expect((await jobsFor(run.id))[0]!.cancel_requested_at).not.toBeNull();
      expect(await auditActions(run.id)).toEqual(['discovery.run.cancelled']);
    }

    const beat = await asServer((q) =>
      q.query<{ ok: boolean }>("select public.heartbeat_ai_job($1, 'w', 60) as ok", [job!.id]),
    );
    expect(beat[0]!.ok).toBe(false);
    expect(
      await asServer((q) =>
        q.query("select * from public.claim_ai_job('w2', array['discovery_run'], 60)"),
      ),
    ).toEqual([]);
    const expired = await asServer((q) =>
      q.query<{ status: string }>('select status from public.expire_ai_jobs()'),
    );
    expect(expired.map((row) => row.status)).toEqual(['cancelled']);
  });

  it('empresa encontrada é única pela chave, e decisões da pessoa são auditadas', async () => {
    const [run] = await asServer((q) => insertRun(q));
    const [prospect] = await asServer((q) => insertProspect(q, run!.id, 'domain:unica.com.br'));
    await expectDbError(
      asServer((q) => insertProspect(q, run!.id, 'domain:unica.com.br')),
      { code: '23505' },
    );

    // Trabalhador atualiza a triagem sem cabeçalho de auditoria.
    await asServer(async (q) => {
      await viaApi(q);
      await q.query(
        "update public.discovery_prospects set priority = 'high', priority_score = 80 where id = $1",
        [prospect!.id],
      );
    });

    // Decisão da pessoa sem auditoria é recusada; com auditoria, registrada.
    await expectDbError(
      asServer(async (q) => {
        await viaApi(q);
        await q.query("update public.discovery_prospects set status = 'saved' where id = $1", [
          prospect!.id,
        ]);
      }),
      { message: 'audit_missing' },
    );
    await asServer(async (q) => {
      await viaApi(
        q,
        'discovery_prospects',
        pending({
          action: 'discovery.prospect.status_changed',
          entityType: 'discovery_prospect',
          entityId: prospect!.id,
          diff: { status: 'saved' },
        }),
      );
      await q.query("update public.discovery_prospects set status = 'saved' where id = $1", [
        prospect!.id,
      ]);
    });
    expect(await auditActions(prospect!.id)).toEqual(['discovery.prospect.status_changed']);

    // Motivo de descarte só com status "ignorada".
    await expectDbError(
      db.query("update public.discovery_prospects set dismissed_reason = 'x' where id = $1", [
        prospect!.id,
      ]),
      { code: '23514' },
    );
  });

  it('sinal repetido (mesma impressão digital) é recusado e datas fora do formato também', async () => {
    const [run] = await asServer((q) => insertRun(q));
    const [prospect] = await asServer((q) => insertProspect(q, run!.id, 'domain:sinais.com.br'));
    const [source] = await asServer((q) =>
      q.query<{ id: string }>(
        `insert into public.discovery_sources (prospect_id, run_id, url, host, snippet, kind,
           relation, provider, captured_at, retention_until)
         values ($1, $2, 'https://sinais.com.br/noticia', 'sinais.com.br', 'Nova unidade', 'search_result',
           'official_site', 'tavily', now(), now() + interval '12 months')
         returning id`,
        [prospect!.id, run!.id],
      ),
    );
    const insertSignal = (fingerprint: string, eventDate: string | null) =>
      asServer((q) =>
        q.query(
          `insert into public.discovery_signals (prospect_id, run_id, source_id, type, summary, quote,
             event_date, discovered_at, verification, confidence, relevance, recency, fingerprint,
             retention_until)
           values ($1, $2, $3, 'expansion', 'Nova unidade', 'Nova unidade', $4, now(), 'confirmed',
             0.85, 'high', 'recent', $5, now() + interval '12 months')`,
          [prospect!.id, run!.id, source!.id, eventDate, fingerprint],
        ),
      );
    await insertSignal(FINGERPRINT, '2026-10');
    await expectDbError(insertSignal(FINGERPRINT, '2026-10'), { code: '23505' });
    await expectDbError(insertSignal('b'.repeat(64), '2026-13'), { code: '23514' });
    await expectDbError(insertSignal('not-a-hash', null), { code: '23514' });

    // Mesma URL para a mesma empresa: uma fonte só.
    await expectDbError(
      asServer((q) =>
        q.query(
          `insert into public.discovery_sources (prospect_id, run_id, url, host, kind, relation,
             provider, captured_at, retention_until)
           values ($1, $2, 'https://sinais.com.br/noticia', 'sinais.com.br', 'web_page',
             'official_site', 'prospector', now(), now())`,
          [prospect!.id, run!.id],
        ),
      ),
      { code: '23505' },
    );
  });

  it('o servidor não altera colunas fixas (ids, chaves de origem, demo)', async () => {
    const [run] = await asServer((q) => insertRun(q));
    const [prospect] = await asServer((q) => insertProspect(q, run!.id, 'domain:fixa.com.br'));
    for (const sql of [
      'update public.discovery_prospects set first_seen_at = now() where id = $1',
      'update public.discovery_prospects set is_demo = true where id = $1',
      'delete from public.discovery_prospects where id = $1',
    ]) {
      await expectDbError(
        asServer((q) => q.query(sql, [prospect!.id])),
        { code: '42501' },
      );
    }
    await expectDbError(
      asServer((q) =>
        q.query('update public.discovery_runs set trace_id = gen_random_uuid() where id = $1', [
          run!.id,
        ]),
      ),
      { code: '42501' },
    );
  });

  it('a API pública (anon/authenticated) não lê, não grava e não pega tarefas', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      for (const table of [
        'ai_jobs',
        'discovery_monitors',
        'discovery_runs',
        'discovery_run_queries',
        'discovery_prospects',
        'discovery_run_prospects',
        'discovery_sources',
        'discovery_signals',
      ]) {
        await expectDbError(
          db.asRole(role, (q) => q.query(`select * from public.${table}`)),
          { code: '42501' },
        );
      }
      await expectDbError(
        db.asRole(role, (q) =>
          q.query("select * from public.claim_ai_job('x', array['discovery_run'], 60)"),
        ),
        { code: '42501' },
      );
    }
  });

  it('monitoramento: criar e mudar são auditados; o agendamento do trabalhador não', async () => {
    const [monitor] = await asServer(async (q) => {
      await viaApi(
        q,
        'discovery_monitors',
        pending({ action: 'discovery.monitor.created', entityType: 'discovery_monitor' }),
      );
      return q.query<{ id: string }>(
        `insert into public.discovery_monitors (name, request, frequency, max_searches, max_prospects, next_run_at)
         values ('Clínicas em expansão', 'Clínicas em expansão no interior de SP', 'daily', 3, 15, now())
         returning id`,
      );
    });
    await asServer(async (q) => {
      await viaApi(q);
      await q.query(
        "update public.discovery_monitors set next_run_at = now() + interval '1 day', missed_runs = 2 where id = $1",
        [monitor!.id],
      );
    });
    // Pausado não tem próxima execução.
    await expectDbError(
      db.query("update public.discovery_monitors set status = 'paused' where id = $1", [
        monitor!.id,
      ]),
      { code: '23514' },
    );
    expect(await auditActions(monitor!.id)).toEqual(['discovery.monitor.created']);
  });
});
