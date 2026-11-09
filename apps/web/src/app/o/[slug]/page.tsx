import { canManageMembers } from '@prospector/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { loadOrgScope } from '@/server/org';

export const metadata: Metadata = { title: 'Início' };

export default async function OrganizationHome({ params }: PageProps<'/o/[slug]'>) {
  const { slug } = await params;
  const { org } = await loadOrgScope(slug);

  return (
    <div className="space-y-10">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">Hoje</p>
        <h1 className="text-4xl">Início</h1>
      </div>
      <section className="max-w-prose border-t pt-6">
        <h2 className="text-2xl">A fila de decisões aparece aqui</h2>
        <p className="mt-3 text-sm text-muted-foreground">
          Aprovações, revisões e respostas chegarão a esta tela quando os módulos de abordagem e
          conversas estiverem prontos. Por enquanto, o Prospector cobre organização, equipe, papéis
          e auditoria.
        </p>
        {canManageMembers(org.role) ? (
          <Link
            href={`/o/${org.slug}/configuracoes/equipe`}
            className="mt-6 inline-block text-sm underline underline-offset-4"
          >
            Convidar a equipe
          </Link>
        ) : null}
      </section>
    </div>
  );
}
