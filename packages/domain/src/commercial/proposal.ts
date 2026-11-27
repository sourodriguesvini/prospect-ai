import {
  THESIS_RECOMMENDATION_LABELS,
  type ApproachProposal,
  type ApproachThesis,
  type CommercialProfile,
  type ProposalFamily,
  type ProposalMode,
  type ProposalOptions,
  type ProposalRecommendation,
  type ThesisAngle,
} from '@prospector/contracts';

/**
 * Proposta da abordagem (ajuste de 2026-11-27, "motor de ofertas"): a oferta deixa de ser um campo
 * obrigatório da Estratégia e passa a sair da tese e do catálogo do perfil comercial —
 * investigação → acontecimentos → interpretação → necessidade × capacidades → solução recomendada
 * (ou combinação) → ângulo → mensagem. Regra pura e explicável; o modelo só escreve por cima.
 *
 * Barreira de coerência (correção de 27/11): propor serviço exige tese do perfil que recomende
 * abordar, ângulo com evidência em vigor e frentes ligadas ao problema do ângulo. Sem isso, o
 * motivo aparece na tela e a geração não acontece só porque alguém clicou em "Preparar". Conversa
 * sem oferta (networking, sondar interesse) não depende da tese: só da base do dossiê.
 */

/** O que a barreira precisa da tese (ApproachThesis serve). */
export type ProposalThesis = Pick<
  ApproachThesis,
  'recommendation' | 'recommendationReason' | 'principal' | 'alternatives' | 'toConfirm'
>;

export type ProposalAngleChoice = 'principal' | 'alternative_1' | 'alternative_2';

/** Ângulo escolhido da tese (null quando ela não tem esse ângulo). */
export function angleOf(
  thesis: Pick<ApproachThesis, 'principal' | 'alternatives'> | null,
  choice: ProposalAngleChoice,
): ThesisAngle | null {
  if (!thesis) return null;
  if (choice === 'principal') return thesis.principal;
  return thesis.alternatives[choice === 'alternative_1' ? 0 : 1] ?? null;
}

/** Frentes do catálogo do perfil (as famílias de capacidades), na ordem do perfil. */
export function profileFamilies(profile: CommercialProfile): ProposalFamily[] {
  return profile.families.map((family) => ({ code: family.code, name: family.name }));
}

function familyByCapability(profile: CommercialProfile): ReadonlyMap<string, string> {
  return new Map(
    profile.families.flatMap((family) =>
      family.capabilities.map((capability) => [capability.id, family.code] as const),
    ),
  );
}

export interface AngleScope {
  /** Serviços do perfil para o ângulo (os da solução; sem ela, os ligados ao problema). */
  readonly serviceIds: readonly string[];
  readonly serviceNames: readonly string[];
  /** Frentes que concentram o trabalho (duas ou mais capacidades; senão, a maior). */
  readonly familyCodes: readonly string[];
  /** Todas as frentes com alguma capacidade do problema ou dos serviços do ângulo. */
  readonly connectedFamilyCodes: readonly string[];
  readonly rationale: string;
}

/** Serviços, capacidades e frentes que um ângulo da tese mobiliza no catálogo do perfil. */
export function angleScope(profile: CommercialProfile, angle: ThesisAngle): AngleScope {
  const problem = profile.problems.find((item) => item.id === angle.problemId) ?? null;
  const solution = angle.solutionId
    ? (profile.solutions.find((item) => item.id === angle.solutionId) ?? null)
    : null;
  const problemCaps = new Set(problem?.capabilityIds ?? []);
  let services = (solution?.serviceIds ?? [])
    .map((id) => profile.services.find((service) => service.id === id))
    .filter((service): service is NonNullable<typeof service> => Boolean(service));
  if (services.length === 0 && problemCaps.size > 0) {
    services = profile.services
      .filter((service) => service.capabilityIds.some((id) => problemCaps.has(id)))
      .slice(0, 4);
  }
  // Tese gravada com outra versão do catálogo: cai para os nomes de serviço do próprio ângulo.
  if (services.length === 0) {
    const names = new Set(angle.offer.map((name) => name.toLowerCase()));
    services = profile.services.filter((service) => names.has(service.name.toLowerCase()));
  }
  const byCapability = familyByCapability(profile);
  const counts = new Map<string, number>();
  const serviceCaps = [...new Set(services.flatMap((service) => service.capabilityIds))];
  for (const id of serviceCaps) {
    const code = byCapability.get(id);
    if (code) counts.set(code, (counts.get(code) ?? 0) + 1);
  }
  const order = profile.families.map((family) => family.code);
  const ranked = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0]),
  );
  const strong = ranked.filter(([, count]) => count >= 2).map(([code]) => code);
  const familyCodes = strong.length > 0 ? strong : ranked.slice(0, 1).map(([code]) => code);
  const connected = new Set<string>();
  for (const id of [...problemCaps, ...serviceCaps]) {
    const code = byCapability.get(id);
    if (code) connected.add(code);
  }
  return {
    serviceIds: services.map((service) => service.id),
    serviceNames: services.map((service) => service.name),
    familyCodes: order.filter((code) => familyCodes.includes(code)),
    connectedFamilyCodes: order.filter((code) => connected.has(code)),
    rationale: solution?.rationale ?? angle.why,
  };
}

