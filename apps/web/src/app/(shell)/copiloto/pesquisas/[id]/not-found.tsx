import Link from 'next/link';
import { PageHeader } from '@/components/strategy/page-parts';
import { researchRoutes } from '@/lib/research-labels';

/** Id de pesquisa que não existe (ou que sumiu ao reiniciar o servidor no modo memória). */
export default function ResearchNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/', label: 'Hoje' },
          { href: '/copiloto', label: 'Copiloto' },
        ]}
        title="Pesquisa não encontrada"
        description="Este endereço não corresponde a nenhuma pesquisa. No modo memória, as pesquisas somem quando o servidor reinicia."
      />
      <Link
        href={researchRoutes.list}
        className="inline-block text-sm underline underline-offset-4"
      >
        Ver as pesquisas recentes
      </Link>
    </div>
  );
}
