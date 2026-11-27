import type {
  CopilotResearch,
  ResearchAudienceRole,
  ResearchCriteria,
  ResearchItemView,
  ResearchLocationBasis,
  ResearchPlan,
  ResearchProgress,
  ResearchRevision,
  ResearchSegment,
  ResearchSourceKind,
  ResearchStatus,
  ResearchStopReason,
  UF,
} from '@prospector/contracts';
import type { PendingAudit } from './audit-repository';

/** Pesquisa nova (status `queued`): o banco a põe na fila na mesma escrita. */
export interface NewResearch {
  threadId: string;
  /** Chave do perfil comercial (`found-studio`, `blummy`). */
  profileKey: string;
  request: string;
  objective: string;
  audience: string;
  criteria: ResearchCriteria;
  requestedCount: number;
  plan: ResearchPlan;
  creditCap: number;
  traceId: string;
  retentionUntil: string;
  /** Pesquisa de demonstração (buscador sintético, só no modo memória): selo DEMO na tela. */
  isDemo?: boolean;
}

/** Campos que mudam depois de criada (os demais são fixos). */
export interface ResearchPatch {
  criteria?: ResearchCriteria;
  requestedCount?: number;
  foundCount?: number;
  status?: ResearchStatus;
  stopReason?: ResearchStopReason | null;
  plan?: ResearchPlan;
  progress?: ResearchProgress;
  revisions?: ResearchRevision[];
  creditCap?: number;
  finishedAt?: string | null;
  /** Mudança pedida pela pessoa: a versão sobe (o banco põe o lote seguinte na fila). */
  bumpVersion?: boolean;
}

/** Pessoa achada por uma pesquisa: vai para `people` (origem, base legal, prazo, opt-out). */
export interface NewResearchPerson {
  researchId: string;
  profileKey: string;
  /** HMAC da identidade (nome + UF + profissão ou organização), sem o perfil. */
  dedupeKey: string;
  fullName: string;
  profession: string | null;
  roleTitle: string | null;
  organizationName: string | null;
  city: string | null;
  uf: UF | null;
  /** Só caixa profissional literal na fonte (nunca deduzida). */
  workEmail: string | null;
  sourceUrl: string;
  sourceKind: ResearchSourceKind;
  sourceQuote: string;
  audienceRole: ResearchAudienceRole;
  verifiedAt: string;
  /** Versão da LIA que cobre a linha; null = guardada sem base para abordagem (90 dias). */
  liaVersion: number | null;
  retentionUntil: string;
  // Item da pesquisa
  segment: ResearchSegment;
  fitReason: string;
  locationBasis: ResearchLocationBasis;
  queryIndex: number | null;
  rank: number;
  itemRetentionUntil: string;
}

/**
 * - `added`: entrou nesta pesquisa (a pessoa pode já existir no perfil: o item aponta para ela);
 * - `duplicate`: já estava nesta pesquisa;
 * - `opted_out`: a pessoa existente pediu para não ser contatada (não entra em lista nenhuma).
 */
export type AddPersonResult = 'added' | 'duplicate' | 'opted_out';

/** Organização achada (clínica, consultório): os dados ficam no próprio item. */
export interface NewResearchOrganization {
  researchId: string;
  /** SHA-256 da identidade da organização (nome + UF). */
  dedupeKey: string;
  name: string;
  city: string | null;
  uf: UF | null;
  website: string | null;
  publicEmail: string | null;
  publicPhone: string | null;
  sourceUrl: string;
  sourceQuote: string;
  audienceRole: ResearchAudienceRole;
  segment: ResearchSegment;
  fitReason: string;
  locationBasis: ResearchLocationBasis;
  queryIndex: number | null;
  rank: number;
  verifiedAt: string;
  retentionUntil: string;
}

export interface SuppressionProbe {
  kind: 'identity' | 'email' | 'phone';
  valueHash: string;
}

/** O que a gravação confere antes de mudar a pesquisa (concorrência otimista). */
export type ResearchExpected = Pick<CopilotResearch, 'id' | 'version' | 'rowVersion'>;

/**
 * Opt-out de uma pessoa achada (regra 7): a marca é final, os meios de contato somem, o trecho
 * guardado fica só com o nome e a identidade (com as variações) entra na supressão.
 */
export interface PersonOptOut {
  personId: string;
  /** Hashes extras (variações da identidade, e-mail) que também passam a suprimir. */
  suppressions: SuppressionProbe[];
}

/**
 * Pesquisas extensas do Copiloto (migração `20261127120000_copilot_research`). Toda escrita é
 * auditada junto (ADR-0010). Erros: AppError do repositório (`person_suppressed` quando a
 * identidade foi suprimida entre a conferência e a escrita; `person_lia_not_covering` quando a LIA
 * informada não cobre a linha).
 */
export interface ResearchRepository {
  create(input: NewResearch, audit: PendingAudit): Promise<CopilotResearch>;
  get(id: string): Promise<CopilotResearch | null>;
  /** Mais recentes primeiro. */
  listForThread(threadId: string, limit: number): Promise<CopilotResearch[]>;
  listRecent(limit: number): Promise<CopilotResearch[]>;
  /** Quantas estão na fila ou rodando (limite de pesquisas abertas). */
  countOpen(): Promise<number>;
  /**
   * Grava se a pesquisa ainda estiver como foi lida (`version` e `rowVersion`); null = outra
   * gravação chegou antes (ou a pesquisa não existe mais). Toda gravação sobe `rowVersion`.
   */
  update(
    expected: ResearchExpected,
    patch: ResearchPatch,
    audit: PendingAudit,
  ): Promise<CopilotResearch | null>;
  /** Chaves de deduplicação já presentes nesta pesquisa. */
  itemKeys(researchId: string): Promise<Set<string>>;
  /** Quantos itens a pesquisa tem agora (pessoa apagada por prazo ou opt-out sai da conta). */
  countItems(researchId: string): Promise<number>;
  /** Algum dos valores está na lista de supressão de pessoas? */
  isSuppressed(probes: readonly SuppressionProbe[]): Promise<boolean>;
  /**
   * Domínios (site, e-mail de organização) com supressão em vigor no Relacionamento
   * (`suppression_entries`): a organização pediu para não ser contatada.
   */
  suppressedDomains(domains: readonly string[]): Promise<Set<string>>;
  /**
   * Impressão da chave das pessoas (HMAC de um texto fixo): grava a primeira e devolve a que está
   * no banco. Diferente da deste computador = chave trocada; nada de pessoa é gravado.
   */
  ensurePeopleKeyCheck(check: string): Promise<string>;
  /** Registra o opt-out; devolve false se a pessoa não existe mais (apagada). */
  optOutPerson(input: PersonOptOut, audit: PendingAudit): Promise<boolean>;
  addPerson(
    input: NewResearchPerson,
    audit: { person: PendingAudit; item: PendingAudit },
  ): Promise<AddPersonResult>;
  addOrganization(
    input: NewResearchOrganization,
    audit: PendingAudit,
  ): Promise<'added' | 'duplicate'>;
  /** Na ordem de chegada. Pessoa apagada (prazo, opt-out) some junto. */
  listItems(
    researchId: string,
    options: { limit: number; offset: number },
  ): Promise<ResearchItemView[]>;
}
