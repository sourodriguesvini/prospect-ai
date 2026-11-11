/** Endereços das telas de Empresas (M2). */
const LIST = '/empresas';

/** Valores conhecidos de `?aviso=` no dossiê (só esses viram mensagem; KI-050). */
export const COMPANY_NOTICES = {
  created: 'cadastrada',
  duplicate: 'ja-cadastrada',
  refreshed: 'receita-atualizada',
  unchanged: 'receita-sem-mudanca',
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
} as const;
