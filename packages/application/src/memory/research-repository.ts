import {
  CopilotResearch,
  ResearchProgress,
  type ResearchItemView,
  type UF,
} from '@prospector/contracts';
import { COMMERCIAL_PROFILES } from '@prospector/domain';
import { systemClock, type Clock } from '../clock';
import { AppError } from '../errors';
import type { AuditRepository, PendingAudit } from '../ports/audit-repository';
import type {
  NewResearchOrganization,
  NewResearchPerson,
  ResearchRepository,
} from '../ports/research-repository';
import type { MemoryJobInput } from './discovery';

const clone = <T>(value: T): T => structuredClone(value);

interface StoredPerson {
  id: string;
  profileKey: string;
  dedupeKey: string;
  fullName: string;
  profession: string | null;
  roleTitle: string | null;
  organizationName: string | null;
  city: string | null;
  uf: UF | null;
  workEmail: string | null;
  sourceUrl: string;
  sourceQuote: string;
  verifiedAt: string;
  liaVersion: number | null;
  retentionUntil: string;
  optedOutAt: string | null;
}

interface StoredItem {
  id: string;
  researchId: string;
  kind: 'person' | 'organization';
  personId: string | null;
  organization: NewResearchOrganization | null;
  person: NewResearchPerson | null;
  dedupeKey: string;
  createdAt: string;
}

export interface MemoryResearchRepository extends ResearchRepository {
  people(): StoredPerson[];
  /** Simula o opt-out (o banco apaga os contatos e grava a supressão da identidade). */
  optOut(personId: string): void;
  suppress(kind: 'identity' | 'email' | 'phone', valueHash: string): void;
  /** Simula uma supressão do Relacionamento pelo domínio da organização. */
  suppressDomain(domain: string): void;
  /** Apaga a pessoa (prazo vencido ou eliminação): o item dela some junto. */
  erasePerson(personId: string): void;
  /** A próxima inclusão de pessoa falha como o gatilho da LIA (`person_lia_not_covering`). */
  failNextLia(): void;
}

/**
 * Pesquisas do Copiloto em memória: o mesmo comportamento observável do banco (migração
 * 20261127120000) — a pesquisa aberta entra na fila ao ser criada, ao concluir um lote, ao mudar e
 * ao reabrir; cancelar marca as tarefas; pessoa suprimida não entra; mesma pessoa no mesmo perfil
 * uma vez só; item repetido na mesma pesquisa é recusado.
 */
