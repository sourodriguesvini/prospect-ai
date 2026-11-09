import { Panel, PanelHeader, Well } from '@prospector/ui';
import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { CopilotChat } from '@/components/copilot/copilot-chat';
import { LocalAiStatus } from '@/components/copilot/local-ai-status';
import { chatModelOptions } from '@/lib/copilot';
import { getLocalAi } from '@/server/container';

export const metadata: Metadata = { title: 'Copiloto' };

/** Lido a cada visita: o Ollama pode ter sido aberto, fechado ou ganho modelos desde a última. */
async function Workspace() {
  await connection();
  const status = await getLocalAi().status();
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
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
      <Panel aria-labelledby="conversa" className="flex min-w-0 flex-col lg:col-span-8">
        <PanelHeader
          titleId="conversa"
          title="Conversa"
          description="Respostas geradas agora pela IA local, sem enviar nada para fora deste computador."
        />
        <CopilotChat
          models={
            online && copilotRoute ? chatModelOptions(status.installed, copilotRoute.requires) : []
          }
          defaultModel={copilotRoute?.resolved ?? null}
          unavailable={unavailable}
        />
      </Panel>
      <Panel aria-labelledby="ia-local" className="min-w-0 lg:col-span-4">
        <LocalAiStatus status={status} now={new Date()} titleId="ia-local" />
      </Panel>
    </div>
  );
}

export default function CopilotPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-4xl tracking-[-0.03em]">Copiloto</h1>
        <p className="text-sm text-muted-foreground">
          Primeira versão: conversa com o modelo local. Consultar empresas, dossiês e pesquisas
          chega na fatia IA-2.
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
        <Workspace />
      </Suspense>
    </div>
  );
}
