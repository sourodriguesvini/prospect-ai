/**
 * Assinaturas das RPCs (nomes dos argumentos, na ordem do SQL). Fonte única: o repositório
 * só chama RPCs por aqui, e o teste de catálogo compara este mapa com `pg_proc.proargnames`.
 * Renomear um parâmetro na migração sem atualizar este mapa quebra `pnpm test:db`.
 */
export const RPC_SIGNATURES = {
  create_organization: ['p_name', 'p_slug'],
  create_invitation: ['p_org_id', 'p_email', 'p_role'],
  accept_invitation: ['p_token'],
  revoke_invitation: ['p_org_id', 'p_invitation_id'],
  change_member_role: ['p_org_id', 'p_user_id', 'p_role'],
  remove_member: ['p_org_id', 'p_user_id'],
} as const satisfies Record<string, readonly string[]>;

export type RpcName = keyof typeof RPC_SIGNATURES;
export type RpcArgs<N extends RpcName> = Record<(typeof RPC_SIGNATURES)[N][number], unknown>;

/**
 * Chaves de erro levantadas pelo SQL que não chegam à aplicação (só protegem o banco de
 * acesso direto) e por isso não têm mensagem em ERROR_MESSAGES.
 */
export const INTERNAL_DB_ERROR_KEYS: readonly string[] = ['audit_log_append_only'];
