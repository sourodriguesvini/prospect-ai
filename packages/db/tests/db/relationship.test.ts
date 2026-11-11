import { createHash, randomUUID } from 'node:crypto';
import type { PendingAudit } from '@prospector/application';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { encodeAuditHeader, type AuditedTable } from '../../src/strategy-repository';
import { createTestDb, expectDbError, type Queryable, type TestDb } from '../support/test-db';

/**
 * Relacionamento (migração 20261111170000, ADR-0014): oportunidade aberta única por empresa,
 * etapas movidas só a partir da etapa vista (concorrência), rascunhos versionados e imutáveis,
 * aprovação do conteúdo exato (regra 2), contato registrado só com aprovação válida e supressão
 * (opt-out) que bloqueia aprovação e registro e cancela follow-ups. Dados SINTÉTICOS.
 */

const TRACE = '7b6c5d4e-3f20-4a1b-8c9d-0e1f2a3b4c5d';
const DAY = 86_400_000;

const pending = (overrides: Partial<PendingAudit> = {}): PendingAudit => ({
  actorType: 'user',
  actorLabel: null,
  traceId: TRACE,
  action: 'relationship.opportunity.opened',
  entityType: 'opportunity',
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

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const inDays = (days: number) => new Date(Date.now() + days * DAY).toISOString();

const STAGE_COVERS: AuditedTable[] = ['opportunity_stage_changes'];
const INTERACTION_COVERS: AuditedTable[] = [
  'opportunities',
  'opportunity_stage_changes',
  'suppression_entries',
  'tasks',
];

describe('Relacionamento no banco', () => {
  let db: TestDb;
  let offerId: string;
  let offerVersionId: string;
  let seq = 0;

  const asServer = <T>(fn: (q: Queryable) => Promise<T>) => db.asRole('service_role', fn);

  /** Escrita pelo caminho do app: cabeçalho de auditoria + SQL como service_role. */
  function write<T extends Record<string, unknown>>(
    table: AuditedTable,
    audit: Partial<PendingAudit>,
    covers: AuditedTable[],
    sql: string,
    params: unknown[] = [],
  ) {
    return asServer(async (q) => {
      await viaApi(q, encodeAuditHeader(table, pending(audit), covers));
      return q.query<T>(sql, params);
    });
  }

  const count = async (table: string, where = 'true', params: unknown[] = []) => {
    const [row] = await db.query<{ n: string }>(
      `select count(*) as n from public.${table} where ${where}`,
      params,
    );
    return Number(row!.n);
  };

  const auditActions = (entityId: string) =>
    db.query<{ action: string; entity_type: string }>(
      'select action, entity_type from public.audit_log where entity_id = $1 order by id',
      [entityId],
    );

  /** Empresa sintética direto no banco (sem PostgREST, sem auditoria). */
  async function company(options: { cnpj?: string | null; domain?: string | null } = {}) {
    seq += 1;
    const [row] = await db.query<{ id: string }>(
      `insert into public.companies (display_name, cnpj, primary_domain, origin)
       values ($1, $2, $3, 'manual') returning id`,
      [`Empresa Sintética ${seq}`, options.cnpj ?? null, options.domain ?? null],
    );
    return row!.id;
  }

  async function openOpportunity(companyId: string, stage = 'approach_ready') {
    const [row] = await write<{ id: string }>(
      'opportunities',
      {},
      STAGE_COVERS,
      'select public.open_opportunity($1::jsonb) as id',
      [JSON.stringify({ company_id: companyId, offer_id: offerId, stage, source: 'company' })],
    );
    return row!.id;
  }

  const changeStage = (id: string, from: string, to: string, note: string | null = null) =>
    write(
      'opportunities',
      { action: 'relationship.opportunity.stage_changed', entityId: id },
      STAGE_COVERS,
      'select public.change_opportunity_stage($1, $2, $3, $4)',
      [id, from, to, note],
    );

  async function draft(
    opportunityId: string,
    body: string,
    options: { threadId?: string; channel?: string } = {},
  ) {
    const threadId = options.threadId ?? randomUUID();
    const [row] = await write<{ id: string; version: number; payload_hash: string }>(
      'outbound_messages',
      { action: 'relationship.message.drafted', entityType: 'outbound_message' },
      [],
      `insert into public.outbound_messages (
         opportunity_id, kind, channel, subject, body, thread_id, origin, payload_hash)
       values ($1, 'initial_email', $2, 'Assunto sintético', $3, $4, 'user', $5)
       returning id, version, payload_hash`,
      [opportunityId, options.channel ?? 'email', body, threadId, hash(body)],
    );
    return { ...row!, threadId };
  }

  async function approve(
    message: { id: string; payload_hash: string },
    opportunityId: string,
    channel = 'email',
  ) {
    const [row] = await write<{ id: string }>(
      'approvals',
      {
        action: 'relationship.message.approved',
        entityType: 'outbound_message',
        entityId: message.id,
      },
      ['outbound_messages'],
      'select public.approve_message($1::jsonb) as id',
      [
        JSON.stringify({
          entity_id: message.id,
          opportunity_id: opportunityId,
          payload_hash: message.payload_hash,
          channel,
          clearance: { offerVersionId, liaVersionId: null },
          expires_at: inDays(3),
        }),
      ],
    );
    return row!.id;
  }

  function record(
    interaction: Record<string, unknown>,
    stage: Record<string, unknown> | null = null,
    suppression: Record<string, unknown> | null = null,
  ) {
    return write<{ id: string }>(
      'interactions',
      { action: 'relationship.interaction.recorded', entityType: 'interaction' },
      INTERACTION_COVERS,
      'select public.record_interaction($1::jsonb, $2::jsonb, $3::jsonb) as id',
      [
        JSON.stringify({ retention_until: inDays(365), ...interaction }),
        stage === null ? null : JSON.stringify(stage),
        suppression === null ? null : JSON.stringify(suppression),
      ],
    );
  }

  const addTask = (opportunityId: string, companyId: string, title = 'Retomar contato') =>
    write<{ id: string }>(
      'tasks',
      { action: 'relationship.task.created', entityType: 'task' },
      [],
      `insert into public.tasks (opportunity_id, company_id, kind, title, due_at, origin)
       values ($1, $2, 'follow_up', $3, $4, 'user') returning id`,
      [opportunityId, companyId, title, inDays(3)],
    ).then((rows) => rows[0]!.id);

  beforeAll(async () => {
    db = await createTestDb();
    const [offer] = await db.query<{ id: string }>('select public.create_offer($1::jsonb) as id', [
      JSON.stringify({
        name: 'Identidade visual (sintética)',
        description: 'Oferta de teste.',
        problems: ['Marca desatualizada'],
        need_signals: [],
        disqualifiers: [],
        deliverables: ['Manual de marca'],
        value_props: [],
        price_min_cents: 1_000_000,
        price_max_cents: 3_000_000,
      }),
    ]);
    offerId = offer!.id;
    const [version] = await db.query<{ id: string }>(
      'select id from public.offer_versions where offer_id = $1',
      [offerId],
    );
    offerVersionId = version!.id;
  });

  afterAll(async () => {
    await db.close();
  });

  describe('oportunidades', () => {
    it('open_opportunity grava oportunidade e a primeira etapa com uma linha de auditoria', async () => {
      const companyId = await company();
      const id = await openOpportunity(companyId);
      const [row] = await db.query<{ stage: string; closed_at: string | null; priority: string }>(
        'select stage, closed_at, priority from public.opportunities where id = $1',
        [id],
      );
      expect(row).toEqual({ stage: 'approach_ready', closed_at: null, priority: 'medium' });
      expect(await count('opportunity_stage_changes', 'opportunity_id = $1', [id])).toBe(1);
      expect(await auditActions(id)).toEqual([
        { action: 'relationship.opportunity.opened', entity_type: 'opportunity' },
      ]);
    });

    it('uma oportunidade aberta por empresa; etapa inicial fora da lista é recusada', async () => {
      const companyId = await company();
      await openOpportunity(companyId);
      await expectDbError(openOpportunity(companyId), {
        message: 'opportunity_open_exists',
        code: '23505',
      });
      await expectDbError(openOpportunity(await company(), 'won'), { message: 'invalid_input' });
      expect(await count('opportunities', 'company_id = $1', [companyId])).toBe(1);
    });

    it('etapa muda só a partir da etapa vista; perder encerra e reabrir limpa o motivo', async () => {
      const companyId = await company();
      const id = await openOpportunity(companyId, 'qualified');
      await changeStage(id, 'qualified', 'contacted');
      // A tela mostrava "qualificada", mas outra aba já moveu: nada é gravado.
      await expectDbError(changeStage(id, 'qualified', 'meeting'), {
        message: 'concurrent_change',
      });
      await changeStage(id, 'contacted', 'lost', 'Sem orçamento este ano');
      const [lost] = await db.query<{ closed_at: string | null; lost_reason: string | null }>(
        'select closed_at, lost_reason from public.opportunities where id = $1',
        [id],
      );
      expect(lost!.closed_at).not.toBeNull();
      expect(lost!.lost_reason).toBe('Sem orçamento este ano');
      // Com a perdida encerrada, outra pode ser aberta; reabrir a antiga colide com ela.
      const other = await openOpportunity(companyId, 'identified');
      await expectDbError(changeStage(id, 'lost', 'in_conversation'), {
        message: 'opportunity_open_exists',
      });
      await changeStage(other, 'identified', 'won');
      await changeStage(id, 'lost', 'in_conversation');
      const [reopened] = await db.query<{ closed_at: string | null; lost_reason: string | null }>(
        'select closed_at, lost_reason from public.opportunities where id = $1',
        [id],
      );
      expect(reopened).toEqual({ closed_at: null, lost_reason: null });
      const changes = await db.query<{ from_stage: string | null; to_stage: string }>(
        'select from_stage, to_stage from public.opportunity_stage_changes where opportunity_id = $1 order by created_at, id',
        [id],
      );
      expect(changes.map((c) => c.to_stage)).toEqual(
        expect.arrayContaining(['qualified', 'contacted', 'lost', 'in_conversation']),
      );
      expect(changes).toHaveLength(4);
    });

    it('empresa e origem não mudam; escrita sem auditoria é recusada', async () => {
      const id = await openOpportunity(await company());
      const other = await company();
      await expectDbError(
        db.query('update public.opportunities set company_id = $1 where id = $2', [other, id]),
        { message: 'append_only' },
      );
      await expectDbError(
        asServer(async (q) => {
          await viaApi(q);
          return q.query("update public.opportunities set priority = 'high' where id = $1", [id]);
        }),
        { message: 'audit_missing' },
      );
      await expectDbError(
        asServer((q) =>
          q.query('update public.opportunities set company_id = $1 where id = $2', [other, id]),
        ),
        { code: '42501' },
      );
    });

    it('valor só com a base que o justifica', async () => {
      const id = await openOpportunity(await company());
      await expectDbError(
        write(
          'opportunities',
          { action: 'relationship.opportunity.updated', entityId: id },
          [],
          'update public.opportunities set value_estimate_cents = 2000000 where id = $1',
          [id],
        ),
        { code: '23514' },
      );
      await write(
        'opportunities',
        { action: 'relationship.opportunity.updated', entityId: id },
        [],
        "update public.opportunities set value_estimate_cents = 2000000, value_basis = 'Faixa da oferta' where id = $1",
        [id],
      );
      expect(await count('opportunities', 'id = $1 and value_basis is not null', [id])).toBe(1);
    });
  });

  describe('rascunhos e aprovação', () => {
    it('versão por linha de mensagem; conteúdo imutável', async () => {
      const opp = await openOpportunity(await company());
      const v1 = await draft(opp, 'Olá, primeira versão sintética do texto.');
      const v2 = await draft(opp, 'Olá, segunda versão sintética do texto.', {
        threadId: v1.threadId,
      });
      expect([v1.version, v2.version]).toEqual([1, 2]);
      await expectDbError(
        asServer((q) =>
          q.query("update public.outbound_messages set body = 'trocado' where id = $1", [v1.id]),
        ),
        { code: '42501' },
      );
      await expectDbError(
        db.query("update public.outbound_messages set body = 'trocado' where id = $1", [v1.id]),
        { message: 'append_only' },
      );
      await expectDbError(db.query('delete from public.outbound_messages where id = $1', [v1.id]), {
        message: 'append_only',
      });
    });

    it('aprova o conteúdo exato da versão mais recente, com uma linha de auditoria', async () => {
      const opp = await openOpportunity(await company());
      const message = await draft(opp, 'Olá, texto sintético para aprovar.');
      const approvalId = await approve(message, opp);
      const [row] = await db.query<{
        status: string;
        approval_id: string;
        decided_at: string | null;
      }>('select status, approval_id, decided_at from public.outbound_messages where id = $1', [
        message.id,
      ]);
      expect(row).toMatchObject({ status: 'approved', approval_id: approvalId });
      expect(row!.decided_at).not.toBeNull();
      // A mensagem ganha a linha de quando foi escrita e a da aprovação (a atualização dela está
      // coberta pelo cabeçalho da aprovação).
      expect(await auditActions(message.id)).toEqual([
        { action: 'relationship.message.drafted', entity_type: 'outbound_message' },
        { action: 'relationship.message.approved', entity_type: 'outbound_message' },
      ]);
      // Aprovar de novo: já não é rascunho.
      await expectDbError(approve(message, opp), { message: 'concurrent_change' });
    });

    it('hash diferente, canal diferente ou versão antiga: nada é aprovado', async () => {
      const opp = await openOpportunity(await company());
      const message = await draft(opp, 'Olá, texto sintético original.');
      await expectDbError(approve({ ...message, payload_hash: hash('outro texto') }, opp), {
        message: 'concurrent_change',
      });
      await expectDbError(approve(message, opp, 'phone'), { message: 'concurrent_change' });
      await draft(opp, 'Olá, texto sintético editado.', { threadId: message.threadId });
      await expectDbError(approve(message, opp), { message: 'concurrent_change' });
      expect(await count('approvals', 'entity_id = $1', [message.id])).toBe(0);
    });

    it('empresa suprimida não recebe aprovação', async () => {
      const companyId = await company();
      const opp = await openOpportunity(companyId);
      const message = await draft(opp, 'Olá, texto sintético para empresa suprimida.');
      await write(
        'suppression_entries',
        { action: 'relationship.suppression.created', entityType: 'company', entityId: companyId },
        ['tasks'],
        'select public.suppress_company($1::jsonb)',
        [JSON.stringify({ company_id: companyId, reason: 'manual', source: 'user' })],
      );
      await expectDbError(approve(message, opp), { message: 'company_suppressed' });
    });
  });

  describe('interações', () => {
    async function approvedMessage() {
      const companyId = await company();
      const opp = await openOpportunity(companyId);
      const message = await draft(opp, 'Olá, texto sintético aprovado para uso.');
      const approvalId = await approve(message, opp);
      return { companyId, opp, message, approvalId };
    }

    const outbound = (
      ctx: Awaited<ReturnType<typeof approvedMessage>>,
      overrides: Record<string, unknown> = {},
    ) => ({
      opportunity_id: ctx.opp,
      company_id: ctx.companyId,
      direction: 'outbound',
      channel: 'email',
      occurred_at: new Date().toISOString(),
      message_id: ctx.message.id,
      approval_id: ctx.approvalId,
      ...overrides,
    });

    it('contato feito com aprovação válida, movendo para contatada na mesma transação', async () => {
      const ctx = await approvedMessage();
      const [row] = await record(outbound(ctx), { from: 'approach_ready', to: 'contacted' });
      expect(await count('opportunities', "id = $1 and stage = 'contacted'", [ctx.opp])).toBe(1);
      expect(await auditActions(row!.id)).toEqual([
        { action: 'relationship.interaction.recorded', entity_type: 'interaction' },
      ]);
    });

    it('aprovação de versão substituída, revogada, vencida ou de outro canal não vale', async () => {
      const edited = await approvedMessage();
      await draft(edited.opp, 'Olá, versão nova depois da aprovação.', {
        threadId: edited.message.threadId,
      });
      await expectDbError(record(outbound(edited)), { message: 'approval_invalid' });

      const revoked = await approvedMessage();
      await write(
        'approvals',
        {
          action: 'relationship.approval.revoked',
          entityType: 'approval',
          entityId: revoked.approvalId,
        },
        [],
        "update public.approvals set status = 'revoked', revoked_at = now(), revoke_reason = 'Mudei de ideia' where id = $1",
        [revoked.approvalId],
      );
      await expectDbError(record(outbound(revoked)), { message: 'approval_invalid' });

      const otherChannel = await approvedMessage();
      await expectDbError(record(outbound(otherChannel, { channel: 'phone' })), {
        message: 'approval_invalid',
      });

      // Vencida: aprovação antiga inserida direto num rascunho (o app sempre usa approve_message).
      const expiredCompany = await company();
      const expiredOpp = await openOpportunity(expiredCompany);
      const expiredDraft = await draft(expiredOpp, 'Olá, texto sintético aprovado há dias.');
      const expired = {
        companyId: expiredCompany,
        opp: expiredOpp,
        message: expiredDraft,
        approvalId: '',
      };
      const [old] = await db.query<{ id: string }>(
        `insert into public.approvals (action_type, entity_type, entity_id, opportunity_id,
           payload_hash, channel, clearance, decided_at, expires_at)
         values ('message.use', 'outbound_message', $1, $2, $3, 'email', '{}',
           now() - interval '5 days', now() - interval '2 days') returning id`,
        [expired.message.id, expired.opp, expired.message.payload_hash],
      );
      await db.query(
        "update public.outbound_messages set status = 'approved', approval_id = $1, decided_at = now() where id = $2",
        [old!.id, expired.message.id],
      );
      await expectDbError(record(outbound(expired, { approval_id: old!.id })), {
        message: 'approval_invalid',
      });
      expect(await count('interactions', 'message_id = $1', [expired.message.id])).toBe(0);
    });

    it('uma aprovação vale para um contato só', async () => {
      const ctx = await approvedMessage();
      await record(outbound(ctx));
      await expectDbError(record(outbound(ctx)), { message: 'approval_used' });
      expect(await count('interactions', 'approval_id = $1', [ctx.approvalId])).toBe(1);
    });

    it('aprovação vale no máximo 72 horas', async () => {
      const companyId = await company();
      const opp = await openOpportunity(companyId);
      const message = await draft(opp, 'Olá, texto sintético com validade longa demais.');
      await expectDbError(
        write(
          'approvals',
          { action: 'relationship.message.approved', entityType: 'outbound_message' },
          ['outbound_messages'],
          'select public.approve_message($1::jsonb) as id',
          [
            JSON.stringify({
              entity_id: message.id,
              opportunity_id: opp,
              payload_hash: message.payload_hash,
              channel: 'email',
              clearance: { offerVersionId, liaVersionId: null },
              expires_at: inDays(30),
            }),
          ],
        ),
        { code: '23514' },
      );
    });

    it('decisões finais: aprovação revogada e mensagem aprovada não voltam atrás', async () => {
      const ctx = await approvedMessage();
      const asApp = (table: AuditedTable, sql: string, id: string) =>
        write(table, { action: 'relationship.test.update', entityId: id }, [], sql, [id]);
      await expectDbError(
        asApp(
          'outbound_messages',
          "update public.outbound_messages set status = 'discarded' where id = $1",
          ctx.message.id,
        ),
        { message: 'append_only' },
      );
      await asApp(
        'approvals',
        "update public.approvals set status = 'revoked', revoked_at = now(), revoke_reason = 'Revisar' where id = $1",
        ctx.approvalId,
      );
      await expectDbError(
        asApp(
          'approvals',
          "update public.approvals set status = 'approved', revoked_at = null, revoke_reason = null where id = $1",
          ctx.approvalId,
        ),
        { message: 'append_only' },
      );
    });

    it('contato feito sem mensagem aprovada é recusado pelo banco', async () => {
      const ctx = await approvedMessage();
      await expectDbError(record(outbound(ctx, { message_id: null, approval_id: null })), {
        message: 'approval_invalid',
      });
    });

    it('pedido para parar: suprime empresa, raiz do CNPJ e domínio e cancela follow-ups', async () => {
      const companyId = await company({ cnpj: '44555666000181', domain: 'parar.test' });
      const sibling = await company({ cnpj: '44555666000262' });
      const opp = await openOpportunity(companyId);
      const siblingOpp = await openOpportunity(sibling, 'identified');
      const task = await addTask(opp, companyId);
      const siblingTask = await addTask(siblingOpp, sibling);
      const [row] = await record(
        {
          opportunity_id: opp,
          company_id: companyId,
          direction: 'inbound',
          channel: 'email',
          occurred_at: new Date().toISOString(),
          body: 'Por favor, me tire da lista.',
        },
        null,
        { reason: 'opt_out', source: 'reply_rule' },
      );
      const [entry] = await db.query<{ cnpj_root: string; domain: string; interaction_id: string }>(
        'select cnpj_root, domain, interaction_id from public.suppression_entries where company_id = $1',
        [companyId],
      );
      expect(entry).toEqual({
        cnpj_root: '44555666',
        domain: 'parar.test',
        interaction_id: row!.id,
      });
      const tasks = await db.query<{ id: string; status: string; cancel_reason: string }>(
        'select id, status, cancel_reason from public.tasks where id = any($1) order by id',
        [[task, siblingTask]],
      );
      expect(tasks.every((t) => t.status === 'cancelled' && t.cancel_reason === 'opt_out')).toBe(
        true,
      );
      const summaries = await db.query<{ id: string; suppressed: boolean; open_tasks: number }>(
        'select id, suppressed, open_tasks from public.opportunity_summaries where id = any($1)',
        [[opp, siblingOpp]],
      );
      expect(summaries).toHaveLength(2);
      expect(summaries.every((s) => s.suppressed && s.open_tasks === 0)).toBe(true);
      // Uma linha de auditoria: a interação; supressão e follow-ups estão cobertos.
      expect(await auditActions(row!.id)).toHaveLength(1);
    });

    it('resposta recebida exige o texto; só a interpretação muda depois', async () => {
      const ctx = await approvedMessage();
      const inbound = {
        opportunity_id: ctx.opp,
        company_id: ctx.companyId,
        direction: 'inbound',
        channel: 'email',
        occurred_at: new Date().toISOString(),
      };
      await expectDbError(record(inbound), { code: '23514' });
      const [row] = await record({ ...inbound, body: 'Tenho interesse, podemos conversar?' });
      await write(
        'interactions',
        { action: 'relationship.reply.analyzed', entityType: 'interaction', entityId: row!.id },
        [],
        `update public.interactions set analysis = '{"classification":"interested"}', analysis_model = 'qwen3.5:4b', analyzed_at = now() where id = $1`,
        [row!.id],
      );
      await expectDbError(
        asServer((q) =>
          q.query("update public.interactions set body = 'outro' where id = $1", [row!.id]),
        ),
        { code: '42501' },
      );
      const [summary] = await db.query<{
        last_inbound_at: string | null;
        last_interaction_at: string | null;
      }>(
        'select last_inbound_at, last_interaction_at from public.opportunity_summaries where id = $1',
        [ctx.opp],
      );
      expect(summary!.last_inbound_at).not.toBeNull();
      expect(summary!.last_interaction_at).toEqual(summary!.last_inbound_at);
    });
  });

  describe('follow-ups e supressão', () => {
    it('follow-up concluído é final', async () => {
      const companyId = await company();
      const opp = await openOpportunity(companyId);
      const task = await addTask(opp, companyId);
      const done = (sql: string) =>
        write(
          'tasks',
          { action: 'relationship.task.completed', entityType: 'task', entityId: task },
          [],
          sql,
          [task],
        );
      await done("update public.tasks set status = 'done', completed_at = now() where id = $1");
      await expectDbError(
        done("update public.tasks set status = 'open', completed_at = null where id = $1"),
        {
          message: 'append_only',
        },
      );
    });

    it('retirar supressão exige motivo e acontece uma vez', async () => {
      const companyId = await company();
      const [row] = await write<{ id: string }>(
        'suppression_entries',
        { action: 'relationship.suppression.created', entityType: 'company', entityId: companyId },
        ['tasks'],
        'select public.suppress_company($1::jsonb) as id',
        [JSON.stringify({ company_id: companyId, reason: 'manual', source: 'user' })],
      );
      const lift = (reason: string | null) =>
        write(
          'suppression_entries',
          { action: 'relationship.suppression.lifted', entityType: 'company', entityId: companyId },
          [],
          'update public.suppression_entries set lifted_at = now(), lift_reason = $2 where id = $1',
          [row!.id, reason],
        );
      await expectDbError(lift(null), { code: '23514' });
      await lift('Cliente pediu para voltar a receber.');
      const [state] = await db.query<{ suppressed: boolean }>(
        'select app.company_suppressed($1) as suppressed',
        [companyId],
      );
      expect(state!.suppressed).toBe(false);
      // Uma vez só: nem outra retirada, nem desfazer a retirada.
      await expectDbError(lift('Outra retirada, com outro motivo.'), { message: 'append_only' });
      await expectDbError(
        write(
          'suppression_entries',
          { action: 'relationship.suppression.lifted', entityType: 'company', entityId: companyId },
          [],
          'update public.suppression_entries set lifted_at = null, lift_reason = null where id = $1',
          [row!.id],
        ),
        { message: 'append_only' },
      );
      await expectDbError(
        db.query('delete from public.suppression_entries where id = $1', [row!.id]),
        {
          message: 'append_only',
        },
      );
    });
  });

  describe('supressão: pedido de titular e origem', () => {
    const suppress = (entry: Record<string, unknown>) =>
      write<{ id: string }>(
        'suppression_entries',
        { action: 'relationship.suppression.created', entityType: 'company' },
        ['tasks'],
        'select public.suppress_company($1::jsonb) as id',
        [JSON.stringify(entry)],
      );

    it('pedido de titular (LGPD) não é retirado pelo app', async () => {
      const companyId = await company();
      const [row] = await suppress({
        company_id: companyId,
        reason: 'legal_request',
        source: 'user',
      });
      await expectDbError(
        write(
          'suppression_entries',
          { action: 'relationship.suppression.lifted', entityType: 'company', entityId: companyId },
          [],
          'update public.suppression_entries set lifted_at = now(), lift_reason = $2 where id = $1',
          [row!.id, 'Tentando retirar o pedido de titular.'],
        ),
        { message: 'suppression_locked' },
      );
    });

    it('a interação de origem precisa ser da mesma empresa', async () => {
      const companyId = await company();
      const other = await company();
      const opp = await openOpportunity(other);
      const [reply] = await record({
        opportunity_id: opp,
        company_id: other,
        direction: 'inbound',
        channel: 'email',
        occurred_at: new Date().toISOString(),
        body: 'Texto sintético de outra empresa.',
      });
      await expectDbError(
        suppress({
          company_id: companyId,
          reason: 'opt_out',
          source: 'reply_ai',
          interaction_id: reply!.id,
        }),
        { message: 'not_found' },
      );
      const [own] = await suppress({
        company_id: other,
        reason: 'opt_out',
        source: 'reply_ai',
        interaction_id: reply!.id,
      });
      const [entry] = await db.query<{ interaction_id: string }>(
        'select interaction_id from public.suppression_entries where id = $1',
        [own!.id],
      );
      expect(entry!.interaction_id).toBe(reply!.id);
    });
  });

  it('a API pública não lê as tabelas nem executa as RPCs do Relacionamento', async () => {
    for (const role of ['anon', 'authenticated'] as const) {
      await expectDbError(
        db.asRole(role, (q) => q.query('select id from public.opportunity_summaries')),
        { code: '42501' },
      );
      await expectDbError(
        db.asRole(role, (q) =>
          q.query('select public.approve_message($1::jsonb)', [JSON.stringify({})]),
        ),
        { code: '42501' },
      );
    }
  });

  it('nada some por truncate', async () => {
    for (const table of ['opportunities', 'interactions', 'approvals', 'tasks']) {
      await expectDbError(db.query(`truncate public.${table} cascade`), { message: 'append_only' });
    }
  });
});
