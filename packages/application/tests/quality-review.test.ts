import { describe, expect, it } from 'vitest';
import { part8ReviewItems } from '../evals/review/part8-cases';
import {
  buildQualityReview,
  QUALITY_METRICS,
  qualityTallyMarkdown,
  tallyQualityReview,
  type QualityAnswer,
  type QualityReviewItem,
} from '../evals/review/quality-review';

/** Itens SINTÉTICOS para o teste da revisão humana (Parte 8). */
function item(
  partial: Partial<QualityReviewItem> & Pick<QualityReviewItem, 'id'>,
): QualityReviewItem {
  return {
    title: 'Caso de teste',
    synthetic: true,
    producedBy: 'regra de teste',
    recommendation: { key: 'approach', label: 'Vale preparar a abordagem', reason: 'Motivo.' },
    summary: [{ question: 'Quem é a empresa?', text: 'Uma empresa de teste.' }],
    principal: null,
    doNotOffer: [],
    toConfirm: [],
    sources: [],
    message: null,
    durationMs: null,
    durationNote: null,
    ...partial,
  };
}

describe('revisão humana da qualidade: página (Parte 8)', () => {
  it('tem as dez métricas lidas por pessoa; as de mensagem só quando há mensagem', () => {
    expect(QUALITY_METRICS).toHaveLength(10);
    const withMessage = buildQualityReview(
      [item({ id: 'a', message: { subject: 'Oi', body: 'Texto' } })],
      { title: 'T' },
    );
    const without = buildQualityReview([item({ id: 'a' })], { title: 'T' });
    for (const metric of QUALITY_METRICS) {
      expect(withMessage).toContain(`name="i1-${metric.key}"`);
      if (metric.needsMessage) expect(without).not.toContain(`name="i1-${metric.key}"`);
      else expect(without).toContain(`name="i1-${metric.key}"`);
    }
    expect(without).toContain('naturalidade e personalização ficam fora deste item');
    expect(without).toContain('A recomendação do sistema está certa?');
  });

  it('escapa o texto das análises, só faz link http(s) e não carrega nada de fora', () => {
    const html = buildQualityReview(
      [
        item({
          id: '</script><script>alert(1)</script>',
          title: '<img src=x onerror=alert(1)>',
          sources: [
            { label: 'Matéria', url: 'https://imprensa.test/materia' },
            { label: 'Perigoso', url: 'javascript:alert(1)' },
          ],
        }),
      ],
      { title: 'T' },
    );
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('href="https://imprensa.test/materia"');
    expect(html).not.toContain('href="javascript:');
    // O id vai para o script como JSON sem "<" cru: não fecha a tag.
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)="https?:/);
  });

  it('marca o caso sintético e mostra o tempo medido', () => {
    const html = buildQualityReview(
      [item({ id: 'a', durationMs: 1234, durationNote: 'só a regra' })],
      { title: 'T' },
    );
    expect(html).toContain('SINTÉTICO');
    expect(html).toContain('Tempo de resposta medido: 1,23 s (só a regra).');
  });
});

describe('revisão humana da qualidade: apuração (Parte 8)', () => {
  const items = [
    item({ id: 'a', durationMs: 100 }),
    item({ id: 'b', durationMs: 300 }),
    item({
      id: 'c',
      durationMs: 200,
      recommendation: { key: 'deprioritize', label: 'Não priorizar agora', reason: 'Motivo.' },
    }),
  ];

  it('médias por métrica, concordância, falsos positivos e tempo', () => {
    const answers: QualityAnswer[] = [
      {
        item: 'a',
        scores: { factual_precision: 5, freshness: 4, message_naturalness: null },
        recommendationRight: true,
        note: '',
      },
      { item: 'b', scores: { factual_precision: 2 }, recommendationRight: false, note: 'errada' },
      { item: 'c', scores: { factual_precision: 3 }, recommendationRight: false, note: '' },
      // Resposta de item que não está na página: ignorada.
      { item: 'z', scores: { factual_precision: 1 }, recommendationRight: false, note: '' },
    ];
    const tally = tallyQualityReview(items, answers);
    const factual = tally.metrics.find((metric) => metric.key === 'factual_precision');
    expect(factual).toMatchObject({ n: 3, mean: 3.333, lowShare: 0.333 });
    // "Não se aplica" não conta como nota.
    expect(tally.metrics.find((metric) => metric.key === 'message_naturalness')?.n).toBe(0);
    expect(tally.recommendation).toEqual({ answered: 3, agreed: 1, agreement: 0.333 });
    // Só recomendações de abordar contam como falso positivo: "b" errada entre "a" e "b".
    expect(tally.falsePositives).toEqual({ approachAnswered: 2, wrong: 1, rate: 0.5 });
    expect(tally.responseTime).toEqual({ n: 3, p50Ms: 200, p95Ms: 300 });
    expect(tally.answered).toBe(3);
    expect(tally.syntheticOnly).toBe(true);
    const md = qualityTallyMarkdown(tally);
    expect(md).toContain('**Só casos SINTÉTICOS.**');
    expect(md).toContain('| Precisão factual | 3 | 3,333 | 33% |');
    expect(md).toContain('limiar do doc 11 §4.3: 80%');
  });

  it('sem respostas, nada é inventado', () => {
    const tally = tallyQualityReview(items, []);
    expect(tally.answered).toBe(0);
    expect(tally.recommendation.agreement).toBeNull();
    expect(tally.falsePositives.rate).toBeNull();
    expect(tally.metrics.every((metric) => metric.mean === null)).toBe(true);
  });
});

describe('casos da Parte 8 na página de revisão', () => {
  it('passam pelas regras do app e saem com tese, resumo e fontes', () => {
    const cases = part8ReviewItems();
    expect(cases.map((entry) => entry.id)).toEqual([
      'caso-1-investimento',
      'caso-3-contratando',
      'caso-4-so-site',
      'caso-5-demanda',
      'caso-6-divergencia',
    ]);
    expect(cases.every((entry) => entry.synthetic)).toBe(true);
    const byId = Object.fromEntries(cases.map((entry) => [entry.id, entry]));
    expect(byId['caso-1-investimento']?.recommendation.key).toBe('approach');
    expect(byId['caso-4-so-site']?.recommendation.key).toBe('deprioritize');
    expect(byId['caso-5-demanda']?.principal?.problem).toContain('Demanda declarada pela empresa');
    expect(byId['caso-6-divergencia']?.recommendation.key).toBe('deepen_research');
    for (const entry of cases) {
      expect(entry.summary).toHaveLength(5);
      expect(entry.durationMs).not.toBeNull();
    }
    expect(buildQualityReview(cases, { title: 'T' })).toContain('caso-5-demanda');
  });
});
