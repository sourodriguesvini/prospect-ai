/**
 * Avisos da Conformidade depois de um redirecionamento (`?aviso=`). Só valores conhecidos viram
 * texto; qualquer outro é ignorado (nada da URL aparece na tela).
 */
export const COMPLIANCE_NOTICES = {
  'lia-salva': {
    tone: 'success',
    text: 'Nova versão da LIA salva como rascunho. Ela só vale depois de aprovada, logo abaixo.',
  },
  'lia-aprovada': {
    tone: 'success',
    text: 'LIA aprovada. A data e a hora da aprovação ficaram registradas na auditoria.',
  },
  'lia-revogada': {
    tone: 'warning',
    text: 'LIA revogada. As abordagens ficam bloqueadas até outra versão ser aprovada.',
  },
  'opt-out-salvo': {
    tone: 'success',
    text: 'Identificação e opt-out salvos como nova versão.',
  },
} as const satisfies Record<string, { tone: 'success' | 'warning'; text: string }>;

export type ComplianceNotice = keyof typeof COMPLIANCE_NOTICES;

export function complianceNotice(value: string | string[] | undefined): ComplianceNotice | null {
  return typeof value === 'string' && Object.hasOwn(COMPLIANCE_NOTICES, value)
    ? (value as ComplianceNotice)
    : null;
}

export function complianceHref(base: string, notice: ComplianceNotice): string {
  return `${base}?aviso=${notice}`;
}
