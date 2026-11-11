import { describe, expect, it } from 'vitest';
import {
  DRAFT_SCORING_MODEL,
  assessProspect,
  formatPartialDate,
  segmentMatches,
  signalConfidence,
  signalFingerprintText,
  signalRecency,
  signalVerification,
  triageWeights,
  type TriageInput,
  type TriageSignal,
} from '../../src';

const NOW = new Date('2026-11-11T12:00:00Z');
const SITE_SOURCE = '00000000-0000-4000-8000-000000000001';
const NEWS_SOURCE = '00000000-0000-4000-8000-000000000002';

function input(overrides: Partial<TriageInput> = {}): TriageInput {
  return {
    name: 'Clínica Vida Plena',
    domain: 'vidaplena.com.br',
    hasOfficialSite: true,
    siteVerified: true,
    officialSiteSourceId: SITE_SOURCE,
    segment: 'Clínica médica',
    description: 'Clínica de saúde com especialidades.',
    city: 'Ribeirão Preto',
    uf: 'SP',
    cnpj: null,
    sources: [{ id: SITE_SOURCE, relation: 'official_site' }],
    signals: [],
    wanted: {
      segment: 'clínicas',
      segmentTerms: ['clínica', 'saúde'],
      cities: ['Ribeirão Preto'],
      ufs: ['SP'],
      signals: [],
    },
    icp: null,
    scoring: null,
    companyLifecycle: null,
    sizeBand: null,
    now: NOW,
    ...overrides,
  };
}

const expansion: TriageSignal = {
  type: 'expansion',
  verification: 'confirmed',
  relevance: 'high',
  recency: 'recent',
  sourceId: NEWS_SOURCE,
  summary: 'Anunciou uma nova unidade em Franca.',
};

describe('sinais', () => {
  it('usa a data do acontecimento antes da publicação e nunca a data da descoberta', () => {
    expect(signalRecency('2026-09', null, NOW)).toBe('recent');
    expect(signalRecency('2024-03-10', '2026-11-01', NOW)).toBe('older');
    expect(signalRecency(null, '2026-10-20', NOW)).toBe('recent');
    expect(signalRecency(null, null, NOW)).toBe('unknown');
  });

  it('não chama de recente um ano inteiro que a janela corta ao meio', () => {
    expect(signalRecency('2026', null, NOW)).toBe('unknown');
    expect(signalRecency('2024', null, NOW)).toBe('older');
  });

  it('confirma só com trecho conferido, direto e de fonte primária', () => {
    const base = {
      relation: 'news' as const,
      quoteVerified: true,
      explicit: true,
      recency: 'recent' as const,
    };
    expect(signalVerification(base)).toBe('confirmed');
    expect(signalVerification({ ...base, explicit: false })).toBe('hypothesis');
    expect(signalVerification({ ...base, relation: 'directory' })).toBe('hypothesis');
    expect(signalVerification({ ...base, quoteVerified: false })).toBe('hypothesis');
  });

  it('calcula a confiança no servidor e zera trecho não conferido', () => {
    const base = {
      relation: 'official_site' as const,
      quoteVerified: true,
      explicit: true,
      recency: 'recent' as const,
    };
    expect(signalConfidence(base)).toBe(0.85);
    expect(signalConfidence({ ...base, explicit: false, recency: 'older' })).toBe(0.42);
    expect(signalConfidence({ ...base, quoteVerified: false })).toBe(0);
  });

  it('gera a mesma impressão digital para o mesmo acontecimento na mesma página', () => {
    const a = signalFingerprintText({
      prospectId: 'p',
      type: 'hiring',
      url: 'https://www.x.com.br/vagas/#topo',
    });
    const b = signalFingerprintText({
      prospectId: 'p',
      type: 'hiring',
      url: 'https://x.com.br/vagas',
    });
    expect(a).toBe(b);
  });

  it('formata datas parciais em pt-BR', () => {
    expect(formatPartialDate('2026-03')).toBe('março de 2026');
    expect(formatPartialDate('2026-03-05')).toBe('05/03/2026');
    expect(formatPartialDate('2026')).toBe('2026');
  });
});

