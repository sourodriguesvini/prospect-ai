import { AUDIT_PAGE_SIZE } from '@prospector/application';
import { Alert, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { AuditTable } from '@/components/audit-table';
import { StorageNotice } from '@/components/strategy/page-parts';
import { loadRecentAudit } from '@/server/audit-entries';

export const metadata: Metadata = { title: 'Auditoria' };

async function AuditEntries() {
  await connection();
  const result = await loadRecentAudit();
  if (result.kind === 'unavailable') {
    return (
      <Alert tone="warning" role="status">
        {result.message}
      </Alert>
    );
  }
  return (
    <div className="space-y-4">
      <StorageNotice storage={result.storage} />
      {result.entries.length === 0 ? (
        <Well className="py-10 text-center text-sm text-muted-foreground">
          Nenhum registro ainda.
        </Well>
      ) : (
        <AuditTable entries={result.entries} />
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Link
          href="/configuracoes"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Configuração
        </Link>
        <h1 className="text-4xl tracking-[-0.03em]">Auditoria</h1>
      </div>
      <Panel aria-labelledby="registros">
        <PanelHeader
          titleId="registros"
          title="Registros"
          description={`Somente inclusão: nem o app nem os agentes podem alterar ou apagar entradas. Mostrando as ${AUDIT_PAGE_SIZE} mais recentes.`}
        />
        <Suspense
          fallback={
            <Well role="status" className="py-10 text-center text-sm text-muted-foreground">
              Carregando registros…
            </Well>
          }
        >
          <AuditEntries />
        </Suspense>
      </Panel>
    </div>
  );
}
