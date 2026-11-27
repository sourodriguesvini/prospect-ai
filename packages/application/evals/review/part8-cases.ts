import {
  BusinessEvent,
  CommercialThesis,
  THESIS_RECOMMENDATION_LABELS,
  type CommercialProfile,
} from '@prospector/contracts';
import {
  buildCommercialThesis,
  executiveSummary,
  extractDemand,
  extractFunding,
  FOUND_STUDIO_PROFILE,
  type EventEvidence,
  type ReportClaim,
  type SiteSignalEvidence,
} from '@prospector/domain';
import type { QualityReviewItem } from './quality-review';

/**
 * Casos da Parte 8 com dados SINTÉTICOS (domínios .test e matérias inventadas para o teste, datas
 * relativas a 26/11/2026), passados pelas mesmas regras que o app usa: tese comercial
 * (`compatibility/v1`) e resumo executivo. Servem para a pessoa calibrar a régua antes de revisar
 * análises reais; nenhum deles é empresa real.
 */

const NOW = new Date('2026-11-26T12:00:00Z');
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function event(partial: Partial<BusinessEvent> & Pick<BusinessEvent, 'type'>): BusinessEvent {
  return BusinessEvent.parse({
    occurredOn: '2026-08-19',
    dateBasis: 'published',
    headline: 'Acontecimento',
    url: 'https://imprensa.test/materia',
    host: 'imprensa.test',
    sourceTier: 'recognized_press',
    republishedBy: [],
    confirmedBy: [],
    conflicts: [],
    pageRead: true,
    funding: null,
    ...partial,
  });
}

const SITE: SiteSignalEvidence[] = [
  {
    signal: 'site_accessibility',
    claimIds: [id(90)],
    detail: '24 de 139 textos com contraste baixo',
  },
  { signal: 'site_mobile', claimIds: [id(91)], detail: '48 alvos de toque pequenos no celular' },
];

interface Part8Case {
  readonly id: string;
  readonly title: string;
  readonly companyName: string;
  readonly claims: readonly ReportClaim[];
  readonly events: readonly EventEvidence[];
  readonly siteSignals: readonly SiteSignalEvidence[];
  readonly contactKnown: boolean;
}

const DEMAND_POST =
  'A Casa Aurora procura um estúdio para refazer a identidade visual antes do lançamento da nova linha de móveis. ' +
  'Envie seu portfólio para compras@casaaurora.test até 15/12.';

