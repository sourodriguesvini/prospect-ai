import {
  CNPJ_LINK_MESSAGES,
  CNPJ_LOOKUP_MESSAGES,
  CNPJ_REFRESH_MESSAGES,
  CNPJ_PROVIDER_LABELS,
  COMPANY_CNPJ_KEY,
  ChangeLifecycleInput,
  Cnpj,
  CompanyInput,
  CompanyListFilter,
  LinkCompanyCnpjInput,
  Uuid,
  cnpjRecordUrl,
  formatCnpj,
  normalizeCnpj,
  type Claim,
  type ClaimEvidence,
  type ClaimStatus,
  type CnpjLookupFailure,
  type CnpjRegistryRecord,
  type Company,
  type CompanyIdentifier,
  type CompanyListFilterDraft,
  type ConfidenceBand,
  type LinkCompanyCnpjDraft,
  type Source,
  type SourceInputDraft,
} from '@prospector/contracts';
import {
  changedRegistryFacts,
  confidenceBand,
  effectiveStatus,
  findCnpjsInText,
  isIndividualBusiness,
  isIndividualFromFacts,
  linkedCnpjFromClaims,
  registryExcerpt,
  registryFacts,
  registryNameMatches,
  registryRetentionUntil,
  summarizeClaims,
  type ClaimSummary,
  type CnpjMention,
  type LinkedCnpj,
  type RegistryFact,
} from '@prospector/domain';
import { z } from 'zod';
import { systemClock, type Clock } from '../clock';
import type { RequestContext } from '../context';
import { AppError, parseInput } from '../errors';
import type { CnpjLookup } from '../ports/cnpj-lookup';
import type {
  CompanyRepository,
  EvidenceRepository,
  NewCompanyIdentifier,
} from '../ports/company-repository';
import type { EvidenceDraft, EvidenceService } from './evidence-service';
import { pendingAudit } from './pending-audit';

/** Evidência de um claim com a fonte, para o dossiê. */
export interface EvidenceView {
  evidence: ClaimEvidence;
  source: Source | null;
}

export interface ClaimView {
  claim: Claim;
  /** Estado lido agora (`active` vencido aparece como `stale`). */
  status: ClaimStatus;
  band: ConfidenceBand;
  evidence: EvidenceView[];
  dependsOn: string[];
}

export interface CompanyDossier {
  company: Company;
  identifiers: CompanyIdentifier[];
  /** Claims em vigor (sem os substituídos e rejeitados), por chave. */
  claims: ClaimView[];
  /** Versões anteriores guardadas (substituídas ou rejeitadas). */
  historyCount: number;
  summary: ClaimSummary;
  /**
   * MEI ou outra empresa de uma pessoa só, pelos fatos em vigor: a razão social no cadastro é o
   * nome da pessoa (dado pessoal; fica fora das evidências).
   */
  individual: boolean;
  /**
   * CNPJ vinculado depois do cadastro (lido no site ou informado por você), quando a coluna do
   * cadastro está vazia. null = sem CNPJ ou com o CNPJ no cadastro (`company.cnpj`).
   */
  linkedCnpj: LinkedCnpj | null;
  /** Instante da leitura (ISO), para a tela dizer "vencido" com a mesma referência. */
  readAt: string;
}

export type CnpjFailure = { failure: CnpjLookupFailure; message: string };

export type CnpjPreview =
  | { ok: true; record: CnpjRegistryRecord; existing: Company | null }
  | ({ ok: false } & CnpjFailure);

export type CreateCompanyResult =
  { status: 'created'; company: Company } | { status: 'duplicate'; company: Company };

export type ImportCompanyResult = CreateCompanyResult | ({ status: 'failed' } & CnpjFailure);

export type RefreshCompanyResult =
  | {
      status: 'updated';
      company: Company;
      claims: number;
      superseded: number;
      /** Fatos com valor diferente da versão anterior (inclui dado que sumiu). */
      changed: number;
    }
  | {
      /** Mesmo conteúdo da última consulta guardada: nada é gravado. */
      status: 'unchanged';
      company: Company;
      checkedAt: string;
      lastCapturedAt: string;
    }
  | ({ status: 'failed' } & CnpjFailure);