export function createMemoryResearchRepository(options: {
  audit: AuditRepository;
  clock?: Clock;
  newId?: () => string;
  jobs?: {
    enqueueJob(input: MemoryJobInput): void;
    cancelJobs(match: (job: { payload: Record<string, unknown> }) => boolean): void;
  };
}): MemoryResearchRepository {
  const clock = options.clock ?? systemClock;
  const newId = options.newId ?? (() => crypto.randomUUID());
  const now = () => clock.now().toISOString();
  const research = new Map<string, CopilotResearch>();
  const people = new Map<string, StoredPerson>();
  const items: StoredItem[] = [];
  const suppressions = new Set<string>();
  const domainSuppressions = new Set<string>();
  let peopleKeyCheck: string | null = null;
  let liaFailure = false;

  async function audited(audit: PendingAudit, id: string): Promise<void> {
    await options.audit.append({
      actorType: audit.actorType,
      actorLabel: audit.actorLabel,
      action: audit.action,
      entityType: audit.entityType,
      entityId: audit.entityId ?? id,
      diff: { ...audit.diff },
      traceId: audit.traceId,
    });
  }

  const OPEN = new Set(['queued', 'running']);

  function enqueueIfNeeded(before: CopilotResearch | null, after: CopilotResearch): void {
    if (!OPEN.has(after.status)) return;
    const batch = after.progress.batches;
    const changed =
      !before ||
      !OPEN.has(before.status) ||
      before.version !== after.version ||
      before.progress.batches !== batch;
    if (!changed) return;
    options.jobs?.enqueueJob({
      kind: 'copilot_research',
      idempotencyKey: `copilot_research:${after.id}:${after.version}:${batch}`,
      payload: { researchId: after.id, version: after.version, batch },
      traceId: after.traceId,
    });
  }

  function profileName(key: string): string {
    const profile = COMMERCIAL_PROFILES.find((item) => item.id === key);
    if (!profile) throw new AppError('not_found', 'not_found');
    return profile.name;
  }

  function view(item: StoredItem): ResearchItemView | null {
    if (item.kind === 'person') {
      const person = item.personId ? people.get(item.personId) : undefined;
      const meta = item.person;
      if (!person || !meta) return null;
      return {
        id: item.id,
        kind: 'person',
        personId: person.id,
        name: person.fullName,
        profession: person.profession,
        roleTitle: person.roleTitle,
        organization: person.organizationName,
        city: person.city,
        uf: person.uf,
        website: null,
        profileUrl: null,
        publicEmail: person.workEmail,
        publicPhone: null,
        sourceUrl: person.sourceUrl,
        sourceQuote: person.sourceQuote,
        verifiedAt: person.verifiedAt,
        audienceRole: meta.audienceRole,
        segment: meta.segment,
        fitReason: meta.fitReason,
        locationBasis: meta.locationBasis,
        queryIndex: meta.queryIndex,
        rank: meta.rank,
        liaVersion: person.liaVersion,
        approachable: person.liaVersion !== null && person.optedOutAt === null,
        optedOut: person.optedOutAt !== null,
        retentionUntil: person.retentionUntil,
      };
    }
    const org = item.organization;
    if (!org) return null;
    return {
      id: item.id,
      kind: 'organization',
      personId: null,
      name: org.name,
      profession: null,
      roleTitle: null,
      organization: null,
      city: org.city,
      uf: org.uf,
      website: org.website,
      profileUrl: null,
      publicEmail: org.publicEmail,
      publicPhone: org.publicPhone,
      sourceUrl: org.sourceUrl,
      sourceQuote: org.sourceQuote,
      verifiedAt: org.verifiedAt,
      audienceRole: org.audienceRole,
      segment: org.segment,
      fitReason: org.fitReason,
      locationBasis: org.locationBasis,
      queryIndex: org.queryIndex,
      rank: org.rank,
      liaVersion: null,
      approachable: true,
      optedOut: false,
      retentionUntil: org.retentionUntil,
    };
  }

  return {
    async create(input, audit) {
      const id = newId();
      const at = now();
      const stored = CopilotResearch.parse({
        id,
        threadId: input.threadId,
        profileKey: input.profileKey,
        profileName: profileName(input.profileKey),
        request: input.request,
        objective: input.objective,
        audience: input.audience,
        criteria: input.criteria,
        requestedCount: input.requestedCount,
        foundCount: 0,
        status: 'queued',
        stopReason: null,
        plan: input.plan,
        progress: ResearchProgress.parse({}),
        revisions: [],
        version: 1,
        rowVersion: 1,
        creditCap: input.creditCap,
        traceId: input.traceId,
        isDemo: input.isDemo ?? false,
        createdAt: at,
        updatedAt: at,
        finishedAt: null,
        retentionUntil: input.retentionUntil,
      });
      research.set(id, stored);
      await audited(audit, id);
      enqueueIfNeeded(null, stored);
      return clone(stored);
    },

    async get(id) {
      const stored = research.get(id);
      return stored ? clone(stored) : null;
    },

    async listForThread(threadId, limit) {
      return [...research.values()]
        .filter((item) => item.threadId === threadId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async listRecent(limit) {
      return [...research.values()]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit)
        .map(clone);
    },

    async countOpen() {
      return [...research.values()].filter((item) => OPEN.has(item.status)).length;
    },

    async update(expected, patch, audit) {
      const { id } = expected;
      const before = research.get(id);
      if (
        !before ||
        before.version !== expected.version ||
        before.rowVersion !== expected.rowVersion
      ) {
        return null;
      }
      const after = CopilotResearch.parse({
        ...before,
        ...(patch.criteria !== undefined ? { criteria: patch.criteria } : {}),
        ...(patch.requestedCount !== undefined ? { requestedCount: patch.requestedCount } : {}),
        ...(patch.foundCount !== undefined ? { foundCount: patch.foundCount } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.stopReason !== undefined ? { stopReason: patch.stopReason } : {}),
        ...(patch.plan !== undefined ? { plan: patch.plan } : {}),
        ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
        ...(patch.revisions !== undefined ? { revisions: patch.revisions } : {}),
        ...(patch.creditCap !== undefined ? { creditCap: patch.creditCap } : {}),
        ...(patch.finishedAt !== undefined ? { finishedAt: patch.finishedAt } : {}),
        version: patch.bumpVersion ? before.version + 1 : before.version,
        rowVersion: before.rowVersion + 1,
        updatedAt: now(),
      });
      const terminal = ['done', 'failed', 'cancelled'].includes(after.status);
      if (terminal !== (after.finishedAt !== null))
        throw new AppError('validation', 'invalid_input');
      research.set(id, after);
      await audited(audit, id);
      if (after.status === 'cancelled' && before.status !== 'cancelled') {
        options.jobs?.cancelJobs((job) => job.payload.researchId === id);
      }
      enqueueIfNeeded(before, after);
      return clone(after);
    },

    async itemKeys(researchId) {
      return new Set(
        items.filter((item) => item.researchId === researchId).map((item) => item.dedupeKey),
      );
    },

    async countItems(researchId) {
      return items.filter((item) => item.researchId === researchId && view(item) !== null).length;
    },

    async isSuppressed(probes) {
      return probes.some((probe) => suppressions.has(`${probe.kind}:${probe.valueHash}`));
    },

    async suppressedDomains(domains) {
      return new Set(domains.filter((domain) => domainSuppressions.has(domain)));
    },

    async ensurePeopleKeyCheck(check) {
      peopleKeyCheck ??= check;
      return peopleKeyCheck;
    },

    async optOutPerson({ personId, suppressions: extra }, audit) {
      const person = people.get(personId);
      if (!person) return false;
      if (!person.optedOutAt) {
        person.optedOutAt = now();
        person.workEmail = null;
        person.sourceQuote = person.fullName;
        suppressions.add(`identity:${person.dedupeKey}`);
      }
      for (const probe of extra) suppressions.add(`${probe.kind}:${probe.valueHash}`);
      await audited(audit, person.id);
      return true;
    },

    async addPerson(input, audit) {
      let person = [...people.values()].find(
        (item) => item.profileKey === input.profileKey && item.dedupeKey === input.dedupeKey,
      );
      if (person?.optedOutAt) return 'opted_out';
      if (!person) {
        if (suppressions.has(`identity:${input.dedupeKey}`)) {
          throw new AppError('conflict', 'person_suppressed');
        }
        if (liaFailure && input.liaVersion !== null) {
          liaFailure = false;
          throw new AppError('conflict', 'person_lia_not_covering');
        }
        if (!input.sourceQuote.toLowerCase().includes(input.fullName.toLowerCase())) {
          throw new AppError('validation', 'invalid_input');
        }
        person = {
          id: newId(),
          profileKey: input.profileKey,
          dedupeKey: input.dedupeKey,
          fullName: input.fullName,
          profession: input.profession,
          roleTitle: input.roleTitle,
          organizationName: input.organizationName,
          city: input.city,
          uf: input.uf,
          workEmail: input.workEmail,
          sourceUrl: input.sourceUrl,
          sourceQuote: input.sourceQuote,
          verifiedAt: input.verifiedAt,
          liaVersion: input.liaVersion,
          retentionUntil: input.retentionUntil,
          optedOutAt: null,
        };
        people.set(person.id, person);
        await audited(audit.person, person.id);
      }
      if (
        items.some(
          (item) => item.researchId === input.researchId && item.dedupeKey === input.dedupeKey,
        )
      ) {
        return 'duplicate';
      }
      const id = newId();
      items.push({
        id,
        researchId: input.researchId,
        kind: 'person',
        personId: person.id,
        organization: null,
        person: clone(input),
        dedupeKey: input.dedupeKey,
        createdAt: now(),
      });
      await audited(audit.item, id);
      return 'added';
    },

    async addOrganization(input, audit) {
      if (
        items.some(
          (item) => item.researchId === input.researchId && item.dedupeKey === input.dedupeKey,
        )
      ) {
        return 'duplicate';
      }
      if (input.sourceQuote.length > 300) throw new AppError('validation', 'invalid_input');
      const id = newId();
      items.push({
        id,
        researchId: input.researchId,
        kind: 'organization',
        personId: null,
        organization: clone(input),
        person: null,
        dedupeKey: input.dedupeKey,
        createdAt: now(),
      });
      await audited(audit, id);
      return 'added';
    },

    async listItems(researchId, { limit, offset }) {
      // Ordem de chegada (a gravação), não o `rank`: uma nova tentativa do lote não embaralha.
      return items
        .filter((item) => item.researchId === researchId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(view)
        .filter((item): item is ResearchItemView => item !== null)
        .slice(offset, offset + limit);
    },

    people() {
      return [...people.values()].map(clone);
    },

    optOut(personId) {
      const person = people.get(personId);
      if (!person || person.optedOutAt) return;
      person.optedOutAt = now();
      person.workEmail = null;
      person.sourceQuote = person.fullName;
      suppressions.add(`identity:${person.dedupeKey}`);
    },

    suppress(kind, valueHash) {
      suppressions.add(`${kind}:${valueHash}`);
    },

    suppressDomain(domain) {
      domainSuppressions.add(domain);
    },

    erasePerson(personId) {
      people.delete(personId);
    },

    failNextLia() {
      liaFailure = true;
    },
  };
}