const CASES: readonly Part8Case[] = [
  {
    id: 'caso-1-investimento',
    title: 'Caso 1 — empresa que recebeu investimento (inspirado na Flash)',
    companyName: 'Fintech Exemplo',
    claims: [
      {
        key: 'positioning.value_proposition',
        statement: 'Plataforma de benefícios e gestão de pessoas para empresas.',
      },
    ],
    events: [
      {
        claimId: id(1),
        epistemicType: 'fact',
        event: event({
          type: 'funding',
          headline: 'A Fintech Exemplo não precisava de dinheiro, mas levantou R$ 150 milhões',
          confirmedBy: ['outra-imprensa.test'],
          funding: extractFunding(
            'A Fintech Exemplo levantou R$ 150 milhões em rodada Série D liderada pela Fundo Exemplo. Segundo o fundador, a empresa não precisava de dinheiro.',
          ),
        }),
      },
      {
        claimId: id(2),
        epistemicType: 'fact',
        event: event({
          type: 'launch',
          occurredOn: '2026-10-02',
          headline: 'Fintech Exemplo lança nova plataforma de contratação com IA',
          url: 'https://fintech-exemplo.test/novidades',
          host: 'fintech-exemplo.test',
          sourceTier: 'official',
        }),
      },
    ],
    siteSignals: SITE,
    contactKnown: false,
  },
  {
    id: 'caso-3-contratando',
    title: 'Caso 3 — startup contratando produto e tecnologia',
    companyName: 'Acme',
    claims: [],
    events: [
      {
        claimId: id(3),
        epistemicType: 'fact',
        event: event({
          type: 'hiring',
          occurredOn: '2026-11-01',
          headline: 'Acme abre vagas de Product Manager e engenharia',
          url: 'https://acme.test/carreiras',
          host: 'acme.test',
          sourceTier: 'official',
        }),
      },
      {
        claimId: id(4),
        epistemicType: 'fact',
        event: event({
          type: 'leadership',
          occurredOn: '2026-09-15',
          headline: 'Acme anuncia nova CPO',
        }),
      },
    ],
    siteSignals: [],
    contactKnown: true,
  },
  {
    id: 'caso-4-so-site',
    title: 'Caso 4 — só problema de site',
    companyName: 'Loja Exemplo',
    claims: [],
    events: [],
    siteSignals: SITE,
    contactKnown: true,
  },
  {
    id: 'caso-5-demanda',
    title: 'Caso 5 — demanda declarada pela empresa',
    companyName: 'Casa Aurora',
    claims: [],
    events: [
      {
        claimId: id(5),
        epistemicType: 'fact',
        event: event({
          type: 'explicit_demand',
          occurredOn: '2026-11-20',
          headline: 'A Casa Aurora procura um estúdio para refazer a identidade visual',
          url: 'https://casaaurora.test/novidades/estudio',
          host: 'casaaurora.test',
          sourceTier: 'official',
          demand: extractDemand(DEMAND_POST, '2026-11-20', ['casaaurora.test']),
        }),
      },
    ],
    siteSignals: [SITE[0]!],
    contactKnown: true,
  },
  {
    id: 'caso-6-divergencia',
    title: 'Caso 6 — fontes contraditórias',
    companyName: 'Beta',
    claims: [],
    events: [
      {
        claimId: id(6),
        epistemicType: 'fact',
        event: event({
          type: 'funding',
          headline: 'Beta recebe aporte para expandir',
          conflicts: [
            'Valores diferentes entre as fontes: R$ 150 milhões (imprensa.test) e R$ 120 milhões (outra.test).',
          ],
        }),
      },
    ],
    siteSignals: [],
    contactKnown: false,
  },
];

/** Os casos da Parte 8 prontos para a página de revisão (perfil Found Studio). */
export function part8ReviewItems(
  profile: CommercialProfile = FOUND_STUDIO_PROFILE,
): QualityReviewItem[] {
  return CASES.map((item) => {
    const started = performance.now();
    const thesis = CommercialThesis.parse(
      buildCommercialThesis({
        profile,
        companyName: item.companyName,
        events: [...item.events],
        siteSignals: [...item.siteSignals],
        contactKnown: item.contactKnown,
        now: NOW,
      }),
    );
    const summary = executiveSummary({
      claims: item.claims,
      events: item.events,
      thesis,
      fallbackOffer: null,
      contactBlocked: false,
    });
    const durationMs = Math.round((performance.now() - started) * 100) / 100;
    const principal = thesis.principal;
    const sources = item.events.map(({ event: found }) => ({
      label: found.headline,
      url: found.url,
    }));
    return {
      id: item.id,
      title: item.title,
      synthetic: true,
      producedBy: `regra ${thesis.version} (perfil ${profile.name}), sem modelo`,
      recommendation: {
        key: thesis.recommendation,
        label: THESIS_RECOMMENDATION_LABELS[thesis.recommendation],
        reason: thesis.recommendationReason,
      },
      summary: summary.map((answer) => ({ question: answer.label, text: answer.text })),
      principal: principal
        ? {
            title: principal.title,
            problem: principal.problem,
            whyNow: principal.whyNow,
            offer: principal.offer,
            approachRole: principal.approachRole,
            openingTopic: principal.openingTopic,
          }
        : null,
      doNotOffer: thesis.doNotOffer.map((entry) => `${entry.item}: ${entry.reason}`),
      toConfirm: thesis.toConfirm,
      sources,
      message: null,
      durationMs,
      durationNote: 'só a regra da tese e do resumo, sem busca na internet nem modelo',
    };
  });
}
