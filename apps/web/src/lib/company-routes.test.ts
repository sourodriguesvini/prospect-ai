import type { AnalyzeProspectResult } from '@prospector/application';
import { describe, expect, it } from 'vitest';
import { COMPANY_NOTICES, WARNING_NOTICES, analyzeNotice, visibleNotice } from './company-routes';

/** Ids SINTÉTICOS de teste. */
const COMPANY = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';

const RESULTS: AnalyzeProspectResult[] = [
  { status: 'started', companyId: COMPANY, investigationId: RUN },
  { status: 'resumed', companyId: COMPANY, investigationId: RUN },
  { status: 'already_running', companyId: COMPANY, investigationId: null },
  { status: 'already_analyzed', companyId: COMPANY, investigationId: RUN },
  { status: 'not_started', companyId: COMPANY, reason: 'queue_full' },
  { status: 'not_started', companyId: COMPANY, reason: 'company_archived' },
  { status: 'not_started', companyId: COMPANY, reason: 'unavailable' },
];

describe('aviso depois de "Analisar empresa"', () => {
  it('cada resultado tem um aviso próprio', () => {
    const notices = RESULTS.map(analyzeNotice);
    expect(new Set(notices).size).toBe(RESULTS.length);
  });

  it('quando a análise não começou, o aviso é de atenção, nunca o verde de sucesso', () => {
    for (const result of RESULTS) {
      const warning = WARNING_NOTICES.includes(analyzeNotice(result));
      expect(warning).toBe(result.status === 'not_started');
    }
  });

  it('"já analisada" nunca diz que algo começou', () => {
    const notice = analyzeNotice(RESULTS[3]!);
    expect(notice).toBe(COMPANY_NOTICES.alreadyAnalyzed);
    expect(visibleNotice(notice, false)).toBe(notice);
  });

  it('"a análise começou" some quando a análise já terminou (a página se atualiza sozinha)', () => {
    for (const notice of [
      COMPANY_NOTICES.analysisStarted,
      COMPANY_NOTICES.analysisRunning,
      COMPANY_NOTICES.investigationStarted,
      COMPANY_NOTICES.investigationResumed,
    ]) {
      expect(visibleNotice(notice, true)).toBe(notice);
      expect(visibleNotice(notice, false)).toBeUndefined();
    }
    expect(visibleNotice(COMPANY_NOTICES.analysisQueueFull, false)).toBe(
      COMPANY_NOTICES.analysisQueueFull,
    );
    expect(visibleNotice(undefined, true)).toBeUndefined();
  });
});