describe('triagem discovery-triage/v1', () => {
  it('tira "necessidade" dos pesos do modelo de score e renormaliza', () => {
    const weights = triageWeights(DRAFT_SCORING_MODEL.weights);
    expect(weights).toEqual({ fit: 0.357, signal: 0.286, timing: 0.143, capacity: 0.214 });
    expect(triageWeights({ fit: 0, need: 100, signal: 0, capacity: 0, timing: 0 })).toEqual(
      triageWeights(null),
    );
  });

  it('reconhece o segmento com plural e acento', () => {
    expect(segmentMatches('Clínicas odontológicas', ['clinica'])).toBe(true);
    expect(segmentMatches('Restaurante italiano', ['clínica', 'saúde'])).toBe(false);
  });

  it('dá prioridade alta com aderência, site conferido e sinal recente confirmado', () => {
    const result = assessProspect(input({ signals: [expansion] }));
    expect(result.priority).toBe('high');
    expect(result.priorityScore).toBeGreaterThanOrEqual(70);
    expect(result.confidence).toBe('high');
    expect(result.assessment.rubric).toBe('discovery-triage/v1');
    expect(result.assessment.coverage).toBe(1);
    // Todo motivo de sinal aponta a fonte.
    const signalReason = result.assessment.reasons.find((reason) =>
      reason.text.startsWith('Expansão'),
    );
    expect(signalReason?.sourceIds).toEqual([NEWS_SOURCE]);
  });

  it('dá prioridade média para empresa aderente sem sinais, e diz o que falta', () => {
    const result = assessProspect(input());
    expect(result.priority).toBe('medium');
    expect(result.assessment.dimensions.signal).toBeNull();
    expect(result.assessment.missing).toContain(
      'Procurar sinais comerciais recentes (expansão, vagas, lançamentos).',
    );
    expect(result.confidence).toBe('medium');
  });

  it('marca informações insuficientes quando só se sabe o nome num guia', () => {
    const result = assessProspect(
      input({
        domain: null,
        hasOfficialSite: false,
        siteVerified: false,
        officialSiteSourceId: null,
        segment: null,
        description: null,
        name: 'Espaço Bem Viver',
        sources: [{ id: NEWS_SOURCE, relation: 'directory' }],
      }),
    );
    expect(result.priority).toBe('insufficient');
    expect(result.priorityScore).toBeNull();
    expect(result.confidence).toBe('low');
    expect(result.assessment.missing[0]).toBe('Encontrar o site oficial da empresa.');
  });

  it('baixa a prioridade de quem está fora da região pedida', () => {
    const result = assessProspect(input({ city: 'Curitiba', uf: 'PR' }));
    expect(result.assessment.dimensions.fit).toBeLessThan(60);
    expect(result.assessment.reasons.some((reason) => reason.text.includes('fora da região'))).toBe(
      true,
    );
  });

  it('separa sinal confirmado de hipótese na pontuação', () => {
    const confirmed = assessProspect(input({ signals: [expansion] }));
    const hypothesis = assessProspect(
      input({ signals: [{ ...expansion, verification: 'hypothesis' }] }),
    );
    expect(hypothesis.priorityScore ?? 0).toBeLessThan(confirmed.priorityScore ?? 0);
    expect(hypothesis.assessment.missing).toContain('Confirmar os sinais marcados como hipótese.');
  });

  it('bloqueia exclusões do ICP e clientes atuais, explicando o motivo', () => {
    const excluded = assessProspect(
      input({
        signals: [expansion],
        icp: {
          versionId: '00000000-0000-4000-8000-0000000000aa',
          ufs: [],
          municipalities: [],
          exclusions: { domains: ['vidaplena.com.br'], cnpjRoots: [], municipalities: [] },
        },
      }),
    );
    expect(excluded.priority).toBe('low');
    expect(excluded.assessment.gates).toEqual([
      'O domínio vidaplena.com.br está nas exclusões do ICP.',
    ]);
    expect(excluded.assessment.icpVersionId).toBe('00000000-0000-4000-8000-0000000000aa');

    const customer = assessProspect(input({ companyLifecycle: 'customer' }));
    expect(customer.priority).toBe('low');
    expect(customer.assessment.gates).toContain('Já é cliente (módulo Empresas).');
  });

  it('usa a região do ICP quando o pedido não tem região', () => {
    const result = assessProspect(
      input({
        wanted: { segment: null, segmentTerms: ['clínica'], cities: [], ufs: [], signals: [] },
        icp: {
          versionId: '00000000-0000-4000-8000-0000000000aa',
          ufs: ['PR'],
          municipalities: [],
          exclusions: { domains: [], cnpjRoots: [], municipalities: [] },
        },
      }),
    );
    expect(result.assessment.reasons.some((reason) => reason.text.includes('fora da região'))).toBe(
      true,
    );
  });

  it('com portes no ICP, o porte pontua pela aderência (não por "maior é melhor")', () => {
    const icp = (sizes: Array<'me' | 'epp' | 'demais'>) => ({
      versionId: '00000000-0000-4000-8000-0000000000aa',
      ufs: [],
      municipalities: [],
      sizes,
      exclusions: { domains: [], cnpjRoots: [], municipalities: [] },
    });
    const small = assessProspect(input({ sizeBand: 'me', icp: icp(['me']) }));
    const big = assessProspect(input({ sizeBand: 'demais', icp: icp(['me']) }));
    expect(small.assessment.dimensions.capacity).toBe(85);
    expect(big.assessment.dimensions.capacity).toBe(25);
    expect(
      big.assessment.reasons.some((reason) => reason.text.includes('fora dos portes do perfil')),
    ).toBe(true);
    // Sem portes no ICP, continua a régua padrão.
    expect(
      assessProspect(input({ sizeBand: 'me', icp: icp([]) })).assessment.dimensions.capacity,
    ).toBe(40);
  });

  it('é determinística: mesma entrada, mesma triagem', () => {
    expect(assessProspect(input({ signals: [expansion] }))).toEqual(
      assessProspect(input({ signals: [expansion] })),
    );
  });
});
