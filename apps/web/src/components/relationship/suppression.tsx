import { SUPPRESSION_REASON_LABELS, type SuppressionEntry } from '@prospector/contracts';
import Link from 'next/link';
import { liftSuppressionAction } from '@/app/(shell)/relacionamento/actions';
import { ReasonForm } from './forms';

/**
 * Como retirar cada supressão em vigor (ADR-0014). Só no dossiê da empresa que pediu: a que vale
 * por herança (mesma raiz de CNPJ ou mesmo domínio) aponta para a empresa de origem. Pedido de
 * titular (LGPD) não é retirado pelo app.
 */
export function SuppressionLift({
  entries,
  companyId,
  opportunityId,
  summary,
  hint,
}: {
  entries: readonly SuppressionEntry[];
  /** Empresa da tela atual. */
  companyId: string;
  /** Oportunidade da tela (volta para ela com o aviso); null no painel do dossiê. */
  opportunityId: string | null;
  summary: string;
  hint: string;
}) {
  return (
    <>
      {entries.map((entry) => {
        if (entry.reason === 'legal_request') {
          return (
            <p key={entry.id} className="mt-2 text-sm">
              Pedido de titular (LGPD): não é retirado pelo app.
            </p>
          );
        }
        if (entry.companyId !== companyId) {
          return (
            <p key={entry.id} className="mt-2 text-sm">
              {SUPPRESSION_REASON_LABELS[entry.reason]}: vale também para esta empresa porque ela
              tem a mesma raiz de CNPJ ou o mesmo domínio de quem pediu.{' '}
              <Link
                href={`/empresas/${encodeURIComponent(entry.companyId)}`}
                className="font-medium underline underline-offset-2"
              >
                Abrir a empresa que pediu
              </Link>{' '}
              para ver ou retirar.
            </p>
          );
        }
        return (
          <details key={entry.id} className="mt-3">
            <summary className="cursor-pointer text-sm font-medium">{summary}</summary>
            <div className="mt-2">
              <ReasonForm
                action={liftSuppressionAction.bind(null, opportunityId, companyId, entry.id)}
                label="Por que retirar"
                hint={hint}
                submitLabel="Retirar supressão"
                minLength={10}
              />
            </div>
          </details>
        );
      })}
    </>
  );
}
