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
  siteConfirmed: 'site-confirmado',
} as const;
export type CompanyNotice = (typeof COMPANY_NOTICES)[keyof typeof COMPANY_NOTICES];

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
