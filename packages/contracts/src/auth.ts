import { z } from 'zod';
import { Email } from './tenancy';

/** Senha: comprimento acima de composição (NIST SP 800-63B); 72 é o limite do bcrypt no Supabase Auth. */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 72;

export const Password = z
  .string()
  .min(PASSWORD_MIN_LENGTH, { error: `Use ao menos ${PASSWORD_MIN_LENGTH} caracteres.` })
  .max(PASSWORD_MAX_LENGTH, { error: `Use no máximo ${PASSWORD_MAX_LENGTH} caracteres.` });

export const SignInInput = z.object({
  email: Email,
  password: z.string().min(1, { error: 'Informe a senha.' }).max(PASSWORD_MAX_LENGTH),
});
export type SignInInput = z.infer<typeof SignInInput>;

export const SignUpInput = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, { error: 'Informe seu nome.' })
    .max(120, { error: 'Use no máximo 120 caracteres.' }),
  email: Email,
  password: Password,
});
export type SignUpInput = z.infer<typeof SignUpInput>;
