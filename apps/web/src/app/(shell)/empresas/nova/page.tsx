import { Alert, Panel, PanelHeader } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CnpjImportForm, ManualCompanyForm } from '@/components/companies/company-forms';
import { Loading } from '@/components/strategy/loading';
import { PageHeader, StorageNotice, Unavailable } from '@/components/strategy/page-parts';
import { companyRoutes } from '@/lib/company-routes';
import { loadCompanies } from '@/server/companies';
import { cnpjLookupEnabled } from '@/server/env';
import { createCompanyAction, importCompanyAction } from '../actions';

export const metadata: Metadata = { title: 'Adicionar empresa' };

const TRAIL = [
  { href: '/', label: 'Início' },
  { href: companyRoutes.list, label: 'Empresas' },
];

async function NewCompany() {
  await connection();
  // Só confere se o banco está disponível; a lista em si não é usada aqui.
  const result = await loadCompanies((companies, ctx) => companies.list(ctx, { limit: 1 }));
  if (result.kind === 'unavailable') return <Unavailable message={result.message} />;
  const lookup = cnpjLookupEnabled();
  return (
    <>
      <StorageNotice storage={result.storage} />
      <Panel aria-labelledby="pelo-cnpj">
        <PanelHeader
          titleId="pelo-cnpj"
          title="Pelo CNPJ"
          description="Consulta gratuita na base aberta da Receita Federal (OpenCNPJ, com a Minha Receita de reserva). Cada dado vira um fato com a fonte e a data. Não guardamos sócios, e-mail, telefone nem endereço de rua."
        />
        {lookup ? (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              MEI e outras empresas de uma pessoa só têm como razão social o nome da pessoa. Esse
              nome fica só no cadastro da empresa, fora das evidências, e o dossiê mostra o aviso de
              dado pessoal.
            </p>
            <CnpjImportForm action={importCompanyAction} />
          </div>
        ) : (
          <Alert tone="warning" role="status">
            A consulta de CNPJ está desligada nesta instalação. Use o cadastro manual abaixo.
          </Alert>
        )}
      </Panel>
      <Panel aria-labelledby="manual">
        <PanelHeader
          titleId="manual"
          title="Cadastro manual"
          description="Para empresas sem CNPJ à mão ou quando a consulta estiver fora do ar. Os dados ficam como você informar, sem verificação; depois dá para consultar a Receita pelo dossiê."
        />
        <ManualCompanyForm action={createCompanyAction} />
      </Panel>
    </>
  );
}

export default function NewCompanyPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        trail={TRAIL}
        title="Adicionar empresa"
        description="Se a empresa já estiver cadastrada (mesmo CNPJ ou site), você vai direto para o dossiê dela."
      />
      <Suspense fallback={<Loading />}>
        <NewCompany />
      </Suspense>
    </div>
  );
}
