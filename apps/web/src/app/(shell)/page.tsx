import {
  Alert,
  Badge,
  Button,
  Panel,
  PanelHeader,
  StatTile,
  StatusDot,
  Well,
} from '@prospector/ui';
import { CheckCheck, Coins, MessagesSquare, ScrollText, Search } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { Suspense, type ReactNode } from 'react';
import { AuditTable } from '@/components/audit-table';
import { DATABASE_STATUS_VIEW } from '@/lib/database-status';
import { greetingFor } from '@/lib/greeting';
import { loadRecentAudit } from '@/server/audit-entries';
import { getServices } from '@/server/container';
import { userContext } from '@/server/context';

export const metadata: Metadata = { title: 'Início' };

/**
 * Registros de demonstração gravados (ofertas, ICPs, cases e empresas com `isDemo`), lidos a cada
 * visita. O app não semeia nada (ADR-0009); se aparecer algum, ele tem selo DEMO nas telas.
 */
async function DemoDataValue() {
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
    // Banco fora do ar: o cartão do banco já explica; aqui só não afirmamos nada.
  }
  if (count === null) return <>—</>;
  return <>{count === 0 ? 'Nenhum' : count === 1 ? '1 registro' : `${count} registros`}</>;
}

/** Teto da contagem do cartão: acima disso mostra "200+" em vez de ler o banco inteiro. */
const INVESTIGATED_LIMIT = 200;

/** Empresas em acompanhamento (sem as arquivadas) com pelo menos uma consulta (M2). */
async function InvestigatedValue() {
  await connection();
  const { companies } = getServices();
  if (!companies) return <>—</>;
  let count: number | null = null;
  let capped = false;
  try {
    const list = await companies.list(userContext(), {
      includeArchived: false,
      limit: INVESTIGATED_LIMIT,
    });
    count = list.filter((company) => company.lastInvestigatedAt !== null).length;
    capped = list.length === INVESTIGATED_LIMIT;
  } catch {
    // Banco fora do ar: o cartão do banco já explica; aqui só não afirmamos nada.
  }
  if (count === null) return <>—</>;
  return <>{capped ? `${count}+` : count}</>;
}

/** Fatos desta instalação (ADR-0007, CLAUDE.md), não números de exemplo. */
const SAFEGUARDS: { label: string; value: ReactNode; note: string }[] = [
  { label: 'Onde roda', value: '127.0.0.1', note: 'Só local' },
  { label: 'Aprovação', value: 'Obrigatória', note: 'Nada sai sem você' },
  {
    label: 'Dados demo',
    value: (
      <Suspense fallback={<span role="status">Contando…</span>}>
        <DemoDataValue />
      </Suspense>
    ),
    note: 'Se houver, com selo DEMO',
  },
];

async function Greeting() {
  await connection();
  return <h1 className="text-4xl tracking-[-0.03em] sm:text-5xl">{greetingFor(new Date())}</h1>;
}

const BADGE = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  neutral: 'neutral',
  accent: 'accent',
} as const;
const ACTION_LABEL = {
  success: 'Tudo certo',
  warning: 'Ação necessária',
  danger: 'Verificar conexão',
  neutral: 'Sem informação',
  accent: 'Atenção',
} as const;

/** Lido a cada visita (nunca congelado no build); leva até 3 s se o banco não responder. */
async function DatabaseStatusValue() {
  await connection();
  const status = await getServices().system.databaseStatus();
  const view = DATABASE_STATUS_VIEW[status];
  return (
    <div data-status={status} className="space-y-2">
      <p className="text-4xl tracking-[-0.04em]">{view.label}</p>
      <Badge variant={BADGE[view.tone]}>
        <StatusDot tone={view.tone}>{ACTION_LABEL[view.tone]}</StatusDot>
      </Badge>
      <p className="text-sm text-muted-foreground">{view.help}</p>
    </div>
  );
}

async function RecentActivity() {
  await connection();
  const result = await loadRecentAudit(5);
  if (result.kind === 'unavailable') {
    return (
      <Alert tone="warning" role="status">
        {result.message}
      </Alert>
    );
  }
  if (result.entries.length === 0) {
    return (
      <Well className="py-10 text-center text-sm text-muted-foreground">
        Nenhum registro ainda. As ações suas, dos agentes e do sistema aparecem aqui.
      </Well>
    );
  }
  return <AuditTable entries={result.entries} />;
}

