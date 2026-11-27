import {
  BUSINESS_EVENT_LABELS,
  COMPATIBILITY_VERSION,
  FUNDING_MODALITY_LABELS,
  type BusinessEventType,
  type CommercialProblem,
  type CommercialProfile,
  type CommercialSignal,
  type CommercialSolution,
  type CommercialThesis,
  type QualitativeLevel,
  type SiteSignal,
  type ThesisAngle,
  type ThesisDimension,
  type ThesisRecommendation,
} from '@prospector/contracts';
import { formatBrlAmount, SIGNAL_STRENGTH } from './events';
import { capabilityIndex } from './profiles';
import { brazilianPartialDate, fold } from './text';
import type { EventEvidence } from './timeline';

/**
 * Motor de compatibilidade (diretriz 2026-11-26, Parte 4): sinais → problemas → capacidades →
 * soluções → tese. Regra pura e explicável: cada dimensão tem faixa qualitativa, motivo e os
 * claims que a sustentam; a IA só escreve a narrativa por cima (doc 15 §7.2).
 *
 * Proteções dos casos obrigatórios (Parte 8):
 * - medição do site nunca vira o ângulo principal quando há acontecimento empresarial (Caso 1);
 * - só medição do site → "não priorizar" (Caso 4);
 * - investimento nunca é orçamento: a finalidade fica "não documentada" quando a fonte não diz.
 */

export interface SiteSignalEvidence {
  readonly signal: SiteSignal;
  readonly claimIds: readonly string[];
  /** Resumo curto da medição ("24 de 139 textos com contraste baixo"). */
  readonly detail: string;
}

export interface ThesisInput {
  readonly profile: CommercialProfile;
  readonly companyName: string;
  readonly events: readonly EventEvidence[];
  readonly siteSignals: readonly SiteSignalEvidence[];
  /** Há canal de contato registrado (claims de contato). */
  readonly contactKnown: boolean;
  readonly now: Date;
}

const RECENT_DAYS = 180;
const OLD_DAYS = 540;
const DAY_MS = 86_400_000;
const SITE_SIGNALS: ReadonlySet<CommercialSignal> = new Set([
  'site_accessibility',
  'site_mobile',
  'site_inconsistency',
]);

function ageDays(date: string | null, now: Date): number | null {
  if (!date) return null;
  const [year, month = '06', day = '15'] = date.split('-');
  const time = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(time) ? Math.max(0, Math.floor((now.getTime() - time) / DAY_MS)) : null;
}

function recencyFactor(days: number | null): number {
  if (days === null) return 0.8;
  if (days <= RECENT_DAYS) return 1;
  if (days <= OLD_DAYS) return 0.75;
  return 0.4;
}

/** Força da evidência de um acontecimento: página lida, fonte, confirmação e tipo do claim. */
function evidenceFactor(item: EventEvidence): number {
  const { event } = item;
  let factor = event.pageRead ? 1 : 0.7;
  if (event.sourceTier === 'other') factor *= 0.85;
  if (event.confirmedBy.length > 0) factor *= 1.1;
  if (item.epistemicType === 'hypothesis') factor *= 0.8;
  return factor;
}

interface Support {
  readonly signal: CommercialSignal;
  readonly weight: number;
  readonly claimIds: readonly string[];
  readonly event: EventEvidence | null;
  readonly site: SiteSignalEvidence | null;
}

interface RankedProblem {
  readonly problem: CommercialProblem;
  readonly solution: CommercialSolution | null;
  readonly supports: readonly Support[];
  readonly score: number;
  readonly siteOnly: boolean;
}

/** O acontecimento cita a área do problema (título ou finalidade declarada)? */
function mentionsArea(item: EventEvidence, problem: CommercialProblem): boolean {
  const purpose =
    item.event.funding?.purpose.status === 'declared' ? item.event.funding.purpose.value.text : '';
  const words = ` ${fold(`${item.event.headline} ${purpose}`).replace(/[^a-z0-9]+/g, ' ')} `;
  return problem.terms.some((term) =>
    words.includes(` ${fold(term).replace(/[^a-z0-9]+/g, ' ')} `),
  );
}

