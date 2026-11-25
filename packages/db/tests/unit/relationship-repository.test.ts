import type { PendingAudit } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { createServerSupabaseClient, createSupabaseRelationshipRepository } from '../../src';
import { AUDIT_HEADER } from '../../src/strategy-repository';

/**
 * Adaptador do Relacionamento (ADR-0014) contra respostas do PostgREST simuladas (sem Supabase
 * real): rotas, RPCs, corpo em snake_case, registro de auditoria e mapeamento das linhas. O
 * comportamento do banco (aprovação, supressão, travas) está em tests/db/relationship.test.ts.
 * Dados SINTÉTICOS.
 */

const URL_BASE = 'http://supabase.local.test';
const AT = '2026-11-11T12:00:00+00:00';
const OPPORTUNITY_ID = '11111111-1111-4111-8111-111111111111';
const COMPANY_ID = '22222222-2222-4222-8222-222222222222';
const INTERACTION_ID = '33333333-3333-4333-8333-333333333333';
const SUPPRESSION_ID = '44444444-4444-4444-8444-444444444444';
const MESSAGE_ID = '66666666-6666-4666-8666-666666666666';
const APPROVAL_ID = '77777777-7777-4777-8777-777777777777';

interface Captured {
  url: URL;
  method: string;
  body: unknown;
  headers: Headers;
}

const AUDIT: PendingAudit = {
  actorType: 'user',
  actorLabel: null,
  traceId: '55555555-5555-4555-8555-555555555555',
  action: 'relationship.reply.recorded',
  entityType: 'interaction',
  entityId: null,
  diff: { stopDetected: true },
  withVersion: false,
};

const sentAudit = (req: Captured | undefined) => {
  const value = req?.headers.get(AUDIT_HEADER);
  return value ? (JSON.parse(Buffer.from(value, 'base64').toString('utf8')) as unknown) : null;
};

function stub(respond: (req: Captured) => Response) {
  const calls: Captured[] = [];
  const fetchStub: typeof fetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const req: Captured = {
      url: new URL(href),
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : null,
      headers: new Headers(init?.headers),
    };
    calls.push(req);
    return respond(req);
  };
  const client = createServerSupabaseClient(URL_BASE, 'chave-de-teste-nao-real', {
    fetch: fetchStub,
  });
  return { repo: createSupabaseRelationshipRepository(client), calls };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const path = (req: Captured) => req.url.pathname.replace('/rest/v1/', '');

const INTERACTION_ROW = {
  id: INTERACTION_ID,
  opportunity_id: OPPORTUNITY_ID,
  company_id: COMPANY_ID,
  direction: 'inbound',
  channel: 'email',
  occurred_at: '2026-11-11T11:59:00.123456+00:00',
  summary: null,
  body: 'Remova meu e-mail da base.',
  message_id: null,
  approval_id: null,
  counterpart_role: 'Sócio',
  analysis: null,
  analysis_prompt_id: null,
  analysis_model: null,
  analyzed_at: null,
  retention_until: '2027-11-11T12:00:00+00:00',
  is_demo: false,
  created_at: AT,
};

const SUPPRESSION_ROW = {
  id: SUPPRESSION_ID,
  company_id: COMPANY_ID,
  cnpj_root: '11222333',
  domain: 'exemplo.example',
  reason: 'opt_out',
  source: 'reply_ai',
  interaction_id: INTERACTION_ID,
  lifted_at: null,
  lift_reason: null,
  created_at: AT,
};

