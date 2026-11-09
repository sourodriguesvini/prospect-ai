import { ROLE_LABELS } from '@prospector/contracts';
import { Button, DemoBadge } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getServices } from '@/server/container';
import { contextFor, requireUser } from '@/server/session';

export const metadata: Metadata = { title: 'Organizações' };

export default async function OrganizationsPage() {
  const user = await requireUser('/app');
  const { tenancy } = await getServices();
  const organizations = await tenancy.listMyOrganizations(contextFor(user));

  return (
    <div className="space-y-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-4xl">Organizações</h1>
          <p className="text-sm text-muted-foreground">
            Cada organização tem dados, equipe e configurações isolados.
          </p>
        </div>
        {organizations.length > 0 ? (
          <Button asChild variant="secondary">
            <Link href="/app/nova-organizacao">Nova organização</Link>
          </Button>
        ) : null}
      </div>

      {organizations.length === 0 ? (
        <section className="border-t pt-8">
          <h2 className="text-2xl">Você ainda não participa de nenhuma organização</h2>
          <p className="mt-3 max-w-prose text-sm text-muted-foreground">
            Crie a organização da sua agência para começar. Se alguém já convidou você, abra o link
            do convite com esta conta.
          </p>
          <Button asChild className="mt-6">
            <Link href="/app/nova-organizacao">Criar organização</Link>
          </Button>
        </section>
      ) : (
        <ul className="divide-y border-y">
          {organizations.map((org) => (
            <li key={org.id}>
              <Link
                href={`/o/${org.slug}`}
                className="flex items-center justify-between gap-4 px-1 py-5 hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <span className="flex items-center gap-3">
                  <span className="font-serif text-xl">{org.name}</span>
                  {org.isDemo ? <DemoBadge /> : null}
                </span>
                <span className="text-sm text-muted-foreground">{ROLE_LABELS[org.role]}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
