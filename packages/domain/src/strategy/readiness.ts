import type {
  ApproachClearance,
  DiscoveryClearance,
  IcpProfile,
  Offer,
  Readiness,
  ReadinessCode,
  ReadinessGate,
  ReadinessItem,
  StrategySnapshot,
} from '@prospector/contracts';
import { effectiveLia, formatCalendarDate } from './lia';
import { offerCompletenessGaps } from './rules';

/**
 * Checklist de prontidão (docs/09 F2): o que falta para DESCOBRIR (F4) e para ABORDAR (F10).
 * Abordar exige tudo de descobrir mais voz da agência, política de contato (opt-out e canal do
 * titular) e LIA aprovada em vigor. Case citável é recomendação, não bloqueio.
 * Dados de demonstração (`isDemo`) e itens arquivados nunca contam.
 *
 * Sem escopo, avalia a oferta mais adiantada (visão geral). As barreiras das ações recebem a
 * oferta ou o ICP da ação: uma oferta pronta nunca libera a ação de outra oferta.
 */

const OFFER_ITEMS = [
  'offer_complete',
  'rubric',
  'scoring_model',
  'offer_active',
  'icp_active',
] as const satisfies readonly ReadinessCode[];

const LABELS: Record<ReadinessCode, string> = {
  offer_complete: 'Oferta completa',
  rubric: 'Rubrica de auditoria',
  scoring_model: 'Modelo de score',
  offer_active: 'Oferta ativa',
  icp_active: 'ICP ativo',
  voice_guide: 'Voz da agência',
  contact_policy: 'Opt-out e canal do titular',
  lia_approved: 'LIA aprovada',
  public_case: 'Case citável',
  persistent_storage: 'Banco de dados persistente',
};

export interface ReadinessScope {
  /** Oferta da ação. */
  offerId?: string;
  /** ICP da ação: precisa estar ativo e ser da oferta. Sem `offerId`, a oferta é a do ICP. */
  icpId?: string;
}

export interface ReadinessOptions {
  /**
   * Armazenamento que some ao reiniciar (modo memória). LIA e auditoria são registros de
   * responsabilização: sem banco persistente, abordar fica sempre bloqueado.
   */
  ephemeralStorage?: boolean;
}

function item(code: ReadinessCode, ok: boolean, detail: string, blocking = true): ReadinessItem {
  return { code, label: LABELS[code], ok, blocking, detail };
}

function plural(count: number, singular: string, pluralForm: string): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

const offerName = (offer: Offer) =>
  offer.current ? `"${offer.current.content.name}"` : 'a oferta sem conteúdo';

const countsIcp = (icp: IcpProfile, offerId: string) =>
  icp.offerId === offerId && !icp.isDemo && icp.status === 'active' && icp.current !== null;

function offerItems(s: StrategySnapshot, offer: Offer, icpId?: string): ReadinessItem[] {
  const name = offerName(offer);
  const gaps = offerCompletenessGaps(offer.current?.content ?? null);
  const rubric = s.rubrics.find((r) => r.offerId === offer.id);
  const scoring = s.scoringModels.find((m) => m.offerId === offer.id);
  const icp = icpId
    ? s.icps.find((p) => p.id === icpId && countsIcp(p, offer.id))
    : s.icps.find((p) => countsIcp(p, offer.id));
  const icpDetail = icp?.current
    ? `ICP ativo: "${icp.current.content.name}".`
    : icpId
      ? `O ICP da ação não está ativo, não é de ${name} ou é de demonstração.`
      : `Nenhum ICP ativo para ${name}.`;
  return [
    item(
      'offer_complete',
      gaps.length === 0,
      gaps.length === 0
        ? `${name} (v${offer.current?.version}) tem problemas, sinais, desqualificadores, entregáveis e faixa de investimento.`
        : `Falta em ${name}: ${gaps.join(', ')}.`,
    ),
    item(
      'rubric',
      Boolean(rubric),
      rubric
        ? `Rubrica v${rubric.version} com ${plural(rubric.content.criteria.length, 'critério', 'critérios')}.`
        : `${name} ainda não tem rubrica de auditoria visual.`,
    ),
    item(
      'scoring_model',
      Boolean(scoring),
      scoring
        ? `Modelo de score v${scoring.version} (pesos somam 100).`
        : `${name} ainda não tem modelo de score (pesos e limiares).`,
    ),
    item(
      'offer_active',
      offer.status === 'active',
      offer.status === 'active'
        ? `${name} está ativa.`
        : offer.status === 'draft'
          ? `${name} está em rascunho; ative-a quando estiver completa.`
          : `${name} está arquivada e não pode ser usada.`,
    ),
    item('icp_active', Boolean(icp), icpDetail),
  ];
}