const MAX_FAMILIES = 3;
const MAX_SERVICES = 8;

function familiesFrom(profile: CommercialProfile, codes: readonly string[]): ProposalFamily[] {
  return profileFamilies(profile).filter((family) => codes.includes(family.code));
}

/**
 * Solução recomendada para o ângulo escolhido. No ângulo principal, combina com a primeira
 * alternativa quando a tese recomenda abordar, o mesmo acontecimento sustenta os dois (primeiro
 * claim igual) e a alternativa traz frente nova — ex.: reestruturação que pede marca e operação.
 */
export function recommendProposal(
  profile: CommercialProfile,
  thesis: ProposalThesis | null,
  choice: ProposalAngleChoice = 'principal',
): ProposalRecommendation | null {
  const angle = angleOf(thesis, choice);
  if (!thesis || !angle) return null;
  const scope = angleScope(profile, angle);
  // Tese gravada com outra versão do catálogo, sem serviço que case: vale o que o próprio ângulo
  // propõe, sem frente (nunca uma combinação que ninguém escolheu).
  if (scope.serviceNames.length === 0 && scope.familyCodes.length === 0) {
    return {
      title: angle.title.slice(0, 160),
      families: [],
      services: angle.offer.slice(0, MAX_SERVICES).map((name) => name.slice(0, 160)),
      rationale: angle.why.slice(0, 600),
      combinedWith: null,
    };
  }
  let codes = [...scope.familyCodes];
  let services = [...scope.serviceNames];
  let combinedWith: string | null = null;
  const alternative = thesis.alternatives[0] ?? null;
  if (
    choice === 'principal' &&
    thesis.recommendation === 'approach' &&
    alternative &&
    alternative.claimIds[0] !== undefined &&
    alternative.claimIds[0] === angle.claimIds[0]
  ) {
    const extra = angleScope(profile, alternative);
    const added = extra.familyCodes.filter((code) => !codes.includes(code));
    if (added.length > 0 && codes.length < MAX_FAMILIES) {
      codes = [...codes, ...added].slice(0, MAX_FAMILIES);
      services = [...new Set([...services, ...extra.serviceNames])];
      combinedWith = alternative.title;
    }
  }
  const rationale = combinedWith
    ? `${scope.rationale} Combina com "${combinedWith}": o mesmo acontecimento sustenta as duas frentes.`
    : scope.rationale;
  return {
    title: (combinedWith ? `${angle.title} + ${combinedWith}` : angle.title).slice(0, 160),
    families: familiesFrom(profile, codes),
    services: services.slice(0, MAX_SERVICES),
    rationale: rationale.slice(0, 600),
    combinedWith: combinedWith ? combinedWith.slice(0, 160) : null,
  };
}

export interface CoherenceInput {
  readonly profile: CommercialProfile;
  /** Tese do perfil escolhido para a empresa (null = a investigação não ligou os dois). */
  readonly thesis: ProposalThesis | null;
  /** Ângulo escolhido; null = "sem a tese". */
  readonly choice: ProposalAngleChoice | null;
  readonly mode: ProposalMode;
  /** Frentes escolhidas no modo "ajustar". */
  readonly families: readonly string[];
  /** Claims citáveis agora (em vigor, sem hipótese nem confiança baixa). */
  readonly citableClaimIds: ReadonlySet<string>;
}

