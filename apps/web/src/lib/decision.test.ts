import { CONFIDENCE_BAND_THRESHOLDS } from '@prospector/domain';
import type { CommercialThesis, Diagnosis, OfferAssessment } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  RECOMMENDATION_SHORT,
  RECOMMENDATION_VIEW,
  decisionNext,
  recommendedOffer,
  securityLevel,
  thesisCaveat,
  undiagnosedState,
  verdictChanges,
  type ContactSituation,
} from './decision';

const FREE: ContactSituation = { suppressions: [], openOpportunityId: null };

/** Dados SINTÉTICOS: ofertas de teste. */
function offer(id: string, recommendation: OfferAssessment['recommendation']): OfferAssessment {
  return { offerId: id, offerName: `Oferta ${id}`, recommendation } as OfferAssessment;
}

function diagnosis(offers: OfferAssessment[], recommendedOfferId: string | null): Diagnosis {
  return { offers, recommendedOfferId } as Diagnosis;
}

describe('próximo passo do topo "Vale abordar?"', () => {
  it('quem pediu para não ser contatado nunca recebe "Preparar mensagem" (regra 7)', () => {
    const contact = {
      suppressions: [{ reason: 'opt_out', createdAt: '2026-11-20T00:00:00.000Z' }],
      openOpportunityId: 'op-1',
    };
    for (const recommendation of Object.keys(
      RECOMMENDATION_VIEW,
    ) as (keyof typeof RECOMMENDATION_VIEW)[]) {
      expect(decisionNext({ recommendation, lifecycle: 'qualified', contact })).toEqual({
        kind: 'suppressed',
      });
    }
  });

  it('conversa aberta leva à conversa; arquivada ou descartada não sugere abordar', () => {
    expect(
      decisionNext({
        recommendation: 'pursue',
        lifecycle: 'engaged',
        contact: { suppressions: [], openOpportunityId: 'op-1' },
      }),
    ).toEqual({ kind: 'open_conversation', opportunityId: 'op-1' });
    expect(
      decisionNext({ recommendation: 'pursue', lifecycle: 'archived', contact: FREE }),
    ).toEqual({ kind: 'archived' });
    expect(
      decisionNext({ recommendation: 'pursue', lifecycle: 'disqualified', contact: FREE }),
    ).toEqual({ kind: 'disqualified' });
  });

  it('segue a recomendação quando nada impede; sem conseguir ler o contato, não oferece mensagem', () => {
    expect(
      decisionNext({ recommendation: 'pursue', lifecycle: 'qualified', contact: FREE }),
    ).toEqual({ kind: 'prepare_message' });
    expect(
      decisionNext({ recommendation: 'prepare_access', lifecycle: 'qualified', contact: null }),
    ).toEqual({ kind: 'none' });
    expect(
      decisionNext({ recommendation: 'investigate_more', lifecycle: 'qualified', contact: null }),
    ).toEqual({ kind: 'complete_analysis' });
    expect(
      decisionNext({ recommendation: 'monitor', lifecycle: 'qualified', contact: FREE }),
    ).toEqual({ kind: 'watch' });
  });

  it('sem diagnóstico, diz se a análise nunca rodou, parou no meio ou foi cancelada', () => {
    expect(undiagnosedState(null)).toBe('never');
    expect(undiagnosedState({ status: 'failed' })).toBe('unfinished');
    expect(undiagnosedState({ status: 'interrupted' })).toBe('unfinished');
    expect(undiagnosedState({ status: 'cancelled' })).toBe('cancelled');
    expect(undiagnosedState({ status: 'partial' })).toBe('no_conclusion');
  });
});