function supportsFor(problem: CommercialProblem, input: ThesisInput): Support[] {
  const out: Support[] = [];
  problem.signals.forEach((signal, position) => {
    const order = 1 / (1 + position * 0.25);
    if (SITE_SIGNALS.has(signal)) {
      for (const site of input.siteSignals.filter((item) => item.signal === signal)) {
        out.push({
          signal,
          weight: SIGNAL_STRENGTH[signal] * order,
          claimIds: site.claimIds,
          event: null,
          site,
        });
      }
      return;
    }
    for (const item of input.events.filter((evidence) => evidence.event.type === signal)) {
      const weight =
        SIGNAL_STRENGTH[signal] *
        order *
        recencyFactor(ageDays(item.event.occurredOn, input.now)) *
        evidenceFactor(item) *
        (mentionsArea(item, problem) ? 1.5 : 1);
      out.push({ signal, weight, claimIds: [item.claimId], event: item, site: null });
    }
  });
  return out.sort((a, b) => b.weight - a.weight);
}

function rankProblems(input: ThesisInput): RankedProblem[] {
  const businessEvents = input.events.filter(
    (item) => SIGNAL_STRENGTH[item.event.type] >= 1.5,
  ).length;
  return (
    input.profile.problems
      .map((problem) => {
        const supports = supportsFor(problem, input);
        const siteOnly = supports.length > 0 && supports.every((support) => support.site !== null);
        // Soma com retorno decrescente: o segundo sinal soma metade, o terceiro um terço…
        const score = supports.reduce(
          (sum, support, index) => sum + support.weight / (index + 1),
          0,
        );
        const solution =
          input.profile.solutions.find((item) => item.problemIds.includes(problem.id)) ?? null;
        return { problem, solution, supports, score, siteOnly };
      })
      .filter((item) => item.supports.length > 0)
      // Caso 1: havendo acontecimento empresarial, medição do site não disputa o ângulo.
      .filter((item) => !(item.siteOnly && businessEvents > 0))
      .sort((a, b) => b.score - a.score)
  );
}

function serviceNames(profile: CommercialProfile, ranked: RankedProblem): string[] {
  const ids = ranked.solution?.serviceIds ?? [];
  const names = ids
    .map((id) => profile.services.find((service) => service.id === id)?.name)
    .filter((name): name is string => typeof name === 'string');
  if (names.length > 0) return names;
  const caps = new Set(ranked.problem.capabilityIds);
  return profile.services
    .filter((service) => service.capabilityIds.some((id) => caps.has(id)))
    .map((service) => service.name)
    .slice(0, 4);
}

/** Capacidades efetivamente usadas pelo ângulo (as da solução ou, sem ela, as do problema). */
function capabilityIdsOf(profile: CommercialProfile, ranked: RankedProblem): string[] {
  const fromServices = (ranked.solution?.serviceIds ?? []).flatMap(
    (id) => profile.services.find((service) => service.id === id)?.capabilityIds ?? [],
  );
  return [...new Set(fromServices.length > 0 ? fromServices : ranked.problem.capabilityIds)];
}