/** Textos da barreira, os mesmos na tela e no servidor (revisão de arquitetura de 27/11). */
export const NO_ANGLE_BLOCKER =
  'Sem um ângulo da tese não há o que propor com base nas evidências: escolha um ângulo ou só abra uma conversa.';
export const NO_FAMILY_BLOCKER = 'Escolha ao menos uma frente do catálogo para propor.';
/** Conversa sem base no dossiê (o serviço responde `approach_basis_insufficient` com este texto). */
export const NO_BASIS_BLOCKER =
  'Ainda não há base para uma abordagem: investigue a empresa (fatos do cadastro ou do site) antes de gerar.';

function unlinkedFamiliesBlocker(
  angleTitle: string,
  chosen: readonly string[],
  connected: readonly string[],
): string {
  return `As frentes escolhidas (${chosen.join(', ')}) não se ligam ao ângulo "${angleTitle}". Inclua ao menos uma destas: ${connected.join(', ')}; ou troque o ângulo.`.slice(
    0,
    600,
  );
}

/**
 * Frentes escolhidas no modo "ajustar" contra as ligadas ao ângulo: vazio = combinação aceita.
 * `names` traduz o código da frente no nome do catálogo do perfil.
 */
function familiesBlocker(
  angleTitle: string,
  chosen: readonly string[],
  connected: readonly string[],
  names: (codes: readonly string[]) => string[],
): string[] {
  if (chosen.length === 0) return [NO_FAMILY_BLOCKER];
  if (chosen.some((code) => connected.includes(code))) return [];
  return [unlinkedFamiliesBlocker(angleTitle, names(chosen), names(connected))];
}

/**
 * A barreira sobre as opções que o servidor já calculou (`ProposalOptions`): o que a tela mostra
 * antes do clique. O servidor confere de novo com `assessProposalCoherence`; os textos são os
 * mesmos.
 */
export function proposalBlockers(
  options: ProposalOptions,
  mode: ProposalMode,
  choice: string | null,
  families: readonly string[],
): string[] {
  if (mode === 'conversation') return options.conversationAllowed ? [] : [NO_BASIS_BLOCKER];
  const angle = options.angles.find((item) => item.choice === choice) ?? null;
  if (!angle)
    return options.serviceBlockers.length > 0 ? options.serviceBlockers : [NO_ANGLE_BLOCKER];
  if (mode === 'recommended') return angle.blockers;
  const known = new Set(options.families.map((family) => family.code));
  const names = (codes: readonly string[]) =>
    options.families.filter((family) => codes.includes(family.code)).map((family) => family.name);
  return [
    ...angle.blockers,
    ...familiesBlocker(
      angle.title,
      families.filter((code) => known.has(code)),
      angle.connectedFamilies,
      names,
    ),
  ];
}

function confirmList(thesis: ProposalThesis): string {
  const items = thesis.toConfirm.slice(0, 3);
  return items.length > 0 ? ` Antes de propor, confirme: ${items.join('; ')}.` : '';
}

/**
 * Barreira de coerência comercial antes de gerar (correção de 27/11). Vazio = pode preparar; senão,
 * os motivos, em pt-BR, para a tela. Conversa sem oferta só depende da base do dossiê, que o
 * serviço confere à parte (`assessApproachBasis`).
 */
export function assessProposalCoherence(input: CoherenceInput): string[] {
  if (input.mode === 'conversation') return [];
  const { profile, thesis } = input;
  if (!thesis) {
    return [
      `Ainda não há tese da ${profile.name} para esta empresa: a investigação não ligou um acontecimento dela a algo do catálogo. Investigue a empresa antes de propor, ou escolha só abrir uma conversa.`,
    ];
  }
  if (thesis.recommendation !== 'approach') {
    return [
      `${THESIS_RECOMMENDATION_LABELS[thesis.recommendation]}: ${thesis.recommendationReason}${confirmList(thesis)}`.slice(
        0,
        600,
      ),
    ];
  }
  const angle = input.choice ? angleOf(thesis, input.choice) : null;
  if (!angle) return [NO_ANGLE_BLOCKER];
  const blockers: string[] = [];
  if (!angle.claimIds.some((id) => input.citableClaimIds.has(id))) {
    blockers.push(
      `As evidências do ângulo "${angle.title}" não estão mais em vigor (vencidas, contestadas ou só hipóteses): investigue a empresa de novo antes de propor.`.slice(
        0,
        600,
      ),
    );
  }
  if (input.mode === 'custom') {
    const scope = angleScope(profile, angle);
    const known = new Set(profile.families.map((family) => family.code));
    const names = (codes: readonly string[]) =>
      familiesFrom(profile, codes).map((family) => family.name);
    blockers.push(
      ...familiesBlocker(
        angle.title,
        input.families.filter((code) => known.has(code)),
        scope.connectedFamilyCodes,
        names,
      ),
    );
  }
  return blockers;
}

