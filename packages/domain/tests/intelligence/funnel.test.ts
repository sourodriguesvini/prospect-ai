import { FunnelStageView } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import { buildFunnel, FUNNEL_MIN_SAMPLE, tallyDistinct } from '../../src';

const tally = (count: number, demo = 0, capped = false) => ({ count, demo, capped });

describe('buildFunnel', () => {
  it('sempre devolve as sete etapas na ordem, com zero onde não há dado', () => {
    const funnel = buildFunnel({});
    expect(funnel.map((stage) => stage.stage)).toEqual([
      'found',
      'saved',
      'investigated',
      'approached',
      'contacted',
      'replied',
      'won',
    ]);
    expect(funnel.every((stage) => stage.count === 0 && stage.shareOfPrevious === null)).toBe(true);
    for (const stage of funnel) expect(FunnelStageView.safeParse(stage).success).toBe(true);
  });

  it('razão em relação à etapa anterior, com aviso abaixo da amostra mínima', () => {
    const funnel = buildFunnel({
      found: tally(40),
      saved: tally(10),
      investigated: tally(5),
    });
    expect(funnel[1]).toMatchObject({ count: 10, shareOfPrevious: 0.25, reliability: 'ok' });
    // A etapa anterior (10) está abaixo da amostra mínima.
    expect(funnel[2]).toMatchObject({ count: 5, shareOfPrevious: 0.5, reliability: 'small' });
    expect(FUNNEL_MIN_SAMPLE).toBeGreaterThan(10);
  });

  it('sem razão quando a anterior é zero ou quando passaria de 100% (funil por período)', () => {
    const funnel = buildFunnel({ found: tally(0), saved: tally(3), investigated: tally(5) });
    expect(funnel[1]).toMatchObject({ shareOfPrevious: null, reliability: 'none' });
    expect(funnel[2]).toMatchObject({ shareOfPrevious: null, reliability: 'none' });
  });

  it('sem razão quando uma das duas contagens parou no teto de leitura', () => {
    const funnel = buildFunnel({
      found: tally(1000, 0, true),
      saved: tally(40),
      investigated: tally(20),
    });
    expect(funnel[1]).toMatchObject({ shareOfPrevious: null, reliability: 'none' });
    expect(funnel[2]).toMatchObject({ shareOfPrevious: 0.5, reliability: 'ok' });
  });

  it('mantém demonstração e teto, e corrige contagem impossível', () => {
    const funnel = buildFunnel({ found: tally(5, 9, true), saved: tally(-3) });
    expect(funnel[0]).toMatchObject({ count: 5, demo: 5, capped: true });
    expect(funnel[1]).toMatchObject({ count: 0, demo: 0 });
  });
});

describe('tallyDistinct', () => {
  it('conta empresas distintas; demonstração se alguma linha da empresa for', () => {
    expect(
      tallyDistinct(
        [
          { companyId: 'a', isDemo: false },
          { companyId: 'a', isDemo: true },
          { companyId: 'b', isDemo: false },
        ],
        true,
      ),
    ).toEqual({ count: 2, demo: 1, capped: true });
  });
});
