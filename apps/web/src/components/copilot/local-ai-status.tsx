import type { AiRuntimeStatus, AiTask, GpuSnapshot } from '@prospector/contracts';
import { Alert, Badge, PanelHeader, StatusDot } from '@prospector/ui';
import { formatGigabytes, formatMebibytesAsGigabytes } from '@/lib/copilot';
import { LoadedModels } from './loaded-models';
import { RefreshStatusButton } from './status-controls';

const TASK_LABEL: Record<AiTask, string> = {
  copilot: 'Conversa',
  reasoning: 'Análise',
  vision: 'Imagens',
  embedding: 'Busca semântica',
};

/** Tarefa que a tela já usa; as outras ainda não têm quem as chame (IA-2 em diante). */
const IN_USE: ReadonlySet<AiTask> = new Set(['copilot']);

/** Painel com o estado real da IA local: Ollama, GPU, modelos e limites. Nada é estimado. */
export function LocalAiStatus({
  status,
  now,
  titleId,
}: {
  status: AiRuntimeStatus;
  now: Date;
  titleId: string;
}) {
  return (
    <div className="space-y-5">
      <PanelHeader
        titleId={titleId}
        title="IA local"
        description="Ollama neste computador."
        actions={<RefreshStatusButton />}
        className="mb-0"
      />

      {/* Sempre montado: ao clicar em Atualizar, a troca de estado é anunciada. */}
      <div role="status">
        {status.state === 'offline' ? (
          <Badge variant="danger">
            <StatusDot tone="danger">Ollama fora do ar</StatusDot>
          </Badge>
        ) : (
          <Badge variant="success">
            <StatusDot tone="success">Ollama {status.version} conectado</StatusDot>
          </Badge>
        )}
      </div>
      {status.state === 'offline' ? (
        <Alert tone="warning" role="status">
          O Ollama não está respondendo neste computador. Abra o Ollama pelo menu Iniciar e clique
          em Atualizar.
        </Alert>
      ) : null}

      <GpuMeter gpu={status.gpu} />

      {status.state === 'online' ? (
        <>
          <LoadedModels
            models={status.loaded}
            now={now.toISOString()}
            headingId={`${titleId}-carregados`}
          />

          <section aria-labelledby={`${titleId}-tarefas`} className="space-y-2">
            <h3 id={`${titleId}-tarefas`} className="text-sm font-medium">
              Modelo por tarefa
            </h3>
            <dl className="divide-y text-sm">
              {status.routing.map((route) => (
                <div key={route.task} className="flex items-baseline justify-between gap-3 py-2">
                  <dt className="text-muted-foreground">{TASK_LABEL[route.task]}</dt>
                  <dd className="min-w-0 truncate text-right">
                    {route.resolved ? (
                      <span title={route.resolved}>{route.resolved}</span>
                    ) : IN_USE.has(route.task) ? (
                      <Badge variant="warning">Falta instalar {route.preferred[0]}</Badge>
                    ) : (
                      <span className="text-muted-foreground">
                        Não instalado ({route.preferred[0]})
                      </span>
                    )}
                    {IN_USE.has(route.task) ? null : (
                      <span className="block text-xs text-muted-foreground">ainda não usado</span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>

          <section aria-labelledby={`${titleId}-instalados`} className="space-y-2">
            <h3 id={`${titleId}-instalados`} className="text-sm font-medium">
              Instalados ({status.installed.length})
            </h3>
            <ul className="space-y-1 text-sm">
              {status.installed.map((model) => (
                <li key={model.name} className="flex justify-between gap-3">
                  <span className="min-w-0 truncate" title={model.name}>
                    {model.name}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {formatGigabytes(model.sizeBytes)}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs text-muted-foreground">
            {status.limits.maxConcurrent === 1
              ? 'Um pedido por vez'
              : `${status.limits.maxConcurrent} pedidos ao mesmo tempo`}
            {status.limits.maxQueue > 0
              ? `; até ${status.limits.maxQueue} esperando na fila.`
              : '; sem fila.'}{' '}
            Modelos ociosos saem da memória sozinhos para deixar a GPU livre para outros programas.
          </p>
        </>
      ) : null}
    </div>
  );
}

function GpuMeter({ gpu }: { gpu: GpuSnapshot | null }) {
  if (!gpu) {
    return (
      <p className="text-sm text-muted-foreground">
        Não foi possível ler a placa de vídeo (é preciso uma GPU NVIDIA).
      </p>
    );
  }
  const used = gpu.totalMiB > 0 ? Math.min(100, (gpu.usedMiB / gpu.totalMiB) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="min-w-0 truncate font-medium" title={gpu.name}>
          {gpu.name}
        </span>
        <span className="shrink-0 text-muted-foreground">
          {formatMebibytesAsGigabytes(gpu.freeMiB)} livres de{' '}
          {formatMebibytesAsGigabytes(gpu.totalMiB)}
        </span>
      </div>
      <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-foreground" style={{ width: `${used}%` }} />
      </div>
      <p className="text-xs text-muted-foreground">
        Memória de vídeo usada por todos os programas, não só pela IA.
      </p>
    </div>
  );
}
