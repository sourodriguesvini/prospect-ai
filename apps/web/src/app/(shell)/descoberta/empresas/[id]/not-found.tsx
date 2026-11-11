import Link from 'next/link';
import { PageHeader } from '@/components/strategy/page-parts';
import { discoveryRoutes } from '@/lib/discovery-routes';

/** Id de empresa encontrada que não existe (ou que sumiu ao reiniciar no modo memória). */
export default function ProspectNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/', label: 'Início' },
          { href: discoveryRoutes.home, label: 'Descoberta' },
          { href: discoveryRoutes.prospects, label: 'Empresas encontradas' },
        ]}
        title="Empresa não encontrada"
        description="Este endereço não corresponde a nenhuma empresa encontrada pela Descoberta. No modo memória, elas somem quando o servidor reinicia."
      />
      <Link
        href={discoveryRoutes.prospects}
        className="inline-block text-sm underline underline-offset-4"
      >
        Ver as empresas encontradas
      </Link>
    </div>
  );
}