/** Sem oferta que conte: a primeira linha explica, as demais dependem dela. */
function noOfferItems(detail: string): ReadinessItem[] {
  return OFFER_ITEMS.map((code, index) =>
    item(code, false, index === 0 ? detail : 'Depende de uma oferta.'),
  );
}

function noOfferDetail(s: StrategySnapshot): string {
  if (s.offers.some((o) => o.isDemo && o.status !== 'archived')) {
    return 'Só há ofertas de demonstração; elas não contam para a prontidão.';
  }
  if (s.offers.some((o) => o.status === 'archived')) {
    return 'Só há ofertas arquivadas; crie uma oferta nova.';
  }
  return 'Nenhuma oferta cadastrada.';
}

/** Oferta mais adiantada: mais itens atendidos; empate → ativa; depois a mais recente. */
function pickOffer(s: StrategySnapshot): { offer: Offer; items: ReadinessItem[] } | null {
  const candidates = s.offers
    .filter((o) => !o.isDemo && o.status !== 'archived')
    .map((offer) => ({ offer, items: offerItems(s, offer) }));
  candidates.sort((a, b) => {
    const score = (c: typeof a) => c.items.filter((i) => i.ok).length;
    return (
      score(b) - score(a) ||
      Number(b.offer.status === 'active') - Number(a.offer.status === 'active') ||
      b.offer.updatedAt.localeCompare(a.offer.updatedAt)
    );
  });
  return candidates[0] ?? null;
}

/** Oferta e itens do escopo pedido (ou da oferta mais adiantada, sem escopo). */
function scopedOffer(
  s: StrategySnapshot,
  scope: ReadinessScope,
): { offer: Offer | null; items: ReadinessItem[] } {
  if (!scope.offerId && !scope.icpId) {
    const picked = pickOffer(s);
    return picked ?? { offer: null, items: noOfferItems(noOfferDetail(s)) };
  }
  let offerId = scope.offerId;
  if (scope.icpId) {
    const icp = s.icps.find((p) => p.id === scope.icpId);
    if (!icp) return { offer: null, items: noOfferItems('O ICP da ação não foi encontrado.') };
    if (offerId && icp.offerId !== offerId) {
      return { offer: null, items: noOfferItems('O ICP da ação não é desta oferta.') };
    }
    offerId = icp.offerId;
  }
  const offer = s.offers.find((o) => o.id === offerId);
  if (!offer) return { offer: null, items: noOfferItems('A oferta da ação não foi encontrada.') };
  if (offer.isDemo) {
    return {
      offer: null,
      items: noOfferItems('A oferta da ação é de demonstração e não conta para a prontidão.'),
    };
  }
  return { offer, items: offerItems(s, offer, scope.icpId) };
}

function gate(items: ReadinessItem[], offer: Offer | null): ReadinessGate {
  const ready = items.every((i) => i.ok || !i.blocking);
  return { ready, items, offerId: offer?.id ?? null };
}

