import { canViewAuditLog } from '@prospector/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { describeActor, describeAuditEntry } from '@/lib/audit-format';
import { formatDateTime } from '@/lib/format';
import { loadOrgScope } from '@/server/org';

export const metadata: Metadata = { title: 'Auditoria' };

export default async function AuditPage({
  params,
}: PageProps<'/o/[slug]/configuracoes/auditoria'>) {
  const { slug } = await params;
  const { org, ctx, services } = await loadOrgScope(slug);

  const header = (
    <div className="space-y-2">
      <Link
        href={`/o/${org.slug}/configuracoes`}
        className="text-sm text-muted-foreground underline underline-offset-4"
      >
        Configuração
      </Link>
      <h1 className="text-4xl">Auditoria</h1>
    </div>
  );

  if (!canViewAuditLog(org.role)) {
    return (
      <div className="space-y-8">
        {header}
        <p className="max-w-prose text-sm text-muted-foreground">
          A auditoria é visível só para administradores e proprietários. Se precisar consultar um
          registro, peça a um deles.
        </p>
      </div>
    );
  }

  const [entries, members] = await Promise.all([
    services.tenancy.listAuditLog(ctx, org.id),
    services.tenancy.listMembers(ctx, org.id),
  ]);
  const people = new Map(
    members.map((member) => [member.userId, member.fullName ?? member.email ?? 'Sem nome']),
  );

  return (
    <div className="space-y-8">
      {header}
      <p className="max-w-prose text-sm text-muted-foreground">
        Registro somente de inclusão: nem administradores nem o sistema podem alterar ou apagar
        entradas. Mostrando as 100 mais recentes.
      </p>
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhum registro ainda.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Quando
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  Quem
                </th>
                <th scope="col" className="py-2 pr-4 font-medium">
                  O quê
                </th>
                <th scope="col" className="py-2 font-medium">
                  Detalhe
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {entries.map((entry) => {
                const description = describeAuditEntry(entry, people);
                return (
                  <tr key={entry.id} className="align-top">
                    <td className="whitespace-nowrap py-2.5 pr-4 text-muted-foreground">
                      {formatDateTime(entry.occurredAt)}
                    </td>
                    <td className="py-2.5 pr-4">{describeActor(entry, people)}</td>
                    <td className="py-2.5 pr-4">{description.label}</td>
                    <td className="py-2.5 text-muted-foreground">{description.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