export type LinkCnpjResult =
  | { status: 'linked'; company: Company; cnpj: string; claims: number }
  /** Outra empresa já tem esse CNPJ no cadastro: nada é gravado. */
  | { status: 'duplicate'; company: Company }
  | ({ status: 'failed' } & CnpjFailure);

/** Página do site lida pela investigação, com o texto inteiro (só em memória). */
export interface SitePageText {
  url: string;
  title: string | null;
  text: string;
  fetchedAt: string;
  /** O site pediu para não guardar cópia: o texto não é lido para isso. */
  noArchive: boolean;
}

/** Por que o CNPJ do site não foi vinculado (a investigação só registra no log). */
export type SiteCnpjSkip =
  | 'has_cnpj'
  | 'archived'
  | 'lookup_off'
  | 'none_found'
  | 'third_party_only'
  | 'too_many'
  | 'lookup_failed'
  | 'no_match'
  | 'ambiguous'
  | 'duplicate';

export type SiteCnpjResult =
  | { status: 'linked'; cnpj: string; url: string; claimIds: string[] }
  | { status: 'skipped'; reason: SiteCnpjSkip };

/**
 * Mais que isso de CNPJs diferentes nas páginas (fora os de terceiros) é página de diretório ou
 * de marketplace: nada é consultado.
 */
const MAX_SITE_CNPJS = 3;

/** Cadastro pelo CNPJ: os erros caem nos campos `cnpj` e `displayName`. */
const ImportCompanyInput = z.object({
  cnpj: Cnpj,
  displayName: CompanyInput.shape.displayName.nullable().default(null),
});

/** Fatos do registro: chave do catálogo (docs/08) com prefixo `registry.`. */
const REGISTRY_KEY_PREFIX = 'registry.';

