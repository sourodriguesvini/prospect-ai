import type { LiaVersion } from '@prospector/contracts';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  effectiveLia,
  liaApprovalIssues,
  liaRevocationIssues,
  liaStatus,
  MAX_LIA_REVIEW_MONTHS,
} from '../../src';

const TODAY = '2026-11-09';

const content = {
  purpose: 'Prospecção B2B de serviços de branding.',
  legitimateInterest: 'Oferecer serviço relevante a empresas com necessidade observável.',
  necessity: 'Só nome, cargo e e-mail corporativo de quem decide.',
  dataCategories: ['name' as const, 'work_email' as const],
  dataSources: ['company_website' as const],
  expectations: 'Contato profissional relacionado à atividade da empresa.',
  risks: 'Incômodo com contato não solicitado.',
  safeguards: 'Opt-out em toda mensagem; supressão imediata.',
  conclusion: 'Interesse legítimo prevalece com as salvaguardas.',
};

function lia(version: number, overrides: Partial<LiaVersion> = {}): LiaVersion {
  return {
    id: `00000000-0000-4000-8000-00000000000${version}`,
    version,
    content,
    createdAt: '2026-11-01T12:00:00Z',
    approvedAt: null,
    reviewDueOn: null,
    revokedAt: null,
    ...overrides,
  };
}

const approved = (version: number, approvedAt: string, reviewDueOn = '2027-11-09') =>
  lia(version, { approvedAt, reviewDueOn });

describe('addMonths', () => {
  it('soma meses respeitando o fim do mês', () => {
    expect(addMonths('2026-11-09', 12)).toBe('2027-11-09');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
  });
});

describe('addDays', () => {
  it('soma dias atravessando mês e ano', () => {
    expect(addDays('2026-11-09', 1)).toBe('2026-11-10');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('LIA efetiva', () => {
  it('sem versões: nenhuma', () => {
    expect(effectiveLia([], TODAY)).toEqual({ status: 'none', version: null });
  });

  it('só rascunhos: pendente', () => {
    expect(effectiveLia([lia(1), lia(2)], TODAY).status).toBe('pending');
  });

  it('a última aprovada vale, mesmo com rascunho mais novo', () => {
    const result = effectiveLia([approved(1, '2026-11-02T10:00:00Z'), lia(2)], TODAY);
    expect(result.status).toBe('approved');
    expect(result.version?.version).toBe(1);
  });

  it('revogar a última aprovada bloqueia: não volta para uma aprovação anterior', () => {
    const versions = [
      approved(1, '2026-10-01T10:00:00Z'),
      lia(2, {
        approvedAt: '2026-11-02T10:00:00Z',
        reviewDueOn: '2027-11-01',
        revokedAt: '2026-11-05T10:00:00Z',
      }),
    ];
    const result = effectiveLia(versions, TODAY);
    expect(result.status).toBe('revoked');
    expect(result.version?.version).toBe(2);
  });

  it('revisão vencida bloqueia', () => {
    const result = effectiveLia([approved(1, '2025-11-02T10:00:00Z', '2026-11-08')], TODAY);
    expect(result.status).toBe('expired');
  });

  it('no dia da revisão ainda vale', () => {
    expect(effectiveLia([approved(1, '2025-11-02T10:00:00Z', TODAY)], TODAY).status).toBe(
      'approved',
    );
  });
});

describe('status por versão', () => {
  it('rascunho, aprovada, substituída, revogada e vencida', () => {
    const v1 = approved(1, '2026-10-01T10:00:00Z');
    const v2 = approved(2, '2026-11-02T10:00:00Z');
    const v3 = lia(3);
    const all = [v1, v2, v3];
    expect(liaStatus(v1, all, TODAY)).toBe('superseded');
    expect(liaStatus(v2, all, TODAY)).toBe('approved');
    expect(liaStatus(v3, all, TODAY)).toBe('draft');
    expect(liaStatus(lia(4, { approvedAt: 'x', revokedAt: 'y' }), all, TODAY)).toBe('revoked');
    expect(liaStatus(approved(5, 'x', '2026-01-01'), [], TODAY)).toBe('expired');
  });
});

describe('aprovação', () => {
  it('aprova a versão mais recente com revisão dentro do prazo', () => {
    expect(liaApprovalIssues(lia(2), [lia(1), lia(2)], '2027-11-09', TODAY)).toEqual([]);
  });

  it('só a versão mais recente pode ser aprovada', () => {
    const issues = liaApprovalIssues(lia(1), [lia(1), lia(2)], '2027-11-09', TODAY);
    expect(issues.map((i) => i.code)).toEqual(['lia_not_latest']);
  });

  it('não aprova duas vezes', () => {
    const v1 = approved(1, '2026-11-02T10:00:00Z');
    expect(liaApprovalIssues(v1, [v1], '2027-11-09', TODAY).map((i) => i.code)).toEqual([
      'lia_already_decided',
    ]);
  });

  it('data de revisão precisa estar no futuro e em até 24 meses', () => {
    expect(MAX_LIA_REVIEW_MONTHS).toBe(24);
    expect(liaApprovalIssues(lia(1), [lia(1)], TODAY, TODAY).map((i) => i.field)).toEqual([
      'reviewDueOn',
    ]);
    expect(liaApprovalIssues(lia(1), [lia(1)], '2028-11-10', TODAY).map((i) => i.field)).toEqual([
      'reviewDueOn',
    ]);
    expect(liaApprovalIssues(lia(1), [lia(1)], '2028-11-09', TODAY)).toEqual([]);
  });
});

describe('revogação', () => {
  it('revoga só a LIA em vigor', () => {
    const v1 = approved(1, '2026-10-01T10:00:00Z');
    const v2 = approved(2, '2026-11-02T10:00:00Z');
    expect(liaRevocationIssues(v2, [v1, v2])).toEqual([]);
    expect(liaRevocationIssues(v1, [v1, v2]).map((i) => i.code)).toEqual(['lia_not_effective']);
    expect(liaRevocationIssues(lia(3), [v1, v2]).map((i) => i.code)).toEqual(['lia_not_effective']);
  });

  it('não revoga duas vezes', () => {
    const v1 = lia(1, { approvedAt: 'a', reviewDueOn: '2027-01-01', revokedAt: 'b' });
    expect(liaRevocationIssues(v1, [v1]).map((i) => i.code)).toEqual(['lia_already_decided']);
  });
});
