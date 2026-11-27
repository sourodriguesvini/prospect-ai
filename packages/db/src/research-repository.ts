import { AppError, type ResearchRepository } from '@prospector/application';
import {
  CopilotResearch,
  ResearchAudienceRole,
  ResearchCriteria,
  ResearchItemView,
  ResearchLocationBasis,
  ResearchPlan,
  ResearchProgress,
  ResearchRevision,
  ResearchSegment,
  ResearchStatus,
  ResearchStopReason,
} from '@prospector/contracts';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { toAppError } from './errors';
import { AUDIT_HEADER, encodeAuditHeader } from './strategy-repository';

interface DbError {
  message?: string | null;
  code?: string | null;
}

interface Result {
  data: unknown;
  error: DbError | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

const RESEARCH_SELECT =
  'id, thread_id, request, objective, audience, criteria, requested_count, found_count, status, stop_reason, plan, progress, revisions, version, row_version, credit_cap, trace_id, is_demo, created_at, updated_at, finished_at, retention_until, profile:commercial_profiles(key, name)';

const ResearchRow = z.object({
  id: z.string(),
  thread_id: z.string(),
  request: z.string(),
  objective: z.string(),
  audience: z.string(),
  criteria: ResearchCriteria,
  requested_count: z.number(),
  found_count: z.number(),
  status: ResearchStatus,
  stop_reason: ResearchStopReason.nullable(),
  plan: ResearchPlan,
  progress: ResearchProgress,
  revisions: z.array(ResearchRevision),
  version: z.number(),
  row_version: z.number(),
  credit_cap: z.number(),
  trace_id: z.string(),
  is_demo: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
  retention_until: z.string(),
  profile: z.object({ key: z.string(), name: z.string() }),
});

function mapResearch(raw: unknown): CopilotResearch {
  const row = ResearchRow.parse(raw);
  return CopilotResearch.parse({
    id: row.id,
    threadId: row.thread_id,
    profileKey: row.profile.key,
    profileName: row.profile.name,
    request: row.request,
    objective: row.objective,
    audience: row.audience,
    criteria: row.criteria,
    requestedCount: row.requested_count,
    foundCount: row.found_count,
    status: row.status,
    stopReason: row.stop_reason,
    plan: row.plan,
    progress: row.progress,
    revisions: row.revisions,
    version: row.version,
    rowVersion: row.row_version,
    creditCap: row.credit_cap,
    traceId: row.trace_id,
    isDemo: row.is_demo,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    finishedAt: row.finished_at,
    retentionUntil: row.retention_until,
  });
}

const ITEM_SELECT =
  'id, kind, person_id, name, city, uf, website, public_email, public_phone, source_url, source_quote, audience_role, segment, fit_reason, location_basis, query_index, rank, verified_at, retention_until, person:people(full_name, profession, role_title, organization_name, city, uf, work_email, work_phone, profile_url, source_url, source_quote, verified_at, lia_version, retention_until, opted_out_at)';

const ItemRow = z.object({
  id: z.string(),
  kind: z.enum(['person', 'organization']),
  person_id: z.string().nullable(),
  name: z.string().nullable(),
  city: z.string().nullable(),
  uf: z.string().nullable(),
  website: z.string().nullable(),
  public_email: z.string().nullable(),
  public_phone: z.string().nullable(),
  source_url: z.string().nullable(),
  source_quote: z.string().nullable(),
  audience_role: ResearchAudienceRole,
  segment: ResearchSegment,
  fit_reason: z.string(),
  location_basis: ResearchLocationBasis,
  query_index: z.number().nullable(),
  rank: z.number(),
  verified_at: z.string(),
  retention_until: z.string(),
  person: z
    .object({
      full_name: z.string(),
      profession: z.string().nullable(),
      role_title: z.string().nullable(),
      organization_name: z.string().nullable(),
      city: z.string().nullable(),
      uf: z.string().nullable(),
      work_email: z.string().nullable(),
      work_phone: z.string().nullable(),
      profile_url: z.string().nullable(),
      source_url: z.string(),
      source_quote: z.string(),
      verified_at: z.string(),
      lia_version: z.number().nullable(),
      retention_until: z.string(),
      opted_out_at: z.string().nullable(),
    })
    .nullable(),
});

function mapItem(raw: unknown): ResearchItemView | null {
  const row = ItemRow.parse(raw);
  const person = row.person;
  if (row.kind === 'person') {
    // Pessoa apagada (prazo, opt-out) leva o item junto; sem ela, nada a mostrar.
    if (!person) return null;
    return ResearchItemView.parse({
      id: row.id,
      kind: 'person',
      personId: row.person_id,
      name: person.full_name,
      profession: person.profession,
      roleTitle: person.role_title,
      organization: person.organization_name,
      city: person.city,
      uf: person.uf,
      website: null,
      profileUrl: person.profile_url,
      publicEmail: person.work_email,
      publicPhone: person.work_phone,
      sourceUrl: person.source_url,
      sourceQuote: person.source_quote,
      verifiedAt: person.verified_at,
      audienceRole: row.audience_role,
      segment: row.segment,
      fitReason: row.fit_reason,
      locationBasis: row.location_basis,
      queryIndex: row.query_index,
      rank: row.rank,
      liaVersion: person.lia_version,
      approachable: person.lia_version !== null && person.opted_out_at === null,
      optedOut: person.opted_out_at !== null,
      retentionUntil: person.retention_until,
    });
  }
  return ResearchItemView.parse({
    id: row.id,
    kind: 'organization',
    personId: null,
    name: row.name ?? '',
    profession: null,
    roleTitle: null,
    organization: null,
    city: row.city,
    uf: row.uf,
    website: row.website,
    profileUrl: null,
    publicEmail: row.public_email,
    publicPhone: row.public_phone,
    sourceUrl: row.source_url ?? '',
    sourceQuote: row.source_quote ?? '',
    verifiedAt: row.verified_at,
    audienceRole: row.audience_role,
    segment: row.segment,
    fitReason: row.fit_reason,
    locationBasis: row.location_basis,
    queryIndex: row.query_index,
    rank: row.rank,
    // Dado de organização não depende da LIA de pessoas; o serviço confere a supressão.
    liaVersion: null,
    approachable: true,
    optedOut: false,
    retentionUntil: row.retention_until,
  });
}

const IdRow = z.object({ id: z.string() });

/**
 * Pesquisas extensas do Copiloto via PostgREST (migração 20261127120000). O banco põe os lotes na
 * fila (gatilho), confere a LIA de cada pessoa, recusa pessoa suprimida e audita cada escrita
 * junto (cabeçalho `x-prospector-audit`).
 */
export function createSupabaseResearchRepository(client: SupabaseClient): ResearchRepository {
  let profiles: Map<string, string> | null = null;

  async function profileId(key: string): Promise<string> {
    if (!profiles) {
      const rows = z
        .array(z.object({ id: z.string(), key: z.string() }))
        .parse(await run(client.from('commercial_profiles').select('id, key')));
      profiles = new Map(rows.map((row) => [row.key, row.id]));
    }
    const id = profiles.get(key);
    if (!id) throw new AppError('not_found', 'not_found');
    return id;
  }

  async function personByKey(
    profile: string,
    dedupeKey: string,
  ): Promise<{ id: string; opted_out_at: string | null } | null> {
    const row = await run(
      client
        .from('people')
        .select('id, opted_out_at')
        .eq('profile_id', profile)
        .eq('dedupe_key', dedupeKey)
        .maybeSingle(),
    );
    return row
      ? z.object({ id: z.string(), opted_out_at: z.string().nullable() }).parse(row)
      : null;
  }

  return {
    async create(input, audit) {
      const row = await run(
        client
          .from('copilot_research')
          .insert({
            thread_id: input.threadId,
            profile_id: await profileId(input.profileKey),
            request: input.request,
            objective: input.objective,
            audience: input.audience,
            criteria: input.criteria,
            requested_count: input.requestedCount,
            plan: input.plan,
            credit_cap: input.creditCap,
            trace_id: input.traceId,
            retention_until: input.retentionUntil,
            is_demo: input.isDemo ?? false,
          })
          .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_research', audit))
          .select(RESEARCH_SELECT)
          .single(),
      );
      return mapResearch(row);
    },

    async get(id) {
      const row = await run(
        client.from('copilot_research').select(RESEARCH_SELECT).eq('id', id).maybeSingle(),
      );
      return row ? mapResearch(row) : null;
    },

    async listForThread(threadId, limit) {
      const rows = (await run(
        client
          .from('copilot_research')
          .select(RESEARCH_SELECT)
          .eq('thread_id', threadId)
          .order('created_at', { ascending: false })
          .limit(limit),
      )) as unknown[];
      return rows.map(mapResearch);
    },

    async listRecent(limit) {
      const rows = (await run(
        client
          .from('copilot_research')
          .select(RESEARCH_SELECT)
          .order('created_at', { ascending: false })
          .limit(limit),
      )) as unknown[];
      return rows.map(mapResearch);
    },

    async countOpen() {
      const { count, error } = await client
        .from('copilot_research')
        .select('id', { count: 'exact', head: true })
        .in('status', ['queued', 'running']);
      if (error) throw toAppError(error);
      return count ?? 0;
    },

    async update(expected, patch, audit) {
      const values: Record<string, unknown> = {};
      if (patch.criteria !== undefined) values.criteria = patch.criteria;
      if (patch.requestedCount !== undefined) values.requested_count = patch.requestedCount;
      if (patch.foundCount !== undefined) values.found_count = patch.foundCount;
      if (patch.status !== undefined) values.status = patch.status;
      if (patch.stopReason !== undefined) values.stop_reason = patch.stopReason;
      if (patch.plan !== undefined) values.plan = patch.plan;
      if (patch.progress !== undefined) values.progress = patch.progress;
      if (patch.revisions !== undefined) values.revisions = patch.revisions;
      if (patch.creditCap !== undefined) values.credit_cap = patch.creditCap;
      if (patch.finishedAt !== undefined) values.finished_at = patch.finishedAt;
      if (patch.bumpVersion) values.version = expected.version + 1;
      // `row_version` sobe no gatilho; conferir as duas evita que um lote e uma mudança
      // simultâneos apaguem um ao outro.
      const rows = (await run(
        client
          .from('copilot_research')
          .update(values)
          .eq('id', expected.id)
          .eq('version', expected.version)
          .eq('row_version', expected.rowVersion)
          .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_research', audit))
          .select(RESEARCH_SELECT),
      )) as unknown[];
      const [row] = rows;
      return row ? mapResearch(row) : null;
    },

    async itemKeys(researchId) {
      const rows = z
        .array(z.object({ dedupe_key: z.string() }))
        .parse(
          await run(
            client
              .from('copilot_research_items')
              .select('dedupe_key')
              .eq('research_id', researchId)
              .limit(1000),
          ),
        );
      return new Set(rows.map((row) => row.dedupe_key));
    },

    async countItems(researchId) {
      const { count, error } = await client
        .from('copilot_research_items')
        .select('id', { count: 'exact', head: true })
        .eq('research_id', researchId);
      if (error) throw toAppError(error);
      return count ?? 0;
    },

    async suppressedDomains(domains) {
      const wanted = [...new Set(domains.filter(Boolean))];
      if (wanted.length === 0) return new Set();
      const rows = z
        .array(z.object({ domain: z.string().nullable() }))
        .parse(
          await run(
            client
              .from('suppression_entries')
              .select('domain')
              .is('lifted_at', null)
              .in('domain', wanted),
          ),
        );
      return new Set(rows.flatMap((row) => (row.domain ? [row.domain] : [])));
    },

    async ensurePeopleKeyCheck(check) {
      const { error } = await client
        .from('people_key_checks')
        .upsert({ id: 1, value_hash: check }, { onConflict: 'id', ignoreDuplicates: true });
      if (error) throw toAppError(error);
      const row = z
        .object({ value_hash: z.string() })
        .parse(
          await run(client.from('people_key_checks').select('value_hash').eq('id', 1).single()),
        );
      return row.value_hash;
    },

    async optOutPerson({ personId, suppressions }, audit) {
      const found = await run(
        client.from('people').select('full_name, opted_out_at').eq('id', personId).maybeSingle(),
      );
      if (!found) return false;
      const person = z
        .object({ full_name: z.string(), opted_out_at: z.string().nullable() })
        .parse(found);
      if (!person.opted_out_at) {
        // O gatilho grava a identidade na supressão e marca as linhas da mesma pessoa nos outros
        // perfis; o trecho fica só com o nome (o banco exige o nome no trecho).
        await run(
          client
            .from('people')
            .update({
              opted_out_at: new Date().toISOString(),
              work_email: null,
              work_phone: null,
              profile_url: null,
              source_quote: person.full_name,
            })
            .eq('id', personId)
            .is('opted_out_at', null)
            .setHeader(AUDIT_HEADER, encodeAuditHeader('people', audit, ['person_suppressions'])),
        );
      }
      if (suppressions.length > 0) {
        await run(
          client
            .from('person_suppressions')
            .upsert(
              suppressions.map((probe) => ({
                kind: probe.kind,
                value_hash: probe.valueHash,
                reason: 'opt_out',
              })),
              { onConflict: 'kind,value_hash', ignoreDuplicates: true },
            )
            .setHeader(AUDIT_HEADER, encodeAuditHeader('person_suppressions', audit)),
        );
      }
      return true;
    },

    async isSuppressed(probes) {
      if (probes.length === 0) return false;
      const rows = z.array(z.object({ kind: z.string(), value_hash: z.string() })).parse(
        await run(
          client
            .from('person_suppressions')
            .select('kind, value_hash')
            .in(
              'value_hash',
              probes.map((probe) => probe.valueHash),
            ),
        ),
      );
      return probes.some((probe) =>
        rows.some((row) => row.kind === probe.kind && row.value_hash === probe.valueHash),
      );
    },

    async addPerson(input, audit) {
      const profile = await profileId(input.profileKey);
      let person = await personByKey(profile, input.dedupeKey);
      if (person?.opted_out_at) return 'opted_out';
      if (!person) {
        const { data, error } = await client
          .from('people')
          .insert({
            profile_id: profile,
            full_name: input.fullName,
            profession: input.profession,
            role_title: input.roleTitle,
            organization_name: input.organizationName,
            city: input.city,
            uf: input.uf,
            work_email: input.workEmail,
            audience_role: input.audienceRole,
            source_url: input.sourceUrl,
            source_kind: input.sourceKind,
            source_quote: input.sourceQuote,
            verified_at: input.verifiedAt,
            lia_version: input.liaVersion,
            retention_until: input.retentionUntil,
            dedupe_key: input.dedupeKey,
          })
          .setHeader(AUDIT_HEADER, encodeAuditHeader('people', audit.person))
          .select('id')
          .single();
        if (error) {
          // Outra pesquisa gravou a mesma pessoa ao mesmo tempo: usa a linha dela.
          if (error.code !== '23505') throw toAppError(error);
          person = await personByKey(profile, input.dedupeKey);
          if (!person) throw toAppError(error);
          if (person.opted_out_at) return 'opted_out';
        } else {
          person = { id: IdRow.parse(data).id, opted_out_at: null };
        }
      }
      const { error } = await client
        .from('copilot_research_items')
        .insert({
          research_id: input.researchId,
          kind: 'person',
          person_id: person.id,
          audience_role: input.audienceRole,
          segment: input.segment,
          fit_reason: input.fitReason,
          location_basis: input.locationBasis,
          query_index: input.queryIndex,
          rank: input.rank,
          verified_at: input.verifiedAt,
          retention_until: input.itemRetentionUntil,
          dedupe_key: input.dedupeKey,
        })
        .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_research_items', audit.item));
      if (error) {
        if (error.code === '23505') return 'duplicate';
        throw toAppError(error);
      }
      return 'added';
    },

    async addOrganization(input, audit) {
      const { error } = await client
        .from('copilot_research_items')
        .insert({
          research_id: input.researchId,
          kind: 'organization',
          name: input.name,
          city: input.city,
          uf: input.uf,
          website: input.website,
          public_email: input.publicEmail,
          public_phone: input.publicPhone,
          source_url: input.sourceUrl,
          source_quote: input.sourceQuote,
          audience_role: input.audienceRole,
          segment: input.segment,
          fit_reason: input.fitReason,
          location_basis: input.locationBasis,
          query_index: input.queryIndex,
          rank: input.rank,
          verified_at: input.verifiedAt,
          retention_until: input.retentionUntil,
          dedupe_key: input.dedupeKey,
        })
        .setHeader(AUDIT_HEADER, encodeAuditHeader('copilot_research_items', audit));
      if (error) {
        if (error.code === '23505') return 'duplicate';
        throw toAppError(error);
      }
      return 'added';
    },

    async listItems(researchId, options) {
      const rows = (await run(
        client
          .from('copilot_research_items')
          .select(ITEM_SELECT)
          .eq('research_id', researchId)
          // Ordem de chegada (a gravação), não o `rank`: uma nova tentativa do lote não embaralha.
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(options.offset, options.offset + options.limit - 1),
      )) as unknown[];
      return rows.map(mapItem).filter((item): item is ResearchItemView => item !== null);
    },
  };
}
