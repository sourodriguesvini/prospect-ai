import type {
  ApproachPlan,
  Approval,
  Company,
  Interaction,
  Opportunity,
  OutboundMessage,
  StageChange,
  SuppressionEntry,
  Task,
} from '@prospector/contracts';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import type {
  OpportunitySummaryRow,
  RelationshipRepository,
} from '../ports/relationship-repository';

const clone = <T>(value: T): T => structuredClone(value);
const CLOSED = new Set(['won', 'lost']);

/**
 * Relacionamento em memória: mesmo comportamento observável do banco (migração
 * 20261111170000): uma oportunidade aberta por empresa, etapa movida só a partir da etapa vista,
 * conteúdo imutável com versões, aprovação e registro de contato conferidos de novo, supressão por
 * empresa, raiz do CNPJ ou domínio que cancela follow-ups, e uma linha de auditoria por operação.
 */
export function createMemoryRelationshipRepository(options: {
  audit: AuditRepository;
  /** Empresas (nome, raiz do CNPJ e domínio) vêm do repositório de Empresas. */
  companies: { get(id: string): Promise<Company | null> };
  clock?: Clock;
  newId?: () => string;
}): RelationshipRepository {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = () => clock.now().toISOString();

  const opportunities = new Map<string, Opportunity>();
  const stageChanges: StageChange[] = [];
  const plans = new Map<string, ApproachPlan>();
  const messages = new Map<string, OutboundMessage>();
  const approvals = new Map<string, Approval>();
  const interactions = new Map<string, Interaction>();
  const tasks = new Map<string, Task>();
  const suppressions = new Map<string, SuppressionEntry>();

  async function audited(audit: PendingAudit, id: string, version?: number): Promise<void> {
    await options.audit.append({
      actorType: audit.actorType,
      actorLabel: audit.actorLabel,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? id,
      diff: {
        ...audit.diff,
        ...(audit.withVersion && version !== undefined ? { version } : {}),
      },
      traceId: audit.traceId,
    });
  }

  async function company(id: string): Promise<Company> {
    const found = await options.companies.get(id);
    if (!found) throw new AppError('not_found', 'not_found');
    return found;
  }

  function matches(
    entry: SuppressionEntry,
    target: Pick<Company, 'id' | 'cnpjRoot' | 'primaryDomain'>,
  ) {
    return (
      entry.liftedAt === null &&
      (entry.companyId === target.id ||
        (entry.cnpjRoot !== null && entry.cnpjRoot === target.cnpjRoot) ||
        (entry.domain !== null && entry.domain === target.primaryDomain))
    );
  }

  async function suppressedCompany(companyId: string): Promise<boolean> {
    const target = await company(companyId);
    return [...suppressions.values()].some((entry) => matches(entry, target));
  }

  function latestOf(threadId: string): OutboundMessage | null {
    let latest: OutboundMessage | null = null;
    for (const message of messages.values()) {
      if (message.threadId === threadId && (!latest || message.version > latest.version)) {
        latest = message;
      }
    }
    return latest;
  }

  async function summary(opportunity: Opportunity): Promise<OpportunitySummaryRow> {
    const owner = await company(opportunity.companyId);
    const own = [...interactions.values()].filter((item) => item.opportunityId === opportunity.id);
    const max = (items: Interaction[]) =>
      items.reduce<string | null>(
        (acc, item) => (acc === null || item.occurredAt > acc ? item.occurredAt : acc),
        null,
      );
    const open = [...tasks.values()].filter(
      (task) => task.opportunityId === opportunity.id && task.status === 'open',
    );
    return {
      ...clone(opportunity),
      companyName: owner.displayName,
      companyIsDemo: owner.isDemo,
      lastInteractionAt: max(own.filter((item) => item.direction !== 'note')),
      lastInboundAt: max(own.filter((item) => item.direction === 'inbound')),
      lastOutboundAt: max(own.filter((item) => item.direction === 'outbound')),
      openTasks: open.length,
      nextTaskDueAt: open.reduce<string | null>(
        (acc, task) => (acc === null || task.dueAt < acc ? task.dueAt : acc),
        null,
      ),
      suppressed: await suppressedCompany(opportunity.companyId),
    };
  }

  function requireOpportunity(id: string): Opportunity {
    const found = opportunities.get(id);
    if (!found) throw new AppError('not_found', 'not_found');
    return found;
  }

  /** Mesma regra de `app.move_opportunity`: confere a etapa vista e a oportunidade aberta única. */
  function move(id: string, from: string, to: string, note: string | null): Opportunity {
    const current = requireOpportunity(id);
    if (from === to) throw new AppError('validation', 'invalid_input');
    if (current.stage !== from) throw new AppError('conflict', 'concurrent_change');
    const closing = CLOSED.has(to);
    if (!closing && current.closedAt) {
      const other = [...opportunities.values()].some(
        (item) => item.id !== id && item.companyId === current.companyId && !item.closedAt,
      );
      if (other) throw new AppError('conflict', 'opportunity_open_exists');
    }
    const at = now();
    const cleanNote = note?.trim() ? note.trim() : null;
    const updated: Opportunity = {
      ...current,
      stage: to as Opportunity['stage'],
      closedAt: closing ? (current.closedAt ?? at) : null,
      lostReason: to === 'lost' ? (cleanNote ?? current.lostReason) : null,
      updatedAt: at,
    };
    opportunities.set(id, updated);
    stageChanges.push({
      id: newId(),
      opportunityId: id,
      fromStage: from as StageChange['fromStage'],
      toStage: to as StageChange['toStage'],
      note: cleanNote,
      createdAt: at,
    });
    return updated;
  }

  async function applySuppression(
    companyId: string,
    entry: { reason: SuppressionEntry['reason']; source: SuppressionEntry['source'] },
    interactionId: string | null,
  ): Promise<SuppressionEntry> {
    const target = await company(companyId);
    const created: SuppressionEntry = {
      id: newId(),
      companyId: target.id,
      cnpjRoot: target.cnpjRoot,
      domain: target.primaryDomain,
      reason: entry.reason,
      source: entry.source,
      interactionId,
      liftedAt: null,
      liftReason: null,
      createdAt: now(),
    };
    suppressions.set(created.id, created);
    const at = now();
    for (const task of tasks.values()) {
      if (task.status !== 'open') continue;
      const owner = await company(task.companyId);
      const reached =
        owner.id === target.id ||
        (target.cnpjRoot !== null && owner.cnpjRoot === target.cnpjRoot) ||
        (target.primaryDomain !== null && owner.primaryDomain === target.primaryDomain);
      if (reached) {
        tasks.set(task.id, {
          ...task,
          status: 'cancelled',
          cancelReason: 'opt_out',
          completedAt: at,
          updatedAt: at,
        });
      }
    }
    return created;
  }

  const byNewest = <T extends { createdAt: string }>(a: T, b: T) =>
    b.createdAt.localeCompare(a.createdAt);

  return {
    async listOpportunities(filter) {
      const rows = [...opportunities.values()]
        .filter((item) => filter.includeClosed || !item.closedAt)
        .filter((item) => !filter.companyId || item.companyId === filter.companyId)
        .filter((item) => !filter.stages?.length || filter.stages.includes(item.stage));
      const summaries = await Promise.all(rows.map(summary));
      summaries.sort((a, b) =>
        (b.lastInteractionAt ?? b.updatedAt).localeCompare(a.lastInteractionAt ?? a.updatedAt),
      );
      return summaries.slice(0, filter.limit ?? 500);
    },

    async getOpportunitySummary(id) {
      const found = opportunities.get(id);
      return found ? summary(found) : null;
    },

    async getOpportunity(id) {
      const found = opportunities.get(id);
      return found ? clone(found) : null;
    },

    async openOpportunityFor(companyId) {
      const found = [...opportunities.values()].find(
        (item) => item.companyId === companyId && !item.closedAt,
      );
      return found ? clone(found) : null;
    },

    async listStageChanges(opportunityId) {
      return clone(stageChanges.filter((item) => item.opportunityId === opportunityId));
    },

    async listPlans(opportunityId) {
      return clone(
        [...plans.values()]
          .filter((plan) => plan.opportunityId === opportunityId)
          .sort((a, b) => b.version - a.version),
      );
    },

    async listMessages(filter) {
      let rows = [...messages.values()];
      if (filter.opportunityId) {
        rows = rows.filter((message) => message.opportunityId === filter.opportunityId);
      }
      if (filter.latestOnly) {
        rows = rows.filter((message) => latestOf(message.threadId)?.id === message.id);
      }
      if (filter.status) rows = rows.filter((message) => message.status === filter.status);
      return clone(rows.sort(byNewest).slice(0, filter.limit ?? 500));
    },

    async getMessage(id) {
      const found = messages.get(id);
      return found ? clone(found) : null;
    },

    async latestVersionOf(threadId) {
      const latest = latestOf(threadId);
      return latest ? clone(latest) : null;
    },

    async listApprovals(filter) {
      return clone(
        [...approvals.values()]
          .filter((item) => !filter.opportunityId || item.opportunityId === filter.opportunityId)
          .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
          .slice(0, filter.limit ?? 500),
      );
    },

    async getApproval(id) {
      const found = approvals.get(id);
      return found ? clone(found) : null;
    },

    async listInteractions(filter) {
      return clone(
        [...interactions.values()]
          .filter((item) => !filter.opportunityId || item.opportunityId === filter.opportunityId)
          .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
          .slice(0, filter.limit ?? 500),
      );
    },

    async getInteraction(id) {
      const found = interactions.get(id);
      return found ? clone(found) : null;
    },

    async listTasks(filter) {
      return clone(
        [...tasks.values()]
          .filter((task) => !filter.opportunityId || task.opportunityId === filter.opportunityId)
          .filter((task) => !filter.status || task.status === filter.status)
          .sort((a, b) => a.dueAt.localeCompare(b.dueAt))
          .slice(0, filter.limit ?? 500),
      );
    },

    async getTask(id) {
      const found = tasks.get(id);
      return found ? clone(found) : null;
    },

    async activeSuppressions(target) {
      return clone([...suppressions.values()].filter((entry) => matches(entry, target)));
    },

    async listSuppressions(companyId) {
      return clone(
        [...suppressions.values()].filter((entry) => entry.companyId === companyId).sort(byNewest),
      );
    },

    async getSuppression(id) {
      const found = suppressions.get(id);
      return found ? clone(found) : null;
    },

    async openOpportunity(row, audit) {
      await company(row.companyId);
      if (
        [...opportunities.values()].some(
          (item) => item.companyId === row.companyId && !item.closedAt,
        )
      ) {
        throw new AppError('conflict', 'opportunity_open_exists');
      }
      const at = now();
      const created: Opportunity = {
        id: row.id,
        companyId: row.companyId,
        offerId: row.offerId,
        stage: row.stage,
        priority: row.priority,
        valueEstimateCents: null,
        valueBasis: null,
        nextAction: null,
        nextActionDueAt: null,
        lostReason: null,
        source: row.source,
        closedAt: null,
        isDemo: row.isDemo,
        createdAt: at,
        updatedAt: at,
      };
      opportunities.set(created.id, created);
      stageChanges.push({
        id: newId(),
        opportunityId: created.id,
        fromStage: null,
        toStage: row.stage,
        note: null,
        createdAt: at,
      });
      await audited(audit, created.id);
      return clone(created);
    },

    async changeStage(id, stageMove, audit) {
      const updated = move(id, stageMove.from, stageMove.to, stageMove.note);
      await audited(audit, id);
      return clone(updated);
    },

    async updateOpportunity(id, patch, audit) {
      const current = requireOpportunity(id);
      if ((patch.valueEstimateCents === null) !== (patch.valueBasis === null)) {
        throw new AppError('validation', 'invalid_input');
      }
      const updated: Opportunity = { ...current, ...patch, updatedAt: now() };
      opportunities.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },

    async insertPlan(plan, audit) {
      requireOpportunity(plan.opportunityId);
      const version =
        Math.max(
          0,
          ...[...plans.values()]
            .filter((item) => item.opportunityId === plan.opportunityId)
            .map((item) => item.version),
        ) + 1;
      const created: ApproachPlan = {
        ...clone(plan),
        version,
        status: 'draft',
        decidedAt: null,
        createdAt: now(),
      };
      plans.set(created.id, created);
      await audited(audit, created.id, version);
      return clone(created);
    },

    async decidePlan(id, status, audit) {
      const current = plans.get(id);
      if (!current) throw new AppError('not_found', 'not_found');
      if (current.status !== 'draft') throw new AppError('conflict', 'invalid_status_change');
      const updated: ApproachPlan = { ...current, status, decidedAt: now() };
      plans.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },

    async insertMessage(message, audit) {
      requireOpportunity(message.opportunityId);
      const latest = latestOf(message.threadId);
      const created: OutboundMessage = {
        ...clone(message),
        version: (latest?.version ?? 0) + 1,
        status: 'draft',
        approvalId: null,
        decidedAt: null,
        createdAt: now(),
      };
      messages.set(created.id, created);
      await audited(audit, created.id, created.version);
      return clone(created);
    },

    async discardMessage(id, audit) {
      const current = messages.get(id);
      if (!current) throw new AppError('not_found', 'not_found');
      if (current.status !== 'draft') throw new AppError('conflict', 'invalid_status_change');
      const updated: OutboundMessage = { ...current, status: 'discarded', decidedAt: now() };
      messages.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },

    async approveMessage(approval, audit) {
      const message = messages.get(approval.messageId);
      if (!message) throw new AppError('not_found', 'not_found');
      const opportunity = requireOpportunity(message.opportunityId);
      if (
        message.status !== 'draft' ||
        message.opportunityId !== approval.opportunityId ||
        message.payloadHash !== approval.payloadHash ||
        message.channel !== approval.channel ||
        latestOf(message.threadId)?.id !== message.id
      ) {
        throw new AppError('conflict', 'concurrent_change');
      }
      if (opportunity.closedAt) throw new AppError('conflict', 'opportunity_closed');
      if (await suppressedCompany(opportunity.companyId)) {
        throw new AppError('conflict', 'company_suppressed');
      }
      const at = now();
      const created: Approval = {
        id: approval.id,
        actionType: 'message.use',
        entityType: 'outbound_message',
        entityId: message.id,
        opportunityId: message.opportunityId,
        payloadHash: message.payloadHash,
        channel: message.channel,
        status: 'approved',
        clearance: clone(approval.clearance),
        decidedAt: at,
        expiresAt: approval.expiresAt,
        revokedAt: null,
        revokeReason: null,
        createdAt: at,
      };
      approvals.set(created.id, created);
      messages.set(message.id, {
        ...message,
        status: 'approved',
        approvalId: created.id,
        decidedAt: at,
      });
      await audited(audit, created.id);
      return clone(created);
    },

    async revokeApproval(id, reason, audit) {
      const current = approvals.get(id);
      if (!current) throw new AppError('not_found', 'not_found');
      if (current.status !== 'approved') throw new AppError('conflict', 'invalid_status_change');
      const updated: Approval = {
        ...current,
        status: 'revoked',
        revokedAt: now(),
        revokeReason: reason,
      };
      approvals.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },

    async recordInteraction(row, stage, suppression, audit) {
      const opportunity = requireOpportunity(row.opportunityId);
      if (opportunity.companyId !== row.companyId) throw new AppError('not_found', 'not_found');
      if (row.direction === 'outbound') {
        if (opportunity.closedAt) throw new AppError('conflict', 'opportunity_closed');
        const message = row.messageId ? messages.get(row.messageId) : undefined;
        const approval = row.approvalId ? approvals.get(row.approvalId) : undefined;
        if (
          !message ||
          !approval ||
          message.opportunityId !== opportunity.id ||
          message.channel !== row.channel ||
          approval.channel !== row.channel ||
          message.status !== 'approved' ||
          message.approvalId !== approval.id ||
          approval.status !== 'approved' ||
          Date.parse(approval.expiresAt) <= clock.now().getTime() ||
          approval.payloadHash !== message.payloadHash ||
          approval.entityId !== message.id ||
          approval.opportunityId !== opportunity.id ||
          latestOf(message.threadId)?.id !== message.id
        ) {
          throw new AppError('conflict', 'approval_invalid');
        }
        if (await suppressedCompany(opportunity.companyId)) {
          throw new AppError('conflict', 'company_suppressed');
        }
        // Uma aprovação vale para um contato só (como no banco).
        const used = [...interactions.values()].some(
          (item) => item.direction === 'outbound' && item.approvalId === approval.id,
        );
        if (used) throw new AppError('conflict', 'approval_used');
      } else if (row.messageId || row.approvalId) {
        throw new AppError('validation', 'invalid_input');
      }
      if (row.direction === 'inbound' && !row.body)
        throw new AppError('validation', 'invalid_input');
      if (row.direction === 'note' && !row.summary)
        throw new AppError('validation', 'invalid_input');
      // Confere a mudança de etapa antes de gravar: ou tudo entra, ou nada.
      if (stage) {
        if (stage.from === stage.to) throw new AppError('validation', 'invalid_input');
        if (opportunity.stage !== stage.from) throw new AppError('conflict', 'concurrent_change');
      }
      const created: Interaction = {
        ...clone(row),
        analysis: null,
        analysisPromptId: null,
        analysisModel: null,
        analyzedAt: null,
        createdAt: now(),
      };
      interactions.set(created.id, created);
      if (stage) move(opportunity.id, stage.from, stage.to, stage.note);
      if (suppression) await applySuppression(opportunity.companyId, suppression, created.id);
      await audited(audit, created.id);
      return clone(created);
    },

    async saveAnalysis(id, record, audit) {
      const current = interactions.get(id);
      if (!current) throw new AppError('not_found', 'not_found');
      const updated: Interaction = {
        ...current,
        analysis: clone(record.analysis),
        analysisPromptId: record.promptId,
        analysisModel: record.model,
        analyzedAt: now(),
      };
      interactions.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },

    async insertTask(task, audit) {
      requireOpportunity(task.opportunityId);
      const at = now();
      const created: Task = {
        ...clone(task),
        status: 'open',
        completedAt: null,
        cancelReason: null,
        createdAt: at,
        updatedAt: at,
      };
      tasks.set(created.id, created);
      await audited(audit, created.id);
      return clone(created);
    },

    async updateTask(id, patch, audit) {
      const current = tasks.get(id);
      if (!current) throw new AppError('not_found', 'not_found');
      if (current.status !== 'open') throw new AppError('conflict', 'invalid_status_change');
      const at = now();
      const updated: Task =
        'dueAt' in patch
          ? { ...current, dueAt: patch.dueAt, updatedAt: at }
          : patch.status === 'done'
            ? { ...current, status: 'done', completedAt: at, updatedAt: at }
            : {
                ...current,
                status: 'cancelled',
                cancelReason: patch.cancelReason,
                completedAt: at,
                updatedAt: at,
              };
      tasks.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },

    async suppress(companyId, entry, audit) {
      const interactionId = entry.interactionId ?? null;
      if (interactionId && interactions.get(interactionId)?.companyId !== companyId) {
        throw new AppError('not_found', 'not_found');
      }
      const created = await applySuppression(companyId, entry, interactionId);
      await audited(audit, created.id);
      return clone(created);
    },

    async liftSuppression(id, reason, audit) {
      const current = suppressions.get(id);
      if (!current) throw new AppError('not_found', 'not_found');
      if (current.liftedAt) throw new AppError('conflict', 'invalid_status_change');
      if (current.reason === 'legal_request') throw new AppError('conflict', 'suppression_locked');
      const updated: SuppressionEntry = { ...current, liftedAt: now(), liftReason: reason };
      suppressions.set(id, updated);
      await audited(audit, id);
      return clone(updated);
    },
  };
}
