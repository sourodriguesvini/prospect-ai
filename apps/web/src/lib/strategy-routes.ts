/** Endereços das telas da Estratégia e da Conformidade (F2). */
const STRATEGY = '/configuracoes/estrategia';
const COMPLIANCE = '/configuracoes/conformidade';

/** Valor de `?aviso=` na lista de cases depois de arquivar um (KI-050). */
export const CASE_ARCHIVED_NOTICE = 'case-arquivado';

export const strategyRoutes = {
  overview: STRATEGY,
  newOffer: `${STRATEGY}/ofertas/nova`,
  offer: (id: string) => `${STRATEGY}/ofertas/${id}`,
  editOffer: (id: string) => `${STRATEGY}/ofertas/${id}/editar`,
  rubric: (id: string) => `${STRATEGY}/ofertas/${id}/rubrica`,
  scoring: (id: string) => `${STRATEGY}/ofertas/${id}/score`,
  newIcp: (offerId: string) => `${STRATEGY}/ofertas/${offerId}/icp/novo`,
  icp: (id: string) => `${STRATEGY}/icp/${id}`,
  voice: `${STRATEGY}/voz`,
  cases: `${STRATEGY}/cases`,
  newCase: `${STRATEGY}/cases/novo`,
  case: (id: string) => `${STRATEGY}/cases/${id}`,
  compliance: COMPLIANCE,
  lia: `${COMPLIANCE}/lia`,
  contactPolicy: `${COMPLIANCE}/opt-out`,
} as const;
