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
import { Suspense } from 'react';
import { AuditTable } from '@/components/audit-table';
import { DATABASE_STATUS_VIEW } from '@/lib/database-status';
import { greetingFor } from '@/lib/greeting';
import { loadRecentAudit } from '@/server/audit-entries';
import { getServices } from '@/server/container';

export const metadata: Metadata = { title: 'Início' };

/** Fatos fixos desta instalação (ADR-0007, CLAUDE.md), não números de exemplo. */
const SAFEGUARDS = [
  { label: 'Onde roda', value: '127.0.0.1', note: 'Só este computador' },
  { label: 'Envios', value: 'Com aprovação', note: 'Nada sai sem você' },
  { label: 'Dados demo', value: 'Nenhum', note: 'Selo DEMO quando houver' },
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
      <div className="space-y-2 px-1 pt-2">
        <Suspense fallback={<h1 className="text-4xl tracking-[-0.03em] sm:text-5xl">Início</h1>}>
          <Greeting />
        </Suspense>
        <p className="text-sm text-muted-foreground">
          A fila de decisões do dia aparece aqui quando abordagens e conversas estiverem prontas.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel aria-labelledby="estado" className="flex flex-col gap-5 lg:col-span-4">
          <div className="space-y-4">
            <h2 id="estado" className="text-sm font-medium text-muted-foreground">
              Banco de dados
            </h2>
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
            <p className="px-1 pb-2 text-xs text-muted-foreground">Proteções desta instalação</p>
            <ul className="grid grid-cols-3 gap-2">
              {SAFEGUARDS.map((item) => (
                <li key={item.label} className="rounded-xl bg-surface p-2.5">
                  <p className="text-[0.6875rem] text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-sm font-medium">{item.value}</p>
                  <p className="mt-0.5 text-[0.6875rem] text-muted-foreground">{item.note}</p>
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
              label="Empresas investigadas"
              value="—"
              note="Chega na F3"
              icon={<Search className="size-4" />}
            />
            <StatTile
              label="Respostas"
              value="—"
              note="Chega na F11"
              icon={<MessagesSquare className="size-4" />}
            />
            <StatTile
              label="Custo de IA no mês"
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
            <p className="absolute inset-0 grid place-items-center px-8 text-center text-sm text-muted-foreground">
              Sem dados ainda. O funil aparece quando a Descoberta (F4) estiver ativa.
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
