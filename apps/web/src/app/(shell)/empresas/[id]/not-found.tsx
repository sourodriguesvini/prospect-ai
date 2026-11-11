import Link from 'next/link';
import { PageHeader } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';

/** Id de empresa que não existe (ou que sumiu ao reiniciar o servidor no modo memória). */
export default function CompanyNotFound() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={[
          { href: '/', label: 'Início' },
          { href: companyRoutes.list, label: 'Empresas' },
        ]}
        title="Empresa não encontrada"
        description="Este endereço não corresponde a nenhuma empresa cadastrada. No modo memória, as empresas somem quando o servidor reinicia."
      />
      <Link href={companyRoutes.list} className="inline-block text-sm underline underline-offset-4">
        Ver as empresas cadastradas
      </Link>
    </div>
  );
}
