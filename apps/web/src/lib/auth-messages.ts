/** Mensagens para códigos do Supabase Auth. Nunca revelam se um e-mail já tem conta. */
const AUTH_MESSAGES: Record<string, string> = {
  invalid_credentials: 'E-mail ou senha incorretos.',
  email_not_confirmed:
    'Confirme seu e-mail antes de entrar: procure a mensagem de confirmação na sua caixa de entrada.',
  weak_password: 'Senha fraca. Use uma frase mais longa ou menos previsível.',
  over_email_send_rate_limit:
    'Muitos e-mails enviados em pouco tempo. Aguarde alguns minutos e tente de novo.',
  over_request_rate_limit: 'Muitas tentativas. Aguarde alguns minutos e tente de novo.',
  email_address_invalid: 'Este endereço de e-mail não pode ser usado.',
  signup_disabled: 'O cadastro está desativado neste ambiente.',
  otp_expired: 'O link expirou. Entre novamente para receber outro.',
};

export const AUTH_UNAVAILABLE =
  'Não foi possível falar com o serviço de autenticação. Tente novamente em instantes.';

export const CONFIRM_LINK_INVALID =
  'O link de confirmação é inválido ou expirou. Entre com e-mail e senha ou crie a conta novamente.';

export function authErrorMessage(error: { code?: string | undefined }): string {
  if (error.code && error.code in AUTH_MESSAGES) return AUTH_MESSAGES[error.code] as string;
  return AUTH_UNAVAILABLE;
}

/**
 * Erros de cadastro que indicam e-mail já existente. A resposta ao usuário é a mesma de um
 * cadastro novo ("enviamos um link"), para não revelar quem tem conta.
 */
export function isConcealedSignUpError(code: string | undefined): boolean {
  return code === 'user_already_exists' || code === 'email_exists';
}

/** Tipos de link de e-mail aceitos hoje: só confirmação de cadastro. */
export const CONFIRM_OTP_TYPES = ['email', 'signup'] as const;
export type ConfirmOtpType = (typeof CONFIRM_OTP_TYPES)[number];

export type ConfirmLink = { tokenHash: string; type: ConfirmOtpType } | { code: string };

/**
 * Lê os parâmetros do link de confirmação: formato `token_hash` (template do projeto) ou PKCE
 * `code` (template padrão do Supabase). Devolve null se o link não tiver um formato aceito.
 */
export function parseConfirmLink(params: {
  token_hash?: string | undefined;
  type?: string | undefined;
  code?: string | undefined;
}): ConfirmLink | null {
  const { token_hash: tokenHash, type, code } = params;
  if (tokenHash && type && (CONFIRM_OTP_TYPES as readonly string[]).includes(type)) {
    return { tokenHash, type: type as ConfirmOtpType };
  }
  if (code) return { code };
  return null;
}