describe('createSupabaseRelationshipRepository', () => {
  it('recordInteraction: RPC atômica com a interação em snake_case, etapa e supressão', async () => {
    const { repo, calls } = stub((req) =>
      path(req) === 'rpc/record_interaction'
        ? json(200, INTERACTION_ID)
        : json(200, INTERACTION_ROW),
    );
    const interaction = await repo.recordInteraction(
      {
        id: INTERACTION_ID,
        opportunityId: OPPORTUNITY_ID,
        companyId: COMPANY_ID,
        direction: 'inbound',
        channel: 'email',
        occurredAt: '2026-11-11T11:59:00.123Z',
        summary: null,
        body: 'Remova meu e-mail da base.',
        messageId: null,
        approvalId: null,
        counterpartRole: 'Sócio',
        retentionUntil: '2027-11-11T12:00:00.000Z',
        isDemo: false,
      },
      { from: 'contacted', to: 'in_conversation', note: null },
      { reason: 'opt_out', source: 'reply_rule' },
      AUDIT,
    );
    expect(calls[0]).toMatchObject({ method: 'POST' });
    expect(path(calls[0]!)).toBe('rpc/record_interaction');
    expect(calls[0]!.body).toEqual({
      p_interaction: {
        id: INTERACTION_ID,
        opportunity_id: OPPORTUNITY_ID,
        company_id: COMPANY_ID,
        direction: 'inbound',
        channel: 'email',
        occurred_at: '2026-11-11T11:59:00.123Z',
        summary: null,
        body: 'Remova meu e-mail da base.',
        message_id: null,
        approval_id: null,
        counterpart_role: 'Sócio',
        retention_until: '2027-11-11T12:00:00.000Z',
        is_demo: false,
      },
      p_stage: { from: 'contacted', to: 'in_conversation', note: null },
      p_suppression: { reason: 'opt_out', source: 'reply_rule' },
    });
    // Releitura da linha gravada, mapeada pelo contrato (datas em ISO UTC).
    expect(path(calls[1]!)).toBe('interactions');
    expect(calls[1]!.url.searchParams.get('id')).toBe(`eq.${INTERACTION_ID}`);
    expect(interaction).toMatchObject({
      id: INTERACTION_ID,
      direction: 'inbound',
      occurredAt: '2026-11-11T11:59:00.123Z',
      counterpartRole: 'Sócio',
      createdAt: '2026-11-11T12:00:00.000Z',
    });
  });

  it('suppress: leva a interação de origem; activeSuppressions filtra empresa, raiz e domínio', async () => {
    const { repo, calls } = stub((req) =>
      path(req) === 'rpc/suppress_company' ? json(200, SUPPRESSION_ID) : json(200, SUPPRESSION_ROW),
    );
    const entry = await repo.suppress(
      COMPANY_ID,
      { reason: 'opt_out', source: 'reply_ai', interactionId: INTERACTION_ID },
      { ...AUDIT, action: 'relationship.suppression.created', entityType: 'company' },
    );
    expect(calls[0]!.body).toEqual({
      p_entry: {
        company_id: COMPANY_ID,
        reason: 'opt_out',
        source: 'reply_ai',
        interaction_id: INTERACTION_ID,
      },
    });
    expect(entry).toMatchObject({ id: SUPPRESSION_ID, interactionId: INTERACTION_ID });

    const read = stub(() => json(200, [SUPPRESSION_ROW]));
    const active = await read.repo.activeSuppressions({
      id: COMPANY_ID,
      cnpjRoot: '11222333',
      primaryDomain: 'exemplo.example',
    });
    expect(active).toHaveLength(1);
    const params = read.calls[0]!.url.searchParams;
    expect(params.get('lifted_at')).toBe('is.null');
    expect(params.get('or')).toBe(
      `(company_id.eq."${COMPANY_ID}",cnpj_root.eq."11222333",domain.eq."exemplo.example")`,
    );
  });

  it.each([
    ['approval_used', 'conflict'],
    ['approval_invalid', 'conflict'],
    ['company_suppressed', 'conflict'],
    ['opportunity_closed', 'conflict'],
  ] as const)('erro "%s" da RPC vira AppError %s, sem detalhe interno', async (reason, code) => {
    const { repo } = stub(() => json(400, { message: reason, code: 'P0001' }));
    const error = await repo
      .recordInteraction({} as never, null, null, AUDIT)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code, reason });
  });

  it('retirar supressão de pedido de titular: trava do banco vira suppression_locked', async () => {
    const { repo } = stub(() => json(403, { message: 'suppression_locked', code: '42501' }));
    const error = await repo
      .liftSuppression(SUPPRESSION_ID, 'Motivo sintético de teste.', AUDIT)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict', reason: 'suppression_locked' });
  });

  it('decisão final: atualização sem linha e com registro existente vira invalid_status_change', async () => {
    const { repo, calls } = stub((req) =>
      req.method === 'PATCH' ? json(200, null) : json(200, { id: OPPORTUNITY_ID }),
    );
    const error = await repo
      .decidePlan(OPPORTUNITY_ID, 'discarded', AUDIT)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'conflict', reason: 'invalid_status_change' });
    // Só decide o que ainda é rascunho.
    expect(calls[0]!.url.searchParams.get('status')).toBe('eq.draft');
  });

  it('messageReviews: lê só a chave aiReview do registro de inclusão; registro torto fica de fora', async () => {
    const OTHER_ID = '88888888-8888-4888-8888-888888888888';
    const { repo, calls } = stub(() =>
      json(200, [
        { entity_id: MESSAGE_ID, ai_review: { corrected: true, kinds: ['source'], adjusted: 1 } },
        // Formato antigo ou estranho não derruba a tela: só não aparece.
        { entity_id: OTHER_ID, ai_review: { corrected: 'sim', unresolved: ['texto'] } },
      ]),
    );
    const reviews = await repo.messageReviews([MESSAGE_ID, OTHER_ID, MESSAGE_ID]);
    expect([...reviews]).toEqual([
      [MESSAGE_ID, { corrected: true, kinds: ['source'], adjusted: 1 }],
    ]);
    expect(path(calls[0]!)).toBe('audit_log');
    const params = calls[0]!.url.searchParams;
    expect(params.get('select')).toBe('entity_id,ai_review:diff->aiReview');
    expect(params.get('entity_type')).toBe('eq.outbound_message');
    expect(params.get('entity_id')).toBe(`in.(${MESSAGE_ID},${OTHER_ID})`);
    expect(params.get('diff->aiReview')).toBe('not.is.null');
    // Sem ids, nenhum pedido.
    const empty = stub(() => json(200, []));
    expect((await empty.repo.messageReviews([])).size).toBe(0);
    expect(empty.calls).toHaveLength(0);
  });

  it('linha fora do formato esperado falha alto (mudança de esquema)', async () => {
    const { repo } = stub(() => json(200, [{ ...INTERACTION_ROW, direction: 'sideways' }]));
    await expect(repo.listInteractions({ opportunityId: OPPORTUNITY_ID })).rejects.toThrow();
  });
});

