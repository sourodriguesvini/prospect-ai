'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { FormMessage, TextField } from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';

/**
 * Enquanto a investigação anda, a página se atualiza sozinha (a cada 5 s, só com a aba visível).
 * `router.refresh` refaz só os dados do servidor: o foco e o que estiver digitado ficam.
 */
export function InvestigationAutoRefresh({ intervalMs = 5000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);
  return null;
}

/**
 * Confirmação do site oficial: um botão por candidato encontrado na pesquisa e um campo para
 * informar outro endereço. Só depois disso a investigação lê o site e captura a marca.
 */
export function SiteConfirmForm({
  action,
  candidates,
}: {
  action: FormAction;
  candidates: readonly string[];
}) {
  const { state, values, formAction } = useActionForm(action, {});
  return (
    <div className="space-y-4">
      <FormMessage state={state} />
      {candidates.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-medium">Candidatos encontrados</p>
          <ul className="space-y-2">
            {candidates.map((domain) => (
              <li key={domain}>
                <form action={formAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="domain" value={domain} />
                  <span className="min-w-0 flex-1 text-sm [overflow-wrap:anywhere]">{domain}</span>
                  <SubmitButton variant="secondary" pendingLabel="Confirmando…">
                    É este
                    <span className="sr-only">: {domain}</span>
                  </SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form action={formAction} noValidate className="space-y-3">
        <TextField
          name="domain"
          label={candidates.length > 0 ? 'Ou informe o site' : 'Site oficial'}
          hint="Endereço do site da empresa, como empresa.com.br."
          inputMode="url"
          autoComplete="off"
          maxLength={253}
          state={state}
          values={values}
        />
        <SubmitButton variant="secondary" pendingLabel="Confirmando…">
          Confirmar site
        </SubmitButton>
      </form>
    </div>
  );
}
