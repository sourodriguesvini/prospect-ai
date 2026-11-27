import { Alert, Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CopilotChat } from '@/components/copilot/copilot-chat';
import { LocalAiStatus } from '@/components/copilot/local-ai-status';
import { CopilotLayout } from '@/components/copilot/side-column';
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
      webSearch: (tools?.specs() ?? []).some((spec) => spec.internet === true),
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
    // Conversas salvas à esquerda da conversa (menus à esquerda); em tela estreita, atrás de um botão.
    <CopilotLayout
      side={
        <>
          {ok ? (
            <Panel aria-labelledby="conversas" className="shrink-0">
              <PanelHeader titleId="conversas" title="Conversas" />
              <ThreadList
                threads={ok.threads}
                archived={ok.archived}
                currentId={ok.opened?.id ?? null}
              />
            </Panel>
          ) : null}
          <Panel aria-labelledby="ia-local" className="min-w-0 shrink-0">
            <LocalAiStatus status={status} now={new Date()} titleId="ia-local" />
          </Panel>
        </>
      }
    >
      <Panel aria-labelledby="conversa" className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PanelHeader
          className="mb-4 shrink-0"
          titleId="conversa"
          title={ok?.opened?.title ?? 'Nova conversa'}
          description={
            ok?.webSearch
              ? 'Respostas geradas agora pela IA local; só o texto das pesquisas na internet sai deste computador.'
              : 'Respostas geradas agora pela IA local, sem enviar nada para fora deste computador.'
          }
        />
        {ok?.missing ? (
          <Alert tone="warning" role="note" className="mb-3 shrink-0">
            Essa conversa não existe mais ou o endereço está errado. Escreva abaixo para começar uma
            nova.
          </Alert>
        ) : null}
        {conversations.kind === 'error' ? (
          <Alert tone="warning" role="note" className="mb-3 shrink-0">
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
          webSearch={ok?.webSearch ?? false}
        />
      </Panel>
    </CopilotLayout>
  );
}

/**
 * Tela de chat (diretriz 2026-11-26, Parte 6.1): a página ocupa só a altura da área do app (a
 * mesma conta do menu lateral: 100dvh menos as margens da moldura), o documento não rola, só o
 * histórico de mensagens rola, e o campo de mensagem fica sempre embaixo. Abaixo de 28rem de
 * altura a página volta a rolar inteira, para nada ficar espremido.
 *
 * Margens da moldura (`app-shell.tsx`): no celular 6rem (bordas, topo fixo de 2,5rem e o espaço
 * abaixo dele); de `sm` a `md`, com bordas maiores, 7rem; a partir de `md`, sem o topo, 3,5rem.
 */
export default function CopilotPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-[28rem] flex-col gap-4 sm:h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3.5rem)]">
      <div className="shrink-0 space-y-1">
        <h1 className="text-3xl tracking-[-0.03em] lg:text-4xl">Copiloto</h1>
        <p className="hidden text-sm text-muted-foreground md:block">
          Conversa com o modelo local deste computador. Ele consulta o que está salvo no Prospector
          e, com a pesquisa na internet ligada, páginas públicas; guarda as conversas, não altera
          dados e não envia mensagens.
        </p>
      </div>
      <Suspense
        fallback={
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row">
            <Panel aria-label="Conversa" className="min-h-0 min-w-0 flex-1">
              <Well role="status" className="py-16 text-center text-sm text-muted-foreground">
                Verificando a IA local…
              </Well>
            </Panel>
            <Panel
              aria-label="IA local"
              className="hidden min-w-0 lg:order-first lg:block lg:w-[min(24rem,33%)]"
            >
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
