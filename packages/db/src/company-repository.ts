import { AppError, type CompanyRepository, type EvidenceRepository } from '@prospector/application';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  CLAIM_SELECT,
  COMPANY_SELECT,
  DEPENDENCY_SELECT,
  EVIDENCE_SELECT,
  IDENTIFIER_SELECT,
  SOURCE_SELECT,
  batchColumns,
  companyColumns,
  companyPatchColumns,
  identifierColumns,
  mapClaim,
  mapCompany,
  mapDependency,
  mapEvidence,
  mapIdentifier,
  mapSource,
} from './company-rows';
import { toAppError } from './errors';
import { AUDIT_HEADER, encodeAuditHeader } from './strategy-repository';

interface Result {
  data: unknown;
  error: { message?: string | null; code?: string | null } | null;
}

async function run(query: PromiseLike<Result>): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw toAppError(error);
  return data;
}

async function rows(query: PromiseLike<Result>): Promise<unknown[]> {
  return ((await run(query)) as unknown[] | null) ?? [];
}

/** Lotes de ids no filtro `in` (a URL do PostgREST tem limite). */
const IN_CHUNK = 100;

function chunks<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += IN_CHUNK) {
    out.push(items.slice(index, index + IN_CHUNK));
  }
  return out;
}

/**
 * Termo de busca no mesmo formato da coluna `companies.search_text`: minúsculas, sem acento. CNPJ
 * digitado com pontuação vira só os caracteres. Curingas do LIKE e do PostgREST (`%`, `_`, `*`) e
 * vírgulas/parênteses saem: a busca é por trecho, nunca por padrão.
 */
export function searchTerm(search: string): string {
  const trimmed = search.trim();
  const cnpjLike =
    /^[0-9A-Za-z./\-\s]+$/.test(trimmed) && /\d/.test(trimmed) && /[./-]/.test(trimmed);
  const base = cnpjLike ? trimmed.replace(/[.\-/\s]/g, '') : trimmed;
  return base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[%_*\\,()"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Empresas e Evidence Ledger via PostgREST (M2). Criação e lotes do ledger passam pelas RPCs
 * `create_company` e `record_evidence` (atômicas); a auditoria vai no cabeçalho, registrada em
 * `companies` e cobrindo as demais tabelas gravadas no mesmo pedido (ADR-0010).
 */
export function createSupabaseCompanyRepository(
  client: SupabaseClient,
): CompanyRepository & EvidenceRepository {
  async function companyById(id: string) {
    const data = await run(
      client.from('companies').select(COMPANY_SELECT).eq('id', id).maybeSingle(),
    );
    return data ? mapCompany(data) : null;
  }

  async function inChunks(
    table: string,
    select: string,
    column: string,
    ids: readonly string[],
  ): Promise<unknown[]> {
    const unique = [...new Set(ids)];
    const parts = await Promise.all(
      chunks(unique).map((part) => rows(client.from(table).select(select).in(column, part))),
    );
    return parts.flat();
  }

  return {
    async list(filter) {
      let query = client
        .from('companies')
        .select(COMPANY_SELECT)
        .order('updated_at', { ascending: false })
        .limit(filter.limit);
      if (filter.lifecycle) query = query.eq('lifecycle', filter.lifecycle);
      else if (!filter.includeArchived) query = query.neq('lifecycle', 'archived');
      const term = searchTerm(filter.search);
      if (term) query = query.ilike('search_text', `%${term}%`);
      return (await rows(query)).map(mapCompany);
    },

    get: companyById,

    async findByStrongIdentifier(keys) {
      for (const key of keys) {
        const found = (await rows(
          client
            .from('company_identifiers')
            .select('company_id')
            .eq('kind', key.kind)
            .eq('value_normalized', key.value)
            .eq('strength', 'strong')
            .limit(1),
        )) as Array<{ company_id?: unknown }>;
        const companyId = found[0]?.company_id;
        if (typeof companyId === 'string') return companyById(companyId);
      }
      return null;
    },

    async identifiers(companyId) {
      return (
        await rows(
          client
            .from('company_identifiers')
            .select(IDENTIFIER_SELECT)
            .eq('company_id', companyId)
            .order('created_at'),
        )
      ).map(mapIdentifier);
    },

    async create(company, identifiers, batch, audit) {
      const id = await run(
        client
          .rpc('create_company', {
            p_company: companyColumns(company),
            p_identifiers: identifiers.map(identifierColumns),
            ...batchColumns(batch),
          })
          .setHeader(
            AUDIT_HEADER,
            encodeAuditHeader('companies', audit, [
              'company_identifiers',
              'sources',
              'claims',
              'claim_evidence',
            ]),
          ),
      );
      const created = typeof id === 'string' ? await companyById(id) : null;
      if (!created) throw new AppError('unexpected', 'unexpected');
      return created;
    },

    async setLifecycle(id, lifecycle, audit) {
      const updated = await rows(
        client
          .from('companies')
          .update({ lifecycle })
          .eq('id', id)
          .select('id')
          .setHeader(AUDIT_HEADER, encodeAuditHeader('companies', audit)),
      );
      return updated.length > 0;
    },

    async record(companyId, patch, batch, audit) {
      await run(
        client
          .rpc('record_evidence', {
            p_company_id: companyId,
            p_company_patch: companyPatchColumns(patch),
            ...batchColumns(batch),
          })
          .setHeader(
            AUDIT_HEADER,
            encodeAuditHeader('companies', audit, [
              'sources',
              'claims',
              'claim_evidence',
              'claim_dependencies',
            ]),
          ),
      );
    },

    async claimsFor(subjectType, subjectId, options = {}) {
      let query = client
        .from('claims')
        .select(CLAIM_SELECT)
        .eq('subject_type', subjectType)
        .eq('subject_id', subjectId)
        .order('created_at', { ascending: false })
        .limit(1000);
      if (!options.includeSuperseded) query = query.neq('status', 'superseded');
      return (await rows(query)).map(mapClaim);
    },

    async claimsByIds(ids) {
      return (await inChunks('claims', CLAIM_SELECT, 'id', ids)).map(mapClaim);
    },

    async evidenceFor(claimIds) {
      return (await inChunks('claim_evidence', EVIDENCE_SELECT, 'claim_id', claimIds)).map(
        mapEvidence,
      );
    },

    async sourcesByIds(ids) {
      return (await inChunks('sources', SOURCE_SELECT, 'id', ids)).map(mapSource);
    },

    async dependenciesFor(claimIds) {
      return (await inChunks('claim_dependencies', DEPENDENCY_SELECT, 'claim_id', claimIds)).map(
        mapDependency,
      );
    },
  };
}