/** Objetivo da primeira interação, pelo modo (a IA não troca o objetivo sozinha). */
export function proposalObjective(mode: ProposalMode, kind: CommercialProfile['kind']): string {
  if (mode === 'conversation') {
    return 'Abrir uma conversa ou sondar interesse, sem apresentar serviço nem pedir reunião de venda.';
  }
  return kind === 'product'
    ? 'Despertar interesse em conhecer o produto, a partir do momento da empresa, sem lista de funções.'
    : 'Abrir uma conversa sobre o momento da empresa e o que ele pede, propondo a frente certa sem apresentar o portfólio inteiro.';
}

export interface BuildProposalInput {
  readonly profile: CommercialProfile;
  readonly thesis: ProposalThesis | null;
  readonly choice: ProposalAngleChoice | null;
  readonly mode: ProposalMode;
  readonly families: readonly string[];
  readonly note: string | null;
}

/**
 * A proposta gravada na estratégia e entregue à IA. Quem chama já passou pela barreira
 * (`assessProposalCoherence`); aqui só se monta o que foi decidido.
 */
export function buildProposal(input: BuildProposalInput): ApproachProposal {
  const { profile, mode } = input;
  const base = {
    profileId: profile.id,
    profileName: profile.name,
    profileKind: profile.kind,
    mode,
    objective: proposalObjective(mode, profile.kind),
    note: input.note?.trim() ? input.note.trim().slice(0, 400) : null,
  };
  if (mode === 'conversation') {
    return {
      ...base,
      title: 'Sem oferta direta: abrir uma conversa',
      families: [],
      services: [],
      rationale:
        'Primeiro contato sem apresentar serviço: entender o momento da empresa e se há interesse em conversar.',
    };
  }
  const angle = input.choice ? angleOf(input.thesis, input.choice) : null;
  const recommendation = input.choice
    ? recommendProposal(profile, input.thesis, input.choice)
    : null;
  if (mode === 'recommended' && recommendation) {
    return {
      ...base,
      title: recommendation.title,
      families: recommendation.families,
      services: recommendation.services,
      rationale: recommendation.rationale,
    };
  }
  // Ajuste: as frentes escolhidas. Em cada uma, os serviços do ângulo que caem nela; frente que o
  // ângulo não usa entra com até dois serviços dela (combinação livre do catálogo).
  const chosen = profileFamilies(profile).filter((family) => input.families.includes(family.code));
  const byCapability = familyByCapability(profile);
  const angleServices = new Set(angle ? angleScope(profile, angle).serviceIds : []);
  const services: string[] = [];
  for (const family of chosen) {
    const inFamily = profile.services.filter((service) =>
      service.capabilityIds.some((id) => byCapability.get(id) === family.code),
    );
    const fromAngle = inFamily.filter((service) => angleServices.has(service.id));
    for (const service of fromAngle.length > 0 ? fromAngle : inFamily.slice(0, 2)) {
      if (!services.includes(service.name)) services.push(service.name);
    }
  }
  const title = chosen.map((family) => family.name).join(' + ') || 'Proposta ajustada';
  return {
    ...base,
    title: title.slice(0, 160),
    families: chosen,
    services: services.slice(0, MAX_SERVICES),
    rationale: (angle
      ? `Frentes escolhidas por quem dirige a agência para o ângulo "${angle.title}". ${angleScope(profile, angle).rationale}`
      : 'Frentes escolhidas por quem dirige a agência.'
    ).slice(0, 600),
  };
}