function eventPhrase(item: EventEvidence): string {
  const { event } = item;
  const when = event.occurredOn ? ` em ${brazilianPartialDate(event.occurredOn)}` : '';
  const funding = event.funding;
  if (event.type === 'funding' && funding) {
    const parts = [
      funding.round?.text,
      funding.amountCents !== null ? formatBrlAmount(funding.amountCents) : funding.amount?.text,
    ].filter(Boolean);
    const investors =
      funding.investors.length > 0
        ? `, com ${funding.investors.map((investor) => investor.text).join(' e ')}`
        : '';
    const what = parts.length > 0 ? parts.join(' de ') : 'Investimento';
    return `${what}${investors} (${event.host}${when})`;
  }
  return `${BUSINESS_EVENT_LABELS[event.type]}: "${event.headline}" (${event.host}${when})`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function angleFor(input: ThesisInput, ranked: RankedProblem): ThesisAngle {
  const { profile } = input;
  const eventSupports = ranked.supports.filter((support) => support.event !== null);
  const siteSupports = ranked.supports.filter((support) => support.site !== null);
  const lead = eventSupports[0]?.event ?? null;
  const contextParts =
    eventSupports.length > 0
      ? eventSupports
          .slice(0, 3)
          .map((support) => (support.event ? eventPhrase(support.event) : ''))
      : siteSupports.slice(0, 3).map((support) => support.site?.detail ?? '');
  const signals = [...new Set(ranked.supports.map((support) => support.signal))].slice(0, 8);
  const days = lead ? ageDays(lead.event.occurredOn, input.now) : null;
  const whyNow = lead
    ? lead.event.occurredOn
      ? days !== null && days <= RECENT_DAYS
        ? `O acontecimento é recente (${brazilianPartialDate(lead.event.occurredOn)}): é a fase em que a empresa decide o que muda.`
        : `O acontecimento é de ${brazilianPartialDate(lead.event.occurredOn)}: confirmar se o momento ainda vale.`
      : 'A data do acontecimento não foi conferida: confirmar se o momento ainda vale.'
    : 'Medições do site não indicam momento: não há urgência a partir delas.';
  const openingTopic = lead
    ? `${capitalize(BUSINESS_EVENT_LABELS[lead.event.type])}${
        lead.event.occurredOn ? ` anunciado em ${brazilianPartialDate(lead.event.occurredOn)}` : ''
      } e o que ele muda em ${ranked.problem.openingArea} na ${input.companyName}.`
    : `Uma observação concreta do site, como pergunta, sem tratar como projeto grande.`;
  const signalLabels = signals.map((signal) =>
    SITE_SIGNALS.has(signal)
      ? 'medições do site'
      : BUSINESS_EVENT_LABELS[signal as BusinessEventType],
  );
  return {
    problemId: ranked.problem.id,
    solutionId: ranked.solution?.id ?? null,
    title: (ranked.solution?.name ?? ranked.problem.statement).slice(0, 160),
    context: contextParts.filter(Boolean).join(' · ').slice(0, 600) || 'Sem contexto com fonte.',
    problem: `Hipótese a confirmar: ${ranked.problem.statement}`.slice(0, 400),
    offer: serviceNames(profile, ranked).slice(0, 8),
    why: `${ranked.solution?.rationale ?? ranked.problem.statement} Sustentado por: ${[...new Set(signalLabels)].join(', ')}.`.slice(
      0,
      600,
    ),
    whyNow,
    approachRole: ranked.problem.approachRole,
    openingTopic: openingTopic.slice(0, 300),
    signals,
    claimIds: [...new Set(ranked.supports.flatMap((support) => support.claimIds))].slice(0, 12),
  };
}

// -----------------------------------------------------------------------------
// Dimensões (Parte 4.2)
// -----------------------------------------------------------------------------

function dimension(
  key: ThesisDimension['key'],
  level: QualitativeLevel,
  reason: string,
  claimIds: readonly string[] = [],
): ThesisDimension {
  return { key, level, reason: reason.slice(0, 400), claimIds: [...new Set(claimIds)].slice(0, 8) };
}

function strategicPotential(principal: RankedProblem | null): ThesisDimension {
  if (!principal) {
    return dimension(
      'strategic_potential',
      'unknown',
      'Nenhum acontecimento nem medição que sustente uma oportunidade.',
    );
  }
  if (principal.siteOnly) {
    return dimension(
      'strategic_potential',
      'low',
      'Só há detalhes técnicos do site; sozinhos não indicam um momento da empresa.',
      principal.supports.flatMap((support) => support.claimIds),
    );
  }
  const top = principal.supports[0];
  const strength = top ? SIGNAL_STRENGTH[top.signal] : 0;
  const label =
    top && !SITE_SIGNALS.has(top.signal)
      ? BUSINESS_EVENT_LABELS[top.signal as BusinessEventType]
      : 'sinal';
  return dimension(
    'strategic_potential',
    strength >= 3 ? 'high' : strength >= 1.5 ? 'medium' : 'low',
    strength >= 3
      ? `Acontecimento estrutural (${label}): costuma mudar prioridades de marca, produto e operação.`
      : strength >= 1.5
        ? `Acontecimento relevante (${label}), mas não estrutural.`
        : `Sinal fraco (${label}): pouco diz sobre necessidade.`,
    top?.claimIds ?? [],
  );
}

function evidenceQuality(principal: RankedProblem | null): ThesisDimension {
  const lead = principal?.supports.find((support) => support.event !== null)?.event ?? null;
  if (!principal) return dimension('evidence_quality', 'unknown', 'Sem evidência para avaliar.');
  if (!lead) {
    return dimension(
      'evidence_quality',
      'medium',
      'Medições do próprio site, conferidas; dizem pouco sobre o momento da empresa.',
      principal.supports.flatMap((support) => support.claimIds),
    );
  }
  const { event } = lead;
  if (event.conflicts.length > 0) {
    return dimension(
      'evidence_quality',
      'low',
      `As fontes divergem: ${event.conflicts[0] ?? ''} A versão correta não foi confirmada.`,
      [lead.claimId],
    );
  }
  const goodSource = event.sourceTier !== 'other';
  const confirmed = event.confirmedBy.length > 0;
  const republished =
    event.republishedBy.length > 0
      ? ` ${event.republishedBy.length} republicação(ões) não contam como confirmação.`
      : '';
  if (event.pageRead && goodSource && confirmed) {
    return dimension(
      'evidence_quality',
      'high',
      `Matéria lida em ${event.host} e confirmada por ${event.confirmedBy.join(', ')}.${republished}`,
      [lead.claimId],
    );
  }
  if ((event.pageRead && goodSource) || confirmed) {
    return dimension(
      'evidence_quality',
      'medium',
      `${event.pageRead ? `Matéria lida em ${event.host}` : `Título em ${event.host}`}${confirmed ? `, confirmada por ${event.confirmedBy.join(', ')}` : ', sem confirmação independente'}.${republished}`,
      [lead.claimId],
    );
  }
  return dimension(
    'evidence_quality',
    'low',
    `Só ${event.pageRead ? 'uma página de fonte não reconhecida' : 'o título de um resultado de busca'} (${event.host}), sem confirmação independente.${republished}`,
    [lead.claimId],
  );
}

function deliveryShare(profile: CommercialProfile, ids: readonly string[]) {
  const index = capabilityIndex(profile);
  const modes = ids.map((id) => index.get(id)?.deliveryMode).filter((mode) => mode !== undefined);
  const count = (wanted: string[]) => modes.filter((mode) => wanted.includes(mode)).length;
  return {
    total: modes.length,
    own: count(['direct', 'directed']),
    partners: count(['partners']),
    unproven: count(['unproven']),
    unprovenNames: ids
      .map((id) => index.get(id))
      .filter((capability) => capability?.deliveryMode === 'unproven')
      .map((capability) => capability?.name ?? ''),
  };
}

function commercialFit(input: ThesisInput, principal: RankedProblem | null): ThesisDimension {
  if (!principal)
    return dimension('commercial_fit', 'unknown', 'Sem oportunidade para comparar com o catálogo.');
  const share = deliveryShare(input.profile, capabilityIdsOf(input.profile, principal));
  const level: QualitativeLevel =
    share.total === 0
      ? 'unknown'
      : share.own / share.total >= 0.6
        ? 'high'
        : share.own > 0
          ? 'medium'
          : 'low';
  return dimension(
    'commercial_fit',
    level,
    `${share.own} de ${share.total} capacidades da solução são feitas ou dirigidas pela ${input.profile.name}${share.partners > 0 ? `; ${share.partners} com parceiros` : ''}${share.unproven > 0 ? `; ${share.unproven} ainda não comprovadas` : ''}.`,
    principal.supports.flatMap((support) => support.claimIds),
  );
}

function timing(input: ThesisInput, principal: RankedProblem | null): ThesisDimension {
  const lead = principal?.supports.find((support) => support.event !== null)?.event ?? null;
  if (!lead) {
    return dimension(
      'timing',
      'unknown',
      principal ? 'Medições do site não têm data de acontecimento.' : 'Sem acontecimento datado.',
    );
  }
  const days = ageDays(lead.event.occurredOn, input.now);
  if (days === null)
    return dimension('timing', 'unknown', 'A data do acontecimento não foi conferida.', [
      lead.claimId,
    ]);
  const when = brazilianPartialDate(lead.event.occurredOn ?? '');
  if (days <= RECENT_DAYS)
    return dimension('timing', 'high', `Acontecimento de ${when}, há ${days} dias.`, [
      lead.claimId,
    ]);
  if (days <= OLD_DAYS)
    return dimension(
      'timing',
      'medium',
      `Acontecimento de ${when}, há ${days} dias: o momento pode já ter passado.`,
      [lead.claimId],
    );
  return dimension('timing', 'low', `Acontecimento de ${when}, há mais de um ano e meio.`, [
    lead.claimId,
  ]);
}

function accessibility(input: ThesisInput, principal: RankedProblem | null): ThesisDimension {
  // Sem entidade de pessoa (doc 15 §6), decisores não são identificados: nunca "alto".
  return input.contactKnown
    ? dimension(
        'accessibility',
        'medium',
        `Há canal de contato público registrado; quem decide (${principal?.problem.approachRole ?? 'a definir'}) ainda não foi identificado.`,
      )
    : dimension(
        'accessibility',
        'low',
        'Nenhum canal de contato registrado e nenhum decisor identificado.',
      );
}

function executionViability(input: ThesisInput, principal: RankedProblem | null): ThesisDimension {
  if (!principal) return dimension('execution_viability', 'unknown', 'Sem solução para avaliar.');
  const share = deliveryShare(input.profile, capabilityIdsOf(input.profile, principal));
  if (share.total === 0)
    return dimension('execution_viability', 'unknown', 'A solução não tem capacidades mapeadas.');
  if (share.unproven === share.total) {
    return dimension(
      'execution_viability',
      'low',
      'Todas as capacidades da solução ainda não foram comprovadas comercialmente.',
    );
  }
  if (share.unproven > 0 || share.partners > share.own) {
    return dimension(
      'execution_viability',
      'medium',
      `Exige ${share.partners > 0 ? 'parceiros' : ''}${share.partners > 0 && share.unproven > 0 ? ' e ' : ''}${share.unproven > 0 ? `capacidades não comprovadas (${share.unprovenNames.slice(0, 3).join(', ')})` : ''}.`,
    );
  }
  return dimension(
    'execution_viability',
    'high',
    'A solução usa capacidades que a equipe executa ou dirige.',
  );
}

// -----------------------------------------------------------------------------
// Tese
// -----------------------------------------------------------------------------

function doNotOffer(input: ThesisInput, principal: RankedProblem | null) {
  const out: Array<{ item: string; reason: string }> = [];
  const funding = input.events.find((item) => item.event.type === 'funding');
  if (funding) {
    const details = funding.event.funding;
    out.push({
      item: 'Tratar o investimento como orçamento para serviços',
      reason:
        details?.purpose.status === 'declared'
          ? `A finalidade declarada é "${details.purpose.value.text}"; investimento não é verba para fornecedores.`
          : 'A destinação dos recursos não está documentada.',
    });
  }
  const hasBusiness = input.events.some((item) => SIGNAL_STRENGTH[item.event.type] >= 1.5);
  if (hasBusiness && input.siteSignals.length > 0) {
    out.push({
      item: 'Abrir pela auditoria do site (contraste, toque, rolagem)',
      reason: 'É detalhe técnico; o momento da empresa é outro.',
    });
  }
  // O que o perfil não oferece logo depois de certos acontecimentos (ex.: rebranding após troca
  // de marca, na Found Studio). Sem data conferida, vale por precaução.
  for (const rule of input.profile.avoidAfterEvents) {
    const recent = input.events.some((item) => {
      const days = ageDays(item.event.occurredOn, input.now);
      return item.event.type === rule.type && (days === null || days <= OLD_DAYS);
    });
    if (recent) out.push({ item: rule.item, reason: rule.reason });
  }
  if (principal) {
    const share = deliveryShare(input.profile, capabilityIdsOf(input.profile, principal));
    for (const name of share.unprovenNames.slice(0, 2)) {
      out.push({
        item: `${name} como experiência comprovada`,
        reason: 'Capacidade ainda não comprovada comercialmente (Parte 1.4).',
      });
    }
  }
  out.push({
    item: 'O portfólio inteiro',
    reason: 'Um ângulo principal por abordagem, no máximo duas alternativas.',
  });
  return out.slice(0, 8);
}

function toConfirm(input: ThesisInput, principal: RankedProblem | null): string[] {
  const out: string[] = [...(principal?.problem.toConfirm ?? [])];
  for (const item of input.events) {
    const { event } = item;
    if (event.type === 'funding' && event.funding?.purpose.status !== 'declared') {
      out.push('Para que serão usados os recursos do investimento');
    }
    if (event.type === 'funding' && event.funding?.modality === 'unknown') {
      out.push('A modalidade do investimento (participação, dívida ou crédito)');
    }
  }
  const lead = principal?.supports.find((support) => support.event !== null)?.event ?? null;
  for (const conflict of lead?.event.conflicts ?? [])
    out.push(`Qual versão está certa. ${conflict}`);
  if (lead && !lead.event.pageRead) out.push(`Ler a matéria original: ${lead.event.url}`);
  if (lead && lead.event.confirmedBy.length === 0) {
    out.push(`Outra fonte independente para: ${lead.event.headline}`);
  }
  if (principal) {
    out.push(
      `Quem decide sobre o tema (${principal?.problem.approachRole ?? 'a definir'}) e um canal profissional público`,
    );
  }
  return [...new Set(out.map((text) => text.slice(0, 240)))].slice(0, 10);
}

function recommendationOf(
  principal: RankedProblem | null,
  dimensions: readonly ThesisDimension[],
): { recommendation: ThesisRecommendation; reason: string } {
  const level = (key: ThesisDimension['key']) =>
    dimensions.find((item) => item.key === key)?.level ?? 'unknown';
  if (!principal) {
    return {
      recommendation: 'deepen_research',
      reason:
        'Nenhum acontecimento encontrado: não há base para uma tese. Vale pesquisar mais antes de decidir.',
    };
  }
  if (principal.siteOnly) {
    return {
      recommendation: 'deprioritize',
      reason: 'Só há detalhes técnicos do site: não justificam uma abordagem estratégica agora.',
    };
  }
  const lead = principal.supports.find((support) => support.event !== null)?.event ?? null;
  if (lead && lead.event.conflicts.length > 0) {
    return {
      recommendation: 'deepen_research',
      reason:
        'As fontes divergem sobre o acontecimento: confirmar a versão correta antes de abordar.',
    };
  }
  if (level('evidence_quality') === 'low') {
    return {
      recommendation: 'deepen_research',
      reason:
        'O potencial existe, mas o acontecimento só tem uma fonte fraca: confirmar antes de abordar.',
    };
  }
  if (level('timing') === 'low') {
    return {
      recommendation: 'deepen_research',
      reason: 'O acontecimento é antigo: confirmar se a empresa ainda está nesse momento.',
    };
  }
  // Sem data conferida (ex.: o próprio site menciona vagas), não há "momento" para sustentar a
  // abordagem: primeiro descobrir quando aconteceu.
  if (level('timing') === 'unknown') {
    return {
      recommendation: 'deepen_research',
      reason:
        'O acontecimento não tem data conferida: confirmar quando aconteceu antes de abordar.',
    };
  }
  return {
    recommendation: 'approach',
    reason:
      'Há acontecimento com fonte e uma solução compatível: vale preparar a abordagem, confirmando os pontos abertos.',
  };
}

/** Parte 4.3: um ângulo principal, até duas alternativas com solução diferente. */
export function buildCommercialThesis(input: ThesisInput): CommercialThesis {
  const ranked = rankProblems(input);
  const principal = ranked[0] ?? null;
  const alternatives: RankedProblem[] = [];
  const usedSolutions = new Set([principal?.solution?.id ?? principal?.problem.id]);
  for (const item of ranked.slice(1)) {
    const id = item.solution?.id ?? item.problem.id;
    if (usedSolutions.has(id)) continue;
    usedSolutions.add(id);
    alternatives.push(item);
    if (alternatives.length === 2) break;
  }
  const dimensions = [
    strategicPotential(principal),
    evidenceQuality(principal),
    commercialFit(input, principal),
    timing(input, principal),
    accessibility(input, principal),
    executionViability(input, principal),
  ];
  const { recommendation, reason } = recommendationOf(principal, dimensions);
  return {
    version: COMPATIBILITY_VERSION,
    profileId: input.profile.id,
    profileVersion: input.profile.version,
    recommendation,
    recommendationReason: reason,
    principal: principal ? angleFor(input, principal) : null,
    alternatives: alternatives.map((item) => angleFor(input, item)),
    dimensions,
    doNotOffer: doNotOffer(input, principal),
    toConfirm: toConfirm(input, principal),
  };
}

/** Rótulo curto da modalidade, para textos do relatório. */
export function fundingModalityLabel(modality: keyof typeof FUNDING_MODALITY_LABELS): string {
  return FUNDING_MODALITY_LABELS[modality];
}
