import { Badge, StatusDot } from '@prospector/ui';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { DATABASE_STATUS_VIEW } from '@/lib/database-status';
import { getServices } from '@/server/container';
import { userContext } from '@/server/context';

/**
 * Estado do banco e proteções desta instalação. Saiu da tela inicial (Hoje mostra só um aviso
 * quando algo está errado) e fica em Configurações › Sistema.
 */

const ACTION_LABEL = {
  success: 'Tudo certo',
  warning: 'Ação necessária',
  danger: 'Verificar conexão',
  neutral: 'Sem informação',
  accent: 'Atenção',
} as const;

/** Lido a cada visita (nunca congelado no build); leva até 3 s se o banco não responder. */
export async function DatabaseStatusValue() {
  await connection();
  const status = await getServices().system.databaseStatus();
  const view = DATABASE_STATUS_VIEW[status];
  return (
    <div data-status={status} className="space-y-2">
      <p className="text-2xl tracking-[-0.03em]">{view.label}</p>
      <Badge variant={view.tone}>
        <StatusDot tone={view.tone}>{ACTION_LABEL[view.tone]}</StatusDot>
      </Badge>
      <p className="text-sm text-muted-foreground">{view.help}</p>
    </div>
  );
}

/**
 * Registros de demonstração gravados (ofertas, ICPs, cases e empresas com `isDemo`), lidos a cada
 * visita. O app não semeia nada (ADR-0009); se aparecer algum, ele tem selo DEMO nas telas.
 */
export async function DemoDataValue() {
  await connection();
  const { strategy, companies } = getServices();
  if (!strategy) return <>—</>;
  let count: number | null = null;
  try {
    const { snapshot } = await strategy.overview(userContext());
    const companyList = companies
      ? await companies.list(userContext(), { includeArchived: true, limit: 200 })
      : [];
    count = [...snapshot.offers, ...snapshot.icps, ...snapshot.proofAssets, ...companyList].filter(
      (record) => record.isDemo,
    ).length;
  } catch {
    // Banco fora do ar: o estado do banco ao lado já explica; aqui só não afirmamos nada.
  }
  if (count === null) return <>—</>;
  return <>{count === 0 ? 'Nenhum' : count === 1 ? '1 registro' : `${count} registros`}</>;
}

/** Fatos desta instalação (ADR-0007, CLAUDE.md), não números de exemplo. */
export function safeguards(demo: ReactNode): { label: string; value: ReactNode; note: string }[] {
  return [
    { label: 'Onde roda', value: '127.0.0.1', note: 'Só neste computador' },
    { label: 'Aprovação', value: 'Obrigatória', note: 'Nada sai sem você' },
    { label: 'Dados de demonstração', value: demo, note: 'Se houver, com selo DEMO' },
  ];
}