export default function Home() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Suspense fallback={<h1 className="text-4xl tracking-[-0.03em] sm:text-5xl">Início</h1>}>
          <Greeting />
        </Suspense>
        <p className="text-sm text-muted-foreground">
          A fila de decisões do dia aparece aqui quando abordagens e conversas estiverem prontas.
        </p>
      </div>

      {/* grid-cols-1 (minmax(0, 1fr)): sem ele a coluna única do celular cresce até a largura
          mínima da tabela de atividade (40rem) e a página rola para o lado; com ele a tabela
          rola dentro do próprio painel. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Panel aria-labelledby="estado" className="flex flex-col gap-5 lg:col-span-4">
          <div className="space-y-4">
            <PanelHeader titleId="estado" title="Banco de dados" className="mb-0" />
            <Suspense
              fallback={
                <p role="status" className="text-4xl tracking-[-0.04em] text-muted-foreground">
                  Verificando…
                </p>
              }
            >
              <DatabaseStatusValue />
            </Suspense>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button asChild>
              <Link href="/configuracoes/auditoria">
                <ScrollText aria-hidden="true" className="size-4" />
                Auditoria
              </Link>
            </Button>
            <Button asChild variant="secondary" className="bg-muted hover:bg-border">
              <Link href="/configuracoes">Configuração</Link>
            </Button>
          </div>
          <Well className="mt-auto p-3">
            <p className="px-2.5 pb-2 text-xs text-muted-foreground">Proteções desta instalação</p>
            {/* Subgrade: rótulo, valor e nota ficam na mesma linha em todos os cartões. */}
            <ul className="grid grid-cols-1 gap-y-2 sm:grid-cols-3 sm:gap-x-2 sm:gap-y-0">
              {SAFEGUARDS.map((item) => (
                <li
                  key={item.label}
                  className="row-span-3 grid grid-rows-subgrid gap-y-1 rounded-xl bg-surface p-2.5"
                >
                  <p className="text-[0.6875rem] text-muted-foreground">{item.label}</p>
                  <p className="text-sm font-medium">{item.value}</p>
                  <p className="text-[0.6875rem] text-muted-foreground">{item.note}</p>
                </li>
              ))}
            </ul>
          </Well>
        </Panel>

        <Panel aria-labelledby="indicadores" className="lg:col-span-4">
          <h2 id="indicadores" className="sr-only">
            Indicadores
          </h2>
          <div className="grid h-full grid-cols-2 gap-3">
            <StatTile
              tone="accent"
              label="Aprovações pendentes"
              value="—"
              note="Chega na F10"
              icon={<CheckCheck className="size-4" />}
            />
            <StatTile
              label="Empresas consultadas"
              value={
                <Suspense fallback={<span role="status">Contando…</span>}>
                  <InvestigatedValue />
                </Suspense>
              }
              note={
                <Link href="/empresas" className="underline underline-offset-4">
                  Ver empresas
                </Link>
              }
              icon={<Search className="size-4" />}
            />
            <StatTile
              label="Respostas"
              value="—"
              note="Chega na F11"
              icon={<MessagesSquare className="size-4" />}
            />
            <StatTile
              // Espaços inseparáveis: quebra como "Custo de IA / no mês", nunca "Custo de / IA".
              label={'Custo de\u00a0IA no\u00a0mês'}
              value="—"
              note="Chega na F13"
              icon={<Coins className="size-4" />}
            />
          </div>
        </Panel>

        <Panel aria-labelledby="funil" className="flex flex-col lg:col-span-4">
          <PanelHeader
            titleId="funil"
            title="Funil de prospecção"
            description="Descobertas, investigadas, abordadas e respondidas por mês."
          />
          <div className="relative flex min-h-52 flex-1 flex-col justify-between rounded-[var(--radius-tile)] bg-muted p-4">
            {[0, 1, 2, 3].map((line) => (
              <div
                key={line}
                aria-hidden="true"
                className="border-t border-dashed border-input/60"
              />
            ))}
            <p className="absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground">
              {/* Fundo do poço por trás do texto: as linhas tracejadas não cruzam as letras. */}
              <span className="max-w-xs text-balance rounded-lg bg-muted px-3 py-1.5">
                Sem dados ainda. O funil aparece quando a Descoberta (F4) estiver ativa.
              </span>
            </p>
          </div>
        </Panel>

        <Panel aria-labelledby="atividade" className="lg:col-span-12">
          <PanelHeader
            titleId="atividade"
            title="Atividade recente"
            description="Últimos registros da auditoria."
            actions={
              <Button asChild variant="secondary" size="sm">
                <Link href="/configuracoes/auditoria">Ver tudo</Link>
              </Button>
            }
          />
          <Suspense
            fallback={
              <Well role="status" className="py-10 text-center text-sm text-muted-foreground">
                Carregando registros…
              </Well>
            }
          >
            <RecentActivity />
          </Suspense>
        </Panel>
      </div>
    </div>
  );
}
