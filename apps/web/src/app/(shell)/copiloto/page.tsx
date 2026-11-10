import { Alert, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CopilotChat } from '@/components/copilot/copilot-chat';
import { LocalAiStatus } from '@/components/copilot/local-ai-status';
import { ThreadList } from '@/components/copilot/thread-list';
import {
  chatModelOptions,
  modelsWithoutThinking,
  turnsFromMessages,
  type Turn,
} from '@/lib/copilot';
import { getLocalAi, getServices } from '@/server/container';
import { userContext } from '@/server/context';

export const metadata: Metadata = { title: 'Copiloto' };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** Conversas salvas e a conversa aberta pela URL (IA-2). Falha do banco vira aviso, não erro. */
async function loadConversations(conversa: string | null) {
  const { copilot, tools } = getServices();
  if (!copilot) return { kind: 'off' as const };
  const ctx = userContext();
  try {
    const [threads, archived, opened] = await Promise.all([
      copilot.listThreads(ctx),
      copilot.listThreads(ctx, { archived: true }),
      conversa ? copilot.conversation(ctx, conversa) : Promise.resolve(null),
    ]);
    const titles = Object.fromEntries(
      (tools?.specs() ?? []).map((spec) => [spec.name, spec.title]),
    );
    const turns: Turn[] = opened ? turnsFromMessages(opened.messages, titles) : [];
    return {
      kind: 'ok' as const,
      threads,
      archived,
      opened: opened?.thread ?? null,
      turns,
      missing: conversa !== null && opened === null,
      toolsEnabled: (tools?.specs().length ?? 0) > 0,
    };
  } catch (error) {
    console.warn('[copiloto] conversas indisponíveis', error);
    return {
      kind: 'error' as const,
      message:
        'Não foi possível ler as conversas salvas. Se o banco acabou de ser atualizado, confira se as migrações foram aplicadas (docs/runbooks/ambiente-local.md).',
    };
  }
}

/** Lido a cada visita: o Ollama pode ter sido aberto, fechado ou ganho modelos desde a última. */
async function Workspace({ searchParams }: { searchParams: SearchParams }) {
  await connection();
  const params = await searchParams;
  const conversa = typeof params.conversa === 'string' ? params.conversa : null;
  const [status, conversations] = await Promise.all([
    getLocalAi().status(),
    loadConversations(conversa),
  ]);
  const online = status.state === 'online';
  const copilotRoute = online
    ? status.routing.find((route) => route.task === 'copilot')
    : undefined;
  // Mostrado antes da primeira pergunta: no celular o painel "IA local" fica abaixo da conversa.
  const unavailable = !online
    ? status.code === 'runtime_unavailable'
      ? 'A IA local está fora do ar: abra o Ollama pelo menu Iniciar e clique em Atualizar no painel IA local.'
      : status.message
    : !copilotRoute?.resolved
      ? `Nenhum modelo de conversa está instalado. Instale com "ollama pull ${copilotRoute?.preferred[0] ?? 'qwen3.5:4b'}" e clique em Atualizar.`
      : null;
  const ok = conversations.kind === 'ok' ? conversations : null;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Panel aria-labelledby="conversa" className="flex min-w-0 flex-col lg:col-span-8">
        <PanelHeader
          titleId="conversa"
          title={ok?.opened?.title ?? 'Nova conversa'}
          description="Respostas geradas agora pela IA local, sem enviar nada para fora deste computador."
        />
        {ok?.missing ? (
          <Alert tone="warning" role="note" className="mb-3">
            Essa conversa não existe mais ou o endereço está errado. Escreva abaixo para começar uma
            nova.
          </Alert>
        ) : null}
        {conversations.kind === 'error' ? (
          <Alert tone="warning" role="note" className="mb-3">
            {conversations.message}
          </Alert>
        ) : null}
        <CopilotChat
          models={
            online && copilotRoute ? chatModelOptions(status.installed, copilotRoute.requires) : []
          }
          noThinking={online ? modelsWithoutThinking(status.installed) : []}
          defaultModel={copilotRoute?.resolved ?? null}
          unavailable={unavailable}
          initialThreadId={ok?.opened?.id ?? null}
          initialTurns={ok?.turns ?? []}
          persistent={conversations.kind !== 'off'}
          toolsEnabled={ok?.toolsEnabled ?? false}
        />
      </Panel>
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
        {ok ? (
          <Panel aria-labelledby="conversas">
            <PanelHeader titleId="conversas" title="Conversas" />
            <ThreadList
              threads={ok.threads}
              archived={ok.archived}
              currentId={ok.opened?.id ?? null}
            />
          </Panel>
        ) : null}
        <Panel aria-labelledby="ia-local" className="min-w-0">
          <LocalAiStatus status={status} now={new Date()} titleId="ia-local" />
        </Panel>
      </div>
    </div>
  );
}

export default function CopilotPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl tracking-[-0.03em]">Copiloto</h1>
        <p className="text-sm text-muted-foreground">
          Conversa com o modelo local deste computador. Ele consulta o que está salvo no Prospector
          e guarda as conversas; não altera dados e não envia nada.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            <Panel aria-label="Conversa" className="min-w-0 lg:col-span-8">
              <Well role="status" className="py-16 text-center text-sm text-muted-foreground">
                Verificando a IA local…
              </Well>
            </Panel>
            <Panel aria-label="IA local" className="min-w-0 lg:col-span-4">
              <Well className="py-16 text-center text-sm text-muted-foreground">
                Lendo Ollama e GPU…
              </Well>
            </Panel>
          </div>
        }
      >
        <Workspace searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