function failure(kind: CnpjLookupFailure): CnpjFailure {
  return { failure: kind, message: CNPJ_LOOKUP_MESSAGES[kind] };
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Domínio e perfis da empresa: fontes deles contam como `company_owned`. */
function ownedOrigins(company: Pick<Company, 'primaryDomain'>): string[] {
  return company.primaryDomain ? [company.primaryDomain] : [];
}

function identifiersFor(
  input: { cnpj: string | null; primaryDomain: string | null },
  verifiedCnpj: boolean,
): NewCompanyIdentifier[] {
  const keys: NewCompanyIdentifier[] = [];
  if (input.cnpj) {
    keys.push({
      kind: 'cnpj',
      valueNormalized: input.cnpj,
      strength: 'strong',
      verified: verifiedCnpj,
    });
    keys.push({
      kind: 'cnpj_root',
      valueNormalized: input.cnpj.slice(0, 8),
      strength: 'weak',
      verified: verifiedCnpj,
    });
  }
  if (input.primaryDomain) {
    keys.push({
      kind: 'domain',
      valueNormalized: input.primaryDomain,
      strength: 'strong',
      verified: false,
    });
  }
  return keys;
}

export interface CompanyService {
  list(ctx: RequestContext, filter?: CompanyListFilterDraft): Promise<Company[]>;
  /** AppError('not_found') se a empresa não existe. */
  dossier(ctx: RequestContext, id: string): Promise<CompanyDossier>;
  /** Cadastro manual; CNPJ ou domínio já cadastrado devolve a empresa existente. */
  create(ctx: RequestContext, raw: unknown): Promise<CreateCompanyResult>;
  /** Cadastro vindo da Descoberta ("Investigar"): igual ao manual, com origem `discovery`. */
  createFromDiscovery(
    ctx: RequestContext,
    raw: unknown,
    options?: { isDemo?: boolean },
  ): Promise<CreateCompanyResult>;
  /** Consulta o CNPJ sem gravar nada (prévia antes de importar). */
  lookupCnpj(ctx: RequestContext, cnpj: string): Promise<CnpjPreview>;
  /** Consulta o CNPJ e cria a empresa com os fatos do registro, tudo de uma vez. */
  importFromCnpj(
    ctx: RequestContext,
    input: { cnpj: string; displayName?: string | null },
  ): Promise<ImportCompanyResult>;
  /** Nova consulta do CNPJ de uma empresa: fatos novos substituem os anteriores da mesma chave. */
  refreshFromCnpj(ctx: RequestContext, companyId: string): Promise<RefreshCompanyResult>;
  /**
   * CNPJ informado no dossiê de uma empresa sem CNPJ: consulta a Receita, confere o nome e grava
   * o CNPJ como fato (fonte: anotação sua) junto com os fatos do registro. Nome da Receita
   * diferente sem `confirmName`: erro no campo `confirmName`, com os nomes, e nada é gravado.
   */
  linkCnpj(ctx: RequestContext, raw: LinkCompanyCnpjDraft): Promise<LinkCnpjResult>;
  /**
   * CNPJ publicado no site (investigação): procura nas páginas lidas, deixa de fora o de quem fez
   * o site, da hospedagem ou do pagamento, consulta cada candidato e só vincula se exatamente um
   * tiver o nome desta empresa na Receita. Nunca lança por falha da consulta.
   */
  linkCnpjFromSite(
    ctx: RequestContext,
    companyId: string,
    pages: readonly SitePageText[],
  ): Promise<SiteCnpjResult>;
  changeLifecycle(
    ctx: RequestContext,
    input: { companyId: string; lifecycle: string },
  ): Promise<Company>;
}

export function createCompanyService(deps: {
  companies: CompanyRepository;
  evidence: EvidenceRepository;
  evidenceService: EvidenceService;
  /** null = consulta de CNPJ indisponível (sem rede ou desligada). */
  cnpjLookup: CnpjLookup | null;
  clock?: Clock;
  newId?: () => string;
}): CompanyService {
  const clock = deps.clock ?? systemClock;
  const newId = deps.newId ?? (() => crypto.randomUUID());

  async function requireCompany(id: string): Promise<Company> {
    const parsed = Uuid.safeParse(id);
    const company = parsed.success ? await deps.companies.get(parsed.data) : null;
    if (!company) throw new AppError('not_found', 'not_found');
    return company;
  }

  /**
   * Chaves do CNPJ vinculado depois do cadastro (KI-160): a forte passa a valer na busca de
   * duplicadas, como a de quem já nasce com CNPJ. Devolve a outra empresa quando o CNPJ ficou com
   * ela entre a checagem e a gravação.
   */
  async function addLinkedCnpjKeys(
    ctx: RequestContext,
    companyId: string,
    cnpj: string,
    origin: 'user' | 'company_site',
  ): Promise<Company | null> {
    try {
      await deps.companies.addIdentifiers(
        companyId,
        identifiersFor({ cnpj, primaryDomain: null }, true),
        pendingAudit(ctx, {
          action: 'prospect.company.identifiers_added',
          entityType: 'company_identifier',
          diff: { companyId, origin, kinds: ['cnpj', 'cnpj_root'] },
        }),
      );
      return null;
    } catch (error) {
      if (!(error instanceof AppError) || error.reason !== 'company_duplicate') throw error;
      const other = await deps.companies.findByStrongIdentifier([{ kind: 'cnpj', value: cnpj }]);
      if (!other || other.id === companyId) throw error;
      return other;
    }
  }

  type Fetched = { record: CnpjRegistryRecord; fetchedAt: string; synthetic: boolean };

  /** Consulta o CNPJ; registro de outro CNPJ que não o pedido é resposta inválida. */
  async function lookup(cnpj: string, fresh = false): Promise<Fetched | CnpjFailure> {
    if (!deps.cnpjLookup) return failure('unavailable');
    const result = await deps.cnpjLookup.lookup(cnpj, fresh ? { fresh: true } : {});
    if (!result.ok) return failure(result.failure);
    if (normalizeCnpj(result.record.cnpj) !== normalizeCnpj(cnpj)) {
      return failure('invalid_response');
    }
    return {
      record: result.record,
      fetchedAt: result.fetchedAt,
      synthetic: result.synthetic === true,
    };
  }

  /** Fatos do registro em vigor (os da consulta anterior), por chave. */
  function registryInForce(current: readonly Claim[]): Claim[] {
    return current.filter(
      (claim) =>
        claim.status !== 'superseded' &&
        claim.status !== 'rejected' &&
        claim.key.startsWith(REGISTRY_KEY_PREFIX),
    );
  }

  /**
   * Fonte do registro e um fato por campo, cada um citando a sua linha do texto da fonte. A data
   * da coleta é a da resposta do provedor (não a do clique), e a fonte vale pelo prazo de guarda.
   */
  async function registryDraft(
    companyId: string,
    { record, fetchedAt, synthetic }: Fetched,
    inForce: readonly Claim[] = [],
  ): Promise<{ draft: EvidenceDraft; facts: RegistryFact[] }> {
    const excerpt = registryExcerpt(record);
    const sourceId = newId();
    const previous = new Map(inForce.map((claim) => [claim.key, claim.id]));
    const facts = registryFacts(record, { replacing: new Set(previous.keys()) });
    const draft: EvidenceDraft = {
      sources: [
        {
          id: sourceId,
          source: {
            schemaVersion: 1,
            kind: 'api_record',
            url: cnpjRecordUrl(record.provider, record.cnpj),
            provider: record.provider,
            externalRef: record.cnpj,
            capturedAt: fetchedAt,
            contentHash: await sha256(excerpt),
            mime: 'text/plain',
            httpStatus: 200,
            title: `Cadastro do CNPJ ${formatCnpj(record.cnpj)}`,
            excerptText: excerpt,
            licenseNote: `Dados abertos do CNPJ (Receita Federal, Decreto 8.777/2016), via ${CNPJ_PROVIDER_LABELS[record.provider]}.`,
            retentionUntil: registryRetentionUntil(fetchedAt),
            isDemo: synthetic,
          },
        },
      ],
      claims: facts.map((fact) => ({
        id: newId(),
        supersedes: previous.get(fact.key) ?? null,
        claim: {
          schemaVersion: 1,
          subjectType: 'company',
          subjectId: companyId,
          domain: fact.domain,
          key: fact.key,
          statement: fact.statement,
          value: { ...fact.value },
          epistemicType: 'fact',
          evidence: [{ sourceId, quote: fact.quote }],
          isDemo: synthetic,
        },
      })),
    };
    return { draft, facts };
  }

  /** Hash do texto da última fonte de registro que sustenta os fatos em vigor. */
  async function lastRegistrySource(
    inForce: readonly Claim[],
  ): Promise<{ contentHash: string | null; capturedAt: string } | null> {
    if (inForce.length === 0) return null;
    const evidence = await deps.evidence.evidenceFor(inForce.map((claim) => claim.id));
    const ids = [...new Set(evidence.map((item) => item.sourceId))];
    if (ids.length === 0) return null;
    const sources = (await deps.evidence.sourcesByIds(ids))
      .filter((source) => source.kind === 'api_record')
      .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const latest = sources[0];
    return latest ? { contentHash: latest.contentHash, capturedAt: latest.capturedAt } : null;
  }

  function registryPatch({ record, fetchedAt }: Fetched) {
    return {
      legalName: record.legalName,
      city: record.city,
      uf: record.uf,
      cnaeMain: record.cnaeMain?.code ?? null,
      sizeBand: record.size,
      lastInvestigatedAt: fetchedAt,
    };
  }

  type CnpjOrigin =
    | { kind: 'company_site'; url: string; title: string | null; quote: string; fetchedAt: string }
    | { kind: 'user' };

  /**
   * Fonte e fato do CNPJ vinculado depois do cadastro (`firmographic.cnpj`), mais a fonte e os
   * fatos da Receita, tudo no mesmo lote: o CNPJ só fica valendo junto com o registro que o
   * confirma. Substitui o CNPJ vinculado antes e os fatos do registro em vigor.
   */
  async function cnpjLinkDraft(
    company: Company,
    fetched: Fetched,
    origin: CnpjOrigin,
    current: readonly Claim[],
  ): Promise<EvidenceDraft> {
    const inForce = registryInForce(current);
    const { draft } = await registryDraft(company.id, fetched, inForce);
    const cnpj = normalizeCnpj(fetched.record.cnpj);
    const formatted = formatCnpj(cnpj);
    const isDemo = company.isDemo || fetched.synthetic;
    const now = clock.now().toISOString();
    const excerpt =
      origin.kind === 'company_site' ? origin.quote : `CNPJ informado por você: ${formatted}`;
    const source: SourceInputDraft =
      origin.kind === 'company_site'
        ? {
            schemaVersion: 1,
            kind: 'web_page',
            url: origin.url,
            provider: 'prospector',
            capturedAt: origin.fetchedAt,
            contentHash: await sha256(excerpt),
            title: origin.title ? origin.title.slice(0, 300) : null,
            excerptText: excerpt,
            licenseNote:
              'Página pública do site da empresa lida pela investigação; só o trecho com o CNPJ foi guardado.',
            retentionUntil: registryRetentionUntil(origin.fetchedAt),
            isDemo,
          }
        : {
            schemaVersion: 1,
            kind: 'user_note',
            externalRef: cnpj,
            capturedAt: now,
            contentHash: await sha256(excerpt),
            title: 'CNPJ informado por você',
            excerptText: excerpt,
            retentionUntil: registryRetentionUntil(now),
            isDemo,
          };
    let host: string | null = null;
    if (origin.kind === 'company_site') {
      try {
        host = new URL(origin.url).hostname.replace(/^www\./, '');
      } catch {
        host = null;
      }
    }
    const previous = linkedCnpjFromClaims(current);
    const sourceId = newId();
    return {
      sources: [{ id: sourceId, source }, ...(draft.sources ?? [])],
      claims: [
        {
          id: newId(),
          supersedes: previous?.claimId ?? null,
          claim: {
            schemaVersion: 1,
            subjectType: 'company',
            subjectId: company.id,
            domain: 'firmographic',
            key: COMPANY_CNPJ_KEY,
            statement:
              origin.kind === 'company_site'
                ? `CNPJ da empresa: ${formatted}, publicado no site${host ? ` ${host}` : ''}.`
                : `CNPJ da empresa: ${formatted}, informado por você.`,
            value: {
              cnpj,
              origin: origin.kind,
              url: origin.kind === 'company_site' ? origin.url : null,
            },
            epistemicType: 'fact',
            evidence: [{ sourceId, quote: excerpt }],
            isDemo,
          },
        },
        ...draft.claims,
      ],
    };
  }

  /** Nome da empresa na Receita para mostrar ao conferir (empresa individual: sem o da pessoa). */
  function registryNameLabel(record: CnpjRegistryRecord): string {
    if (isIndividualBusiness(record)) {
      return 'uma empresa individual (a razão social é o nome da pessoa titular)';
    }
    const names = [record.tradeName, record.legalName].filter(
      (name, index, all): name is string => Boolean(name) && all.indexOf(name) === index,
    );
    return names.map((name) => `"${name}"`).join(' / ');
  }

  async function createWithOrigin(
    ctx: RequestContext,
    raw: unknown,
    origin: 'manual' | 'discovery',
    isDemo = false,
  ): Promise<CreateCompanyResult> {
    const input = parseInput(CompanyInput, raw);
    const keys = identifiersFor(input, false);
    const existing = await deps.companies.findByStrongIdentifier(
      keys
        .filter((key) => key.strength === 'strong')
        .map((key) => ({ kind: key.kind, value: key.valueNormalized })),
    );
    if (existing) return { status: 'duplicate', company: existing };
    const company = await deps.companies.create(
      {
        id: newId(),
        displayName: input.displayName,
        legalName: null,
        cnpj: input.cnpj,
        primaryDomain: input.primaryDomain,
        city: input.city,
        uf: input.uf,
        cnaeMain: null,
        sizeBand: null,
        origin,
        lastInvestigatedAt: null,
        isDemo,
      },
      keys,
      { sources: [], claims: [], evidence: [] },
      pendingAudit(ctx, {
        action: 'prospect.company.created',
        entityType: 'company',
        diff: { origin },
      }),
    );
    return { status: 'created', company };
  }

  return {
    async list(_ctx, filter = {}) {
      return deps.companies.list(parseInput(CompanyListFilter, filter));
    },

    async dossier(_ctx, id) {
      const company = await requireCompany(id);
      const [identifiers, all] = await Promise.all([
        deps.companies.identifiers(company.id),
        deps.evidence.claimsFor('company', company.id, { includeSuperseded: true }),
      ]);
      const current = all.filter(
        (claim) => claim.status !== 'superseded' && claim.status !== 'rejected',
      );
      const ids = current.map((claim) => claim.id);
      const [evidence, dependencies] = await Promise.all([
        ids.length ? deps.evidence.evidenceFor(ids) : Promise.resolve([]),
        ids.length ? deps.evidence.dependenciesFor(ids) : Promise.resolve([]),
      ]);
      const sourceIds = [...new Set(evidence.map((item) => item.sourceId))];
      const sources = new Map(
        (sourceIds.length ? await deps.evidence.sourcesByIds(sourceIds) : []).map((source) => [
          source.id,
          source,
        ]),
      );
      const now = clock.now();
      const linkedCnpj = company.cnpj ? null : linkedCnpjFromClaims(current);
      return {
        // Sem CNPJ no cadastro, a raiz do vinculado vale para a supressão e a deduplicação (KI-160):
        // um "não contatar" pela raiz alcança também esta empresa, e o dela alcança as outras.
        company:
          linkedCnpj && !company.cnpjRoot
            ? { ...company, cnpjRoot: linkedCnpj.cnpj.slice(0, 8) }
            : company,
        identifiers,
        claims: current.map((claim) => ({
          claim,
          status: effectiveStatus(claim, now),
          band: confidenceBand(claim.confidence),
          evidence: evidence
            .filter((item) => item.claimId === claim.id)
            .map((item) => ({ evidence: item, source: sources.get(item.sourceId) ?? null })),
          dependsOn: dependencies
            .filter((item) => item.claimId === claim.id)
            .map((item) => item.dependsOnClaimId),
        })),
        historyCount: all.length - current.length,
        summary: summarizeClaims(current, now),
        individual: isIndividualFromFacts(
          current.filter((claim) => claim.key.startsWith(REGISTRY_KEY_PREFIX)),
        ),
        linkedCnpj,
        readAt: now.toISOString(),
      };
    },

    create: (ctx, raw) => createWithOrigin(ctx, raw, 'manual'),
    createFromDiscovery: (ctx, raw, options) =>
      createWithOrigin(ctx, raw, 'discovery', options?.isDemo ?? false),

    async lookupCnpj(_ctx, raw) {
      const cnpj = parseInput(Cnpj, raw);
      const [result, existing] = await Promise.all([
        lookup(cnpj),
        deps.companies.findByStrongIdentifier([{ kind: 'cnpj', value: cnpj }]),
      ]);
      if (!('record' in result)) return { ok: false, ...result };
      return { ok: true, record: result.record, existing };
    },

    async importFromCnpj(ctx, raw) {
      const { cnpj, displayName } = parseInput(ImportCompanyInput, {
        cnpj: raw.cnpj,
        displayName: raw.displayName?.trim() ? raw.displayName : null,
      });
      const existing = await deps.companies.findByStrongIdentifier([{ kind: 'cnpj', value: cnpj }]);
      if (existing) return { status: 'duplicate', company: existing };
      const result = await lookup(cnpj);
      if (!('record' in result)) return { status: 'failed', ...result };
      const { record } = result;

      const id = newId();
      const { draft } = await registryDraft(id, result);
      const batch = await deps.evidenceService.prepare({ companyId: id }, draft);
      const patch = registryPatch(result);
      const company = await deps.companies.create(
        {
          id,
          displayName: (displayName ?? record.tradeName ?? record.legalName).slice(0, 160),
          legalName: record.legalName,
          cnpj: record.cnpj,
          primaryDomain: null,
          city: patch.city,
          uf: patch.uf,
          cnaeMain: patch.cnaeMain,
          sizeBand: patch.sizeBand,
          origin: 'cnpj_lookup',
          lastInvestigatedAt: patch.lastInvestigatedAt,
          isDemo: result.synthetic,
        },
        identifiersFor({ cnpj: record.cnpj, primaryDomain: null }, true),
        { sources: batch.sources, claims: batch.claims, evidence: batch.evidence },
        pendingAudit(ctx, {
          action: 'prospect.company.created',
          entityType: 'company',
          diff: { origin: 'cnpj_lookup', provider: record.provider, claims: batch.claims.length },
        }),
      );
      return { status: 'created', company };
    },

    async refreshFromCnpj(ctx, companyId) {
      const company = await requireCompany(companyId);
      if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
      // Sem CNPJ no cadastro, vale o vinculado depois (lido no site ou informado por você).
      const cnpj =
        company.cnpj ??
        linkedCnpjFromClaims(await deps.evidence.claimsFor('company', company.id))?.cnpj ??
        null;
      if (!cnpj) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: { cnpj: ['Informe o CNPJ da empresa antes de consultar a Receita.'] },
        });
      }
      // Nova consulta pedida pelo usuário: sem cache, para a data da coleta ser verdadeira.
      const result = await lookup(cnpj, true);
      if (!('record' in result)) {
        return {
          status: 'failed',
          failure: result.failure,
          message: CNPJ_REFRESH_MESSAGES[result.failure],
        };
      }
      const inForce = registryInForce(await deps.evidence.claimsFor('company', company.id));
      const last = await lastRegistrySource(inForce);
      if (last && last.contentHash === (await sha256(registryExcerpt(result.record)))) {
        return {
          status: 'unchanged',
          company,
          checkedAt: result.fetchedAt,
          lastCapturedAt: last.capturedAt,
        };
      }
      const { draft, facts } = await registryDraft(company.id, result, inForce);
      const batch = await deps.evidenceService.record(ctx, company.id, draft, {
        action: 'prospect.company.registry_refreshed',
        patch: registryPatch(result),
        ownedOrigins: ownedOrigins(company),
      });
      return {
        status: 'updated',
        company: await requireCompany(company.id),
        claims: batch.claims.length,
        superseded: batch.supersede.length,
        changed: changedRegistryFacts(
          inForce.map((claim) => ({ key: claim.key, value: claim.value })),
          facts,
        ),
      };
    },

    async linkCnpj(ctx, raw) {
      const input = parseInput(LinkCompanyCnpjInput, raw);
      const company = await requireCompany(input.companyId);
      if (company.lifecycle === 'archived') throw new AppError('conflict', 'company_archived');
      if (company.cnpj) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: { cnpj: ['Esta empresa já tem CNPJ no cadastro.'] },
        });
      }
      const other = await deps.companies.findByStrongIdentifier([
        { kind: 'cnpj', value: input.cnpj },
      ]);
      if (other && other.id !== company.id) return { status: 'duplicate', company: other };
      const result = await lookup(input.cnpj);
      if (!('record' in result)) {
        return {
          status: 'failed',
          failure: result.failure,
          message: CNPJ_LINK_MESSAGES[result.failure],
        };
      }
      if (!input.confirmName && !registryNameMatches(company, result.record)) {
        throw new AppError('validation', 'invalid_input', {
          fieldErrors: {
            confirmName: [
              `Na Receita, esse CNPJ é de ${registryNameLabel(result.record)}, nome diferente de "${company.displayName}". Se for a mesma empresa, marque a confirmação e envie de novo.`,
            ],
          },
        });
      }
      const taken = await addLinkedCnpjKeys(ctx, company.id, input.cnpj, 'user');
      if (taken) return { status: 'duplicate', company: taken };
      const current = await deps.evidence.claimsFor('company', company.id);
      const draft = await cnpjLinkDraft(company, result, { kind: 'user' }, current);
      const batch = await deps.evidenceService.record(ctx, company.id, draft, {
        action: 'prospect.company.cnpj_linked',
        patch: registryPatch(result),
        ownedOrigins: ownedOrigins(company),
      });
      return {
        status: 'linked',
        company: await requireCompany(company.id),
        cnpj: normalizeCnpj(result.record.cnpj),
        claims: batch.claims.length,
      };
    },

    async linkCnpjFromSite(ctx, companyId, pages) {
      const company = await requireCompany(companyId);
      if (company.lifecycle === 'archived') return { status: 'skipped', reason: 'archived' };
      if (company.cnpj) return { status: 'skipped', reason: 'has_cnpj' };
      const current = await deps.evidence.claimsFor('company', company.id);
      if (linkedCnpjFromClaims(current)) return { status: 'skipped', reason: 'has_cnpj' };
      if (!deps.cnpjLookup) return { status: 'skipped', reason: 'lookup_off' };

      // O mesmo CNPJ em várias páginas: vale a primeira em que não aparece como de terceiro.
      const found = new Map<string, { mention: CnpjMention; page: SitePageText }>();
      for (const page of pages) {
        if (page.noArchive || !page.text) continue;
        for (const mention of findCnpjsInText(page.text)) {
          const seen = found.get(mention.cnpj);
          if (!seen || (seen.mention.thirdParty && !mention.thirdParty)) {
            found.set(mention.cnpj, { mention, page });
          }
        }
      }
      if (found.size === 0) return { status: 'skipped', reason: 'none_found' };
      const candidates = [...found.values()].filter((item) => !item.mention.thirdParty);
      if (candidates.length === 0) return { status: 'skipped', reason: 'third_party_only' };
      if (candidates.length > MAX_SITE_CNPJS) return { status: 'skipped', reason: 'too_many' };

      const matches: Array<{ fetched: Fetched; mention: CnpjMention; page: SitePageText }> = [];
      let answered = 0;
      for (const candidate of candidates) {
        const result = await lookup(candidate.mention.cnpj);
        if (!('record' in result)) continue;
        answered += 1;
        if (registryNameMatches(company, result.record)) {
          matches.push({ fetched: result, ...candidate });
        }
      }
      if (answered === 0) return { status: 'skipped', reason: 'lookup_failed' };
      const [match, ...others] = matches;
      if (!match) return { status: 'skipped', reason: 'no_match' };
      if (others.length > 0) return { status: 'skipped', reason: 'ambiguous' };
      const other = await deps.companies.findByStrongIdentifier([
        { kind: 'cnpj', value: match.mention.cnpj },
      ]);
      if (other && other.id !== company.id) return { status: 'skipped', reason: 'duplicate' };
      if (await addLinkedCnpjKeys(ctx, company.id, match.mention.cnpj, 'company_site')) {
        return { status: 'skipped', reason: 'duplicate' };
      }

      const draft = await cnpjLinkDraft(
        company,
        match.fetched,
        {
          kind: 'company_site',
          url: match.page.url,
          title: match.page.title,
          quote: match.mention.quote,
          fetchedAt: match.page.fetchedAt,
        },
        current,
      );
      const batch = await deps.evidenceService.record(ctx, company.id, draft, {
        action: 'prospect.company.cnpj_linked',
        patch: registryPatch(match.fetched),
        ownedOrigins: ownedOrigins(company),
      });
      return {
        status: 'linked',
        cnpj: match.mention.cnpj,
        url: match.page.url,
        claimIds: batch.claims.map((claim) => claim.id),
      };
    },

    async changeLifecycle(ctx, raw) {
      const input = parseInput(ChangeLifecycleInput, raw);
      const company = await requireCompany(input.companyId);
      if (company.lifecycle === input.lifecycle) return company;
      const changed = await deps.companies.setLifecycle(
        company.id,
        input.lifecycle,
        pendingAudit(ctx, {
          action: 'prospect.company.lifecycle_changed',
          entityType: 'company',
          entityId: company.id,
          diff: { from: company.lifecycle, to: input.lifecycle },
        }),
      );
      if (!changed) throw new AppError('not_found', 'not_found');
      return requireCompany(company.id);
    },
  };
}
