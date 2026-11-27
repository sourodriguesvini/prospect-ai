import type { ClaimView } from '@prospector/application';
import type { ReactNode } from 'react';
import { ClaimCard } from '@/components/companies/claim-card';

/** Lista de claims e seção com título, comuns aos painéis do relatório da empresa. */

/** `support`: todos os claims em vigor do dossiê, para cada conclusão mostrar o seu apoio. */
export function ClaimList({
  views,
  support,
}: {
  views: readonly ClaimView[];
  support: readonly ClaimView[];
}) {
  const byId = new Map(support.map((view) => [view.claim.id, view]));
  return (
    <ul className="divide-y">
      {views.map((view) => (
        <ClaimCard key={view.claim.id} view={view} support={byId} />
      ))}
    </ul>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  );
}
