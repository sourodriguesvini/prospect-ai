import { AiReviewKind } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  adjustedSourcesText,
  AI_REVIEW_KIND_TEXT,
  NOTICE_TEXT,
  noticeTone,
  preparedOfferId,
} from './relationship-labels';
import { OPPORTUNITY_NOTICES } from './relationship-routes';

const OFFERS = [
  { value: 'oferta-a', label: 'Oferta A' },
  { value: 'oferta-b', label: 'Oferta B' },
];

describe('oferta marcada em "Preparar abordagem" (KI-129)', () => {
  it('a escolhida antes vale mais que a recomendada pelo diagnóstico', () => {
    expect(preparedOfferId(OFFERS, 'oferta-a', 'oferta-b')).toBe('oferta-a');
  });

  it('sem escolha, vale a recomendada pelo diagnóstico', () => {
    expect(preparedOfferId(OFFERS, null, 'oferta-b')).toBe('oferta-b');
  });

  it('oferta fora das ativas não é marcada', () => {
    expect(preparedOfferId(OFFERS, 'arquivada', 'inativa')).toBeNull();
    expect(preparedOfferId(OFFERS, null, null)).toBeNull();
  });
});

describe('avisos da conferência automática da IA (KI-150)', () => {
  it('cada tipo gravado tem texto em pt-BR, sem jargão interno', () => {
    for (const kind of AiReviewKind.options) {
      const text = AI_REVIEW_KIND_TEXT[kind];
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\b(claim|ref|guard|finding|prompt)\b/i);
    }
  });

  it('ajuste do sistema no singular e no plural', () => {
    expect(adjustedSourcesText(1)).toContain('uma menção de fonte');
    expect(adjustedSourcesText(2)).toContain('2 menções de fonte');
  });

  it('aviso de conferência aparece como alerta, inclusive no rascunho novo', () => {
    expect(noticeTone(OPPORTUNITY_NOTICES.messageCreatedReview)).toBe('warning');
    expect(noticeTone(OPPORTUNITY_NOTICES.preparedReview)).toBe('warning');
    expect(noticeTone(OPPORTUNITY_NOTICES.messageCreated)).toBe('success');
    expect(NOTICE_TEXT[OPPORTUNITY_NOTICES.messageCreatedReview]).toContain('cartão da mensagem');
  });
});