export function assessReadiness(
  s: StrategySnapshot,
  today: string,
  scope: ReadinessScope = {},
  options: ReadinessOptions = {},
): Readiness {
  const { offer, items: perOffer } = scopedOffer(s, scope);

  const lia = effectiveLia(s.liaVersions, today);
  const liaDetail = (() => {
    switch (lia.status) {
      case 'none':
        return 'Nenhuma LIA registrada. Preencha o modelo guiado e aprove.';
      case 'pending':
        return 'Há LIA em rascunho, mas nenhuma aprovada.';
      case 'revoked':
        return `A LIA v${lia.version.version} foi revogada. Salve uma nova versão (pode manter o texto) e aprove.`;
      case 'expired':
        return `A LIA v${lia.version.version} venceu a revisão em ${formatCalendarDate(lia.version.reviewDueOn ?? '')}. Revise, salve uma nova versão e aprove.`;
      case 'approved':
        return `LIA v${lia.version.version} aprovada; revisão até ${formatCalendarDate(lia.version.reviewDueOn ?? '')}.`;
    }
  })();

  const publicCases = s.proofAssets.filter(
    (p) =>
      p.publicOk &&
      !p.isDemo &&
      !p.archivedAt &&
      (p.offerId === null || (offer !== null && p.offerId === offer.id)),
  );

  const compliance = [
    item(
      'voice_guide',
      s.voiceGuide !== null,
      s.voiceGuide
        ? `Voz da agência v${s.voiceGuide.version}.`
        : 'Descreva a voz da agência para orientar a redação.',
    ),
    item(
      'contact_policy',
      s.contactPolicy !== null,
      s.contactPolicy
        ? `Texto de opt-out e canal do titular v${s.contactPolicy.version}.`
        : 'Defina o texto de opt-out e o canal do titular exigidos em toda primeira mensagem.',
    ),
    item('lia_approved', lia.status === 'approved', liaDetail),
    item(
      'public_case',
      publicCases.length > 0,
      publicCases.length > 0
        ? `${plural(publicCases.length, 'case', 'cases')} com autorização para citar.`
        : 'Nenhum case com autorização para citar.',
      false,
    ),
  ];
  if (options.ephemeralStorage) {
    compliance.push(
      item(
        'persistent_storage',
        false,
        'Modo memória: a LIA aprovada e a auditoria somem ao reiniciar. Abordar exige o banco configurado.',
      ),
    );
  }

  return {
    discover: gate(perOffer, offer),
    approach: gate([...perOffer, ...compliance], offer),
  };
}

/**
 * Versões conferidas pela barreira de abordagem. Null se a barreira não estiver liberada para
 * esse escopo (quem chama já recebeu o motivo em `assessReadiness`).
 */
export function approachClearance(
  s: StrategySnapshot,
  today: string,
  scope: { offerId: string; icpId?: string },
  options: ReadinessOptions = {},
): ApproachClearance | null {
  const { approach } = assessReadiness(s, today, scope, options);
  if (!approach.ready) return null;
  const offer = s.offers.find((o) => o.id === scope.offerId);
  const rubric = s.rubrics.find((r) => r.offerId === scope.offerId);
  const scoring = s.scoringModels.find((m) => m.offerId === scope.offerId);
  const icp = scope.icpId ? s.icps.find((p) => p.id === scope.icpId) : undefined;
  const lia = effectiveLia(s.liaVersions, today);
  if (
    !offer?.current ||
    !rubric ||
    !scoring ||
    !s.voiceGuide ||
    !s.contactPolicy ||
    lia.status !== 'approved' ||
    (scope.icpId && !icp?.current)
  ) {
    return null;
  }
  return {
    offerId: offer.id,
    offerVersionId: offer.current.id,
    rubricVersionId: rubric.id,
    scoringModelVersionId: scoring.id,
    icpVersionId: icp?.current?.id ?? null,
    voiceGuideVersionId: s.voiceGuide.id,
    contactPolicyVersionId: s.contactPolicy.id,
    liaVersionId: lia.version.id,
  };
}

/** Versões conferidas pela barreira de descoberta do ICP. Null se não estiver liberada. */
export function discoveryClearance(
  s: StrategySnapshot,
  today: string,
  scope: { icpId: string },
): DiscoveryClearance | null {
  const { discover } = assessReadiness(s, today, scope);
  if (!discover.ready) return null;
  const icp = s.icps.find((p) => p.id === scope.icpId);
  const offer = s.offers.find((o) => o.id === icp?.offerId);
  const rubric = s.rubrics.find((r) => r.offerId === offer?.id);
  const scoring = s.scoringModels.find((m) => m.offerId === offer?.id);
  if (!icp?.current || !offer?.current || !rubric || !scoring) return null;
  return {
    offerId: offer.id,
    offerVersionId: offer.current.id,
    rubricVersionId: rubric.id,
    scoringModelVersionId: scoring.id,
    icpId: icp.id,
    icpVersionId: icp.current.id,
  };
}
