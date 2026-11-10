import type { LiaVersion } from '@prospector/contracts';
import type { Issue } from './rules';

/**
 * LIA (avaliação de legítimo interesse, docs/12 §4). Cada versão tem conteúdo imutável; a
 * aprovação e a revogação acontecem uma vez cada. Vale a ÚLTIMA versão aprovada: se ela for
 * revogada ou vencer a revisão, a abordagem fica bloqueada (não volta para uma aprovação antiga).
 * Datas de calendário em AAAA-MM-DD, comparadas como texto.
 */

/** Teto técnico entre a aprovação e a próxima revisão (igual ao do banco; decidido em 2026-11-10). */
export const MAX_LIA_REVIEW_MONTHS = 24;
/** Prazo padrão no formulário de aprovação (decidido em 2026-11-10; até haver parecer, até 12). */
export const DEFAULT_LIA_REVIEW_MONTHS = 12;

export type LiaStatus = 'draft' | 'approved' | 'expired' | 'revoked' | 'superseded';

export type EffectiveLia =
  | { status: 'none' | 'pending'; version: null }
  | { status: 'approved' | 'expired' | 'revoked'; version: LiaVersion };

/** Soma meses a uma data AAAA-MM-DD, encostando no último dia do mês quando preciso. */
export function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const totalMonths = y * 12 + (m - 1) + months;
  const year = Math.floor(totalMonths / 12);
  const month = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Soma dias a uma data AAAA-MM-DD (calendário, sem fuso). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** AAAA-MM-DD → DD/MM/AAAA. */
export function formatCalendarDate(date: string): string {
  const [y, m, d] = date.split('-');
  return y && m && d ? `${d}/${m}/${y}` : date;
}

function latestApproved(versions: readonly LiaVersion[]): LiaVersion | null {
  let latest: LiaVersion | null = null;
  for (const v of versions) {
    if (!v.approvedAt) continue;
    if (
      !latest ||
      v.approvedAt > (latest.approvedAt ?? '') ||
      (v.approvedAt === latest.approvedAt && v.version > latest.version)
    ) {
      latest = v;
    }
  }
  return latest;
}

export function effectiveLia(versions: readonly LiaVersion[], today: string): EffectiveLia {
  const latest = latestApproved(versions);
  if (!latest) {
    return { status: versions.length > 0 ? 'pending' : 'none', version: null };
  }
  if (latest.revokedAt) return { status: 'revoked', version: latest };
  if (latest.reviewDueOn && latest.reviewDueOn < today) {
    return { status: 'expired', version: latest };
  }
  return { status: 'approved', version: latest };
}

export function liaStatus(
  version: LiaVersion,
  all: readonly LiaVersion[],
  today: string,
): LiaStatus {
  if (!version.approvedAt) return 'draft';
  if (version.revokedAt) return 'revoked';
  const latest = latestApproved(all);
  if (latest && latest.id !== version.id) return 'superseded';
  if (version.reviewDueOn && version.reviewDueOn < today) return 'expired';
  return 'approved';
}

export function liaApprovalIssues(
  target: LiaVersion,
  all: readonly LiaVersion[],
  reviewDueOn: string,
  today: string,
): Issue[] {
  if (target.approvedAt || target.revokedAt) {
    return [
      {
        field: '_form',
        code: 'lia_already_decided',
        message: 'Esta versão já foi aprovada. Para mudar, salve uma nova versão.',
      },
    ];
  }
  const newest = Math.max(...all.map((v) => v.version), target.version);
  if (target.version !== newest) {
    return [
      {
        field: '_form',
        code: 'lia_not_latest',
        message: 'Só a versão mais recente da LIA pode ser aprovada.',
      },
    ];
  }
  const limit = addMonths(today, MAX_LIA_REVIEW_MONTHS);
  if (reviewDueOn <= today || reviewDueOn > limit) {
    return [
      {
        field: 'reviewDueOn',
        code: 'review_date_out_of_range',
        message: `Escolha uma data de revisão depois de hoje e até ${formatCalendarDate(limit)} (${MAX_LIA_REVIEW_MONTHS} meses).`,
      },
    ];
  }
  return [];
}

/** Revoga-se a LIA em vigor (a última aprovada); depois disso a abordagem fica bloqueada. */
export function liaRevocationIssues(target: LiaVersion, all: readonly LiaVersion[]): Issue[] {
  if (target.revokedAt) {
    return [{ field: '_form', code: 'lia_already_decided', message: 'Esta LIA já foi revogada.' }];
  }
  const latest = latestApproved(all);
  if (!target.approvedAt || !latest || latest.id !== target.id) {
    return [
      {
        field: '_form',
        code: 'lia_not_effective',
        message: 'Só a LIA em vigor (a última aprovada) pode ser revogada.',
      },
    ];
  }
  return [];
}
