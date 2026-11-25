'use server';

import { AppError, isAppError } from '@prospector/application';
import { formValues, text } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { identityInput, mailboxInput, remapSocialErrors } from '@/lib/email-forms';
import { runEmailAction } from '@/server/email';

/**
 * Server Actions do e-mail (ADR-0016, fatia E3). Nenhuma delas escreve para empresas: o único
 * envio é o e-mail de teste para a própria caixa.
 */

export async function saveIdentityAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  const { input, rows } = identityInput(values);
  return runEmailAction(values, async (email, ctx) => {
    try {
      const { changed } = await email.saveIdentity(ctx, input);
      return changed
        ? 'Identidade salva (nova versão). A prévia já usa estes dados.'
        : 'Nenhuma alteração: a identidade atual continua valendo.';
    } catch (error) {
      if (isAppError(error) && error.fieldErrors) {
        throw new AppError(error.code, error.reason, {
          fieldErrors: remapSocialErrors(error.fieldErrors, rows),
        });
      }
      throw error;
    }
  });
}

export async function saveMailboxAction(_prev: FormState, formData: FormData) {
  const values = formValues(formData);
  return runEmailAction(values, async (email, ctx) => {
    const { changed, value } = await email.saveMailbox(ctx, mailboxInput(values));
    if (!changed) return 'Nenhuma alteração na caixa.';
    return value.hasPassword
      ? 'Caixa salva. Se mudou endereço, servidor, porta ou usuário, teste a conexão de novo.'
      : 'Caixa salva. Agora grave a senha da caixa (servidor ou usuário novos pedem a senha de novo).';
  });
}

/** A senha nunca volta para o formulário, nem depois de um erro. */
export async function setPasswordAction(_prev: FormState, formData: FormData) {
  const password = text(formValues(formData), 'password');
  return runEmailAction({}, async (email, ctx, { storage }) => {
    await email.setPassword(ctx, { password });
    return storage === 'memory'
      ? 'Senha guardada só na memória do app (some ao reiniciar). Agora clique em Testar conexão.'
      : 'Senha gravada, criptografada, no banco do app. Agora clique em Testar conexão.';
  });
}

export async function checkMailboxAction(_prev: FormState, _formData: FormData) {
  return runEmailAction({}, async (email, ctx, { synthetic }) => {
    const { passed, issues, check } = await email.checkMailbox(ctx);
    const done = synthetic ? 'Conferência simulada feita' : 'Conferência feita';
    if (!passed) {
      return check.smtp === 'ok'
        ? `${done}: há pendências que bloqueiam os envios para empresas (veja abaixo). O e-mail de teste para você já pode sair, porque o login de envio passou.`
        : `${done}: há pendências (veja abaixo).`;
    }
    return issues.length > 0
      ? `${done}: a caixa está conferida, com avisos (veja abaixo).`
      : `${done}: a caixa está conferida.`;
  });
}

export async function sendTestAction(_prev: FormState, _formData: FormData) {
  return runEmailAction({}, async (email, ctx, { synthetic }) => {
    const { to } = await email.sendTestToSelf(ctx);
    return synthetic
      ? `Simulação: nada saiu deste computador (caixa de demonstração). Com a caixa real, o teste iria para ${to}.`
      : `E-mail de teste enviado para ${to}. Confira a caixa de entrada (e o spam).`;
  });
}
