/**
 * Chaves de erro levantadas pelo SQL (`raise exception '<chave>'`) que não chegam à aplicação
 * (só protegem o banco de uso indevido) e por isso não têm mensagem em ERROR_MESSAGES.
 * O teste `sql-error-keys` confere esta lista contra as migrações.
 */
export const INTERNAL_DB_ERROR_KEYS: readonly string[] = [
  'audit_log_append_only',
  // F2: o app nunca altera versões (só inclui); o trigger protege contra uso indevido.
  'version_immutable',
  // KI-041: o app sempre manda o registro de auditoria junto; sem ele, a escrita é recusada.
  'audit_missing',
  'audit_invalid',
  // IA-2 em diante: registros de execução (mensagens, llm_calls, tool_calls) são só inclusão.
  'append_only',
];

/** Códigos de "tabela não existe": PostgREST (cache de esquema) e Postgres. */
const MISSING_RELATION_CODES = new Set(['PGRST205', '42P01']);

export function isMissingRelation(error: { code?: string | null }): boolean {
  return MISSING_RELATION_CODES.has(error.code ?? '');
}