/**
 * Toda escrita leva o registro de auditoria no próprio pedido, com a tabela do caminho (ou, nas
 * RPCs, a tabela que registra e as que ela cobre). O trigger recusa outra combinação.
 */
describe('registro de auditoria em todas as escritas do Relacionamento', () => {
  const any = {} as never;
  const writes: [string, (repo: ReturnType<typeof stub>['repo']) => Promise<unknown>][] = [
    ['openOpportunity', (r) => r.openOpportunity(any, AUDIT)],
    [
      'changeStage',
      (r) => r.changeStage(OPPORTUNITY_ID, { from: 'contacted', to: 'meeting', note: null }, AUDIT),
    ],
    ['updateOpportunity', (r) => r.updateOpportunity(OPPORTUNITY_ID, any, AUDIT)],
    ['insertPlan', (r) => r.insertPlan(any, AUDIT)],
    ['decidePlan', (r) => r.decidePlan(OPPORTUNITY_ID, 'discarded', AUDIT)],
    ['insertMessage', (r) => r.insertMessage(any, AUDIT)],
    ['discardMessage', (r) => r.discardMessage(MESSAGE_ID, AUDIT)],
    ['approveMessage', (r) => r.approveMessage(any, AUDIT)],
    ['revokeApproval', (r) => r.revokeApproval(APPROVAL_ID, 'Revisar.', AUDIT)],
    ['recordInteraction', (r) => r.recordInteraction(any, null, null, AUDIT)],
    ['saveAnalysis', (r) => r.saveAnalysis(INTERACTION_ID, any, AUDIT)],
    ['insertTask', (r) => r.insertTask(any, AUDIT)],
    ['updateTask', (r) => r.updateTask(INTERACTION_ID, { status: 'done' }, AUDIT)],
    ['suppress', (r) => r.suppress(COMPANY_ID, { reason: 'manual', source: 'user' }, AUDIT)],
    ['liftSuppression', (r) => r.liftSuppression(SUPPRESSION_ID, 'Motivo sintético.', AUDIT)],
  ];
  const STAGE_COVERS = { table: 'opportunities', covers: ['opportunity_stage_changes'] };
  const RPC: Record<string, { table: string; covers: string[] }> = {
    'rpc/open_opportunity': STAGE_COVERS,
    'rpc/change_opportunity_stage': STAGE_COVERS,
    'rpc/approve_message': { table: 'approvals', covers: ['outbound_messages'] },
    'rpc/record_interaction': {
      table: 'interactions',
      covers: ['opportunities', 'opportunity_stage_changes', 'suppression_entries', 'tasks'],
    },
    'rpc/suppress_company': { table: 'suppression_entries', covers: ['tasks'] },
  };

  it.each(writes)('%s', async (_name, write) => {
    // Responde erro na primeira chamada: só interessa o pedido de escrita.
    const { repo, calls } = stub(() => json(500, { message: 'parar', code: 'XX000' }));
    await write(repo).catch(() => undefined);
    const [request] = calls;
    expect(request?.method).not.toBe('GET');
    const sent = sentAudit(request) as { table: string; covers: string[] } | null;
    const target = path(request!);
    const expected = RPC[target] ?? { table: target, covers: [] };
    expect({ table: sent?.table, covers: sent?.covers }).toEqual(expected);
  });
});
