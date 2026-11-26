import type { AnalyzeProspectResult } from '@prospector/application';

/** Endereços das telas de Empresas (M2). */
const LIST = '/empresas';

/** Valores conhecidos de `?aviso=` no dossiê (só esses viram mensagem; KI-050). */
export const COMPANY_NOTICES = {
  created: 'cadastrada',
  duplicate: 'ja-cadastrada',
  refreshed: 'receita-atualizada',
  unchanged: 'receita-sem-mudanca',
  investigationStarted: 'investigacao-iniciada',
  investigationResumed: 'investigacao-retomada',
  investigationCancelled: 'investigacao-cancelada',
  /** "Analisar empresa" na Descoberta: um aviso por resultado de `analyzeProspect`. */
  analysisStarted: 'analise-iniciada',
  analysisRunning: 'analise-em-andamento',
  alreadyAnalyzed: 'ja-analisada',
  analysisQueueFull: 'analise-nao-iniciada-fila',
  analysisArchived: 'analise-nao-iniciada-arquivada',
  analysisUnavailable: 'analise-indisponivel',
  siteConfirmed: 'site-confirmado',
  cnpjLinked: 'cnpj-vinculado',
} as const;
export type CompanyNotice = (typeof COMPANY_NOTICES)[keyof typeof COMPANY_NOTICES];

/** Avisos de que algo não aconteceu: tom de atenção, nunca o verde de sucesso. */
export const WARNING_NOTICES: readonly CompanyNotice[] = [
  COMPANY_NOTICES.analysisQueueFull,
  COMPANY_NOTICES.analysisArchived,
  COMPANY_NOTICES.analysisUnavailable,
];

/** Avisos que só valem enquanto a análise roda ("a análise começou", "já está sendo analisada"). */
const WHILE_RUNNING: readonly CompanyNotice[] = [
  COMPANY_NOTICES.investigationStarted,
  COMPANY_NOTICES.investigationResumed,
  COMPANY_NOTICES.analysisStarted,
  COMPANY_NOTICES.analysisRunning,
];

/**
 * O aviso do endereço continua lá quando a página se atualiza sozinha. Depois que a análise
 * termina, "a análise começou" contradiria o resultado no topo: some.
 */
export function visibleNotice(
  notice: CompanyNotice | undefined,
  analysisActive: boolean,
): CompanyNotice | undefined {
  if (!notice) return undefined;
  return WHILE_RUNNING.includes(notice) && !analysisActive ? undefined : notice;
}

/** "Analisar empresa" na Descoberta: um aviso por resultado, sem afirmar o que não aconteceu. */
export function analyzeNotice(result: AnalyzeProspectResult): CompanyNotice {
  switch (result.status) {
    case 'started':
      return COMPANY_NOTICES.analysisStarted;
    case 'resumed':
      return COMPANY_NOTICES.investigationResumed;
    case 'already_running':
      return COMPANY_NOTICES.analysisRunning;
    case 'already_analyzed':
      return COMPANY_NOTICES.alreadyAnalyzed;
    case 'not_started':
      if (result.reason === 'queue_full') return COMPANY_NOTICES.analysisQueueFull;
      if (result.reason === 'company_archived') return COMPANY_NOTICES.analysisArchived;
      return COMPANY_NOTICES.analysisUnavailable;
  }
}

export const companyRoutes = {
  list: LIST,
  create: `${LIST}/nova`,
  /** `changed`: quantos dados mudaram na nova consulta (vai junto do aviso `refreshed`). */
  company: (id: string, notice?: CompanyNotice, changed?: number) => {
    const query = new URLSearchParams();
    if (notice) query.set('aviso', notice);
    if (notice && changed !== undefined) query.set('mudancas', String(changed));
    const search = query.toString();
    return `${LIST}/${encodeURIComponent(id)}${search ? `?${search}` : ''}`;
  },
  /**
   * Imagem de uma captura de marca (ADR-0015). `storagePath` é `<empresa>/<arquivo>.jpg`; null
   * se o caminho não for de captura ou não for desta empresa.
   */
  capture: (companyId: string, storagePath: string): string | null => {
    const [owner, file, ...rest] = storagePath.split('/');
    if (owner !== companyId || !file || rest.length > 0) return null;
    if (!/^[0-9a-f-]{36}-(desktop|mobile)\.jpg$/.test(file)) return null;
    return `${LIST}/${encodeURIComponent(companyId)}/capturas/${file}`;
  },
} as const;