describe('leitura comercial do diagnóstico', () => {
  it('trata "preparar acesso" como oportunidade boa: a falta de contato é outra dimensão', () => {
    expect(RECOMMENDATION_VIEW.prepare_access.tone).toBe('positive');
    expect(RECOMMENDATION_VIEW.prepare_access.action).toBe('prepare_message');
    expect(RECOMMENDATION_VIEW.prepare_access.headline).not.toMatch(/acesso|contato/i);
  });

  it('cobre as seis recomendações com rótulo curto e ação', () => {
    expect(Object.keys(RECOMMENDATION_VIEW).sort()).toEqual(
      Object.keys(RECOMMENDATION_SHORT).sort(),
    );
    expect(Object.keys(RECOMMENDATION_VIEW)).toHaveLength(6);
  });

  it('usa a oferta recomendada; sem ela, a primeira que não foi descartada', () => {
    const offers = [offer('a', 'discard'), offer('b', 'prepare_access'), offer('c', 'pursue')];
    expect(recommendedOffer(diagnosis(offers, 'c'))?.offerId).toBe('c');
    expect(recommendedOffer(diagnosis(offers, null))?.offerId).toBe('b');
    expect(recommendedOffer(diagnosis([offer('a', 'discard')], null))).toBeNull();
  });

  it('segurança da análise usa os mesmos cortes do selo de confiança das evidências', () => {
    expect(securityLevel(CONFIDENCE_BAND_THRESHOLDS.high * 100)).toBe('high');
    expect(securityLevel(CONFIDENCE_BAND_THRESHOLDS.high * 100 - 1)).toBe('medium');
    expect(securityLevel(CONFIDENCE_BAND_THRESHOLDS.medium * 100)).toBe('medium');
    expect(securityLevel(CONFIDENCE_BAND_THRESHOLDS.medium * 100 - 1)).toBe('low');
  });
});

describe('ressalva da tese no topo (validação do Flash, 27/11)', () => {
  /** Tese SINTÉTICA, só com o que a ressalva lê. */
  const thesis = (recommendation: CommercialThesis['recommendation']) =>
    ({
      recommendation,
      recommendationReason:
        'Nenhum acontecimento encontrado: não há base para uma tese. Vale pesquisar mais antes de decidir.',
      principal: recommendation === 'approach' ? { title: 'Marca para o novo momento' } : null,
    }) as CommercialThesis;

  it('título "Vale abordar" com tese que pede cautela: a tese aparece como ressalva', () => {
    expect(thesisCaveat('pursue', thesis('deepen_research'))).toBe(
      'Ressalva da tese comercial: vale aprofundar a pesquisa antes. Nenhum acontecimento encontrado: não há base para uma tese. Vale pesquisar mais antes de decidir.',
    );
  });

  it('título de espera com tese que vê ângulo: avisa', () => {
    expect(thesisCaveat('monitor', thesis('approach'))).toContain('Marca para o novo momento');
  });

  it('sem tese ou com as duas de acordo, nada', () => {
    expect(thesisCaveat('pursue', null)).toBeNull();
    expect(thesisCaveat('pursue', thesis('approach'))).toBeNull();
    expect(thesisCaveat('discard', thesis('deprioritize'))).toBeNull();
  });
});

describe('O que mudou: veredito e tese (validação do Flash, 27/11)', () => {
  const diag = (
    recommendation: Diagnosis['recommendation'],
    thesis: CommercialThesis['recommendation'] | null,
  ) => ({ recommendation, thesis: thesis ? { recommendation: thesis } : null }) as Diagnosis;

  it('diz quando o veredito e a tese mudaram, com as palavras do topo', () => {
    expect(
      verdictChanges(diag('investigate_more', 'deprioritize'), diag('prepare_access', 'approach')),
    ).toEqual([
      'O veredito mudou de “Falta informação para decidir” para “Vale abordar”.',
      'A tese comercial mudou de “Não priorizar agora” para “Vale preparar a abordagem”.',
    ]);
  });

  it('sem análise anterior com diagnóstico, ou sem mudança, nada', () => {
    expect(verdictChanges(null, diag('pursue', 'approach'))).toEqual([]);
    expect(verdictChanges(diag('pursue', null), diag('pursue', 'approach'))).toEqual([]);
  });
});
