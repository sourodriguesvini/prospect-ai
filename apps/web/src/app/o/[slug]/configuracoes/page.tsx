import { canViewAuditLog } from '@prospector/domain';
import type { Metadata } from 'next';
import Link from 'next/link';
import { loadOrgScope } from '@/server/org';

export const metadata: Metadata = { title: 'Configuração' };

const PLANNED = [
  'Ofertas, rubricas, ICP, voz da agência e cases',
  'Integrações',
  'Conformidade (LIA, supressão, titulares, retenção)',
  'Uso e orçamento',
  'Agentes (modelos, versões de prompt, avaliações)',
];

export default async function SettingsPage({ params }: PageProps<'/o/[slug]/configuracoes'>) {
  const { slug } = await params;
  const { org } = await loadOrgScope(slug);
  const base = `/o/${org.slug}/configuracoes`;

  return (
    <div className="space-y-10">
      <h1 className="text-4xl">Configuração</h1>
      <ul className="divide-y border-y">
        <li>
          <Link href={`${base}/equipe`} className="block px-1 py-4 hover:bg-muted/60">
            <span className="font-medium">Equipe</span>
            <span className="block text-sm text-muted-foreground">Membros, papéis e convites.</span>
          </Link>
        </li>
        {canViewAuditLog(org.role) ? (
          <li>
            <Link href={`${base}/auditoria`} className="block px-1 py-4 hover:bg-muted/60">
              <span className="font-medium">Auditoria</span>
              <span className="block text-sm text-muted-foreground">
                Registro imutável de ações na organização.
              </span>
            </Link>
          </li>
        ) : null}
      </ul>
      <section className="space-y-3">
        <h2 className="text-xl">Em breve</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {PLANNED.map((label) => (
            <li key={label}>{label}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
