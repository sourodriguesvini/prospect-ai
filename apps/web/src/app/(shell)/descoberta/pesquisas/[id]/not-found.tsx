import Link from 'next/link';
import { PageHeader } from '@/components/strategy/page-parts';
import { discoveryRoutes } from '@/lib/discovery-routes';

/** Id de pesquisa que não existe (ou que sumiu ao reiniciar o servidor no modo memória). */
export default function RunNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/', label: 'Hoje' },
          { href: discoveryRoutes.home, label: 'Descobrir' },
        ]}
        title="Pesquisa não encontrada"
        description="Este endereço não corresponde a nenhuma pesquisa. No modo memória, as pesquisas somem quando o servidor reinicia."
      />
      <Link
        href={discoveryRoutes.home}
        className="inline-block text-sm underline underline-offset-4"
      >
        Ver as pesquisas recentes
      </Link>
    </div>
  );
}
