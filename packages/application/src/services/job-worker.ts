import type { AiJob, AiJobKind } from '@prospector/contracts';
import type { JobOutcome, JobQueue } from '../ports/discovery';

/**
 * Trabalhador da fila durável (ADR-0011). Roda dentro do servidor do app (um por processo),
 * pega uma tarefa por vez e renova o lease enquanto ela roda. Se o app fechar no meio, o lease
 * vence e a tarefa volta para a fila na próxima abertura (nova tentativa, até `max_attempts`).
 * Recursos do computador são do usuário: uma tarefa por vez, sem rodar nada em paralelo à IA.
 */

export interface JobHandler {
  run(job: AiJob, signal: AbortSignal): Promise<JobOutcome>;
  /** A tarefa caiu sem tentativas sobrando (ou foi cancelada antes de rodar). */
  abandon(job: AiJob): Promise<void>;
}

export interface JobWorkerDeps {
  queue: JobQueue;
  handlers: Partial<Record<AiJobKind, JobHandler>>;
  workerId: string;
  leaseSeconds?: number;
  heartbeatMs?: number;
  /** Espera entre consultas com a fila vazia. */
  idleMs?: number;
  /** Chamado a cada volta (agendador de monitoramentos, limpeza). Erros só vão para o log. */
  onIdle?: () => Promise<void>;
  log?: (message: string) => void;
}

export interface JobWorker {
  start(): void;
  stop(): Promise<void>;
  /** Uma volta: encerra as caídas, pega e roda uma tarefa. true = rodou alguma. */
  tick(): Promise<boolean>;
  /** Acorda o trabalhador parado (tarefa nova na fila): não espera o intervalo ocioso. */
  poke(): void;
  readonly running: boolean;
}

export function createJobWorker(deps: JobWorkerDeps): JobWorker {
  const leaseSeconds = deps.leaseSeconds ?? 120;
  const heartbeatMs = deps.heartbeatMs ?? 15_000;
  const idleMs = deps.idleMs ?? 5_000;
  const log = deps.log ?? ((message: string) => console.warn(message));
  const kinds = Object.keys(deps.handlers) as AiJobKind[];
  let active = false;
  let loop: Promise<void> | null = null;
  let wake: (() => void) | null = null;

  async function runJob(job: AiJob): Promise<void> {
    const handler = deps.handlers[job.kind];
    if (!handler) {
      await deps.queue.finish(job.id, deps.workerId, { status: 'failed', errorCode: 'no_handler' });
      return;
    }
    const controller = new AbortController();
    const timer = setInterval(() => {
      deps.queue
        .heartbeat(job.id, deps.workerId, leaseSeconds)
        .then((ok) => {
          if (!ok) controller.abort();
        })
        .catch((error: unknown) =>
          log(`[fila] não renovou o lease de ${job.id}: ${String(error)}`),
        );
    }, heartbeatMs);
    let outcome: JobOutcome;
    try {
      outcome = await handler.run(job, controller.signal);
    } catch (error) {
      log(`[fila] tarefa ${job.id} (${job.kind}) falhou: ${String(error)}`);
      outcome =
        job.attempts >= job.maxAttempts
          ? { status: 'failed', errorCode: 'handler_error' }
          : { status: 'retry', errorCode: 'handler_error', retryAfterSeconds: 60 };
    } finally {
      clearInterval(timer);
    }
    await deps.queue.finish(job.id, deps.workerId, outcome);
    if (outcome.status === 'failed' && outcome.errorCode === 'handler_error') {
      // Erro fora do controle do handler na última tentativa: encerra o que ele deixou aberto
      // (a pesquisa não fica "rodando" para sempre ocupando uma vaga da fila).
      try {
        await handler.abandon(job);
      } catch (error) {
        log(`[fila] não encerrou a tarefa ${job.id} depois da falha: ${String(error)}`);
      }
    }
  }

  async function tick(): Promise<boolean> {
    if (kinds.length === 0) return false;
    for (const job of await deps.queue.expire()) {
      try {
        await deps.handlers[job.kind]?.abandon(job);
      } catch (error) {
        log(`[fila] não encerrou a tarefa caída ${job.id}: ${String(error)}`);
      }
    }
    const job = await deps.queue.claim(deps.workerId, kinds, leaseSeconds);
    if (!job) return false;
    await runJob(job);
    return true;
  }

  async function sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = null;
  }

  async function run(): Promise<void> {
    let failures = 0;
    while (active) {
      let ran = false;
      try {
        if (deps.onIdle) await deps.onIdle();
        ran = await tick();
        failures = 0;
      } catch (error) {
        failures += 1;
        log(`[fila] volta do trabalhador falhou (${failures}x): ${String(error)}`);
      }
      if (!active) break;
      if (!ran) await sleep(failures > 0 ? Math.min(60_000, idleMs * 2 ** failures) : idleMs);
    }
  }

  return {
    start() {
      if (active) return;
      active = true;
      loop = run();
    },
    /**
     * Para de pegar tarefas. A que está rodando termina normalmente; se o processo fechar antes,
     * o lease vence e ela é retomada na próxima abertura (nunca é cancelada por desligar o app).
     */
    async stop() {
      active = false;
      wake?.();
      await loop;
      loop = null;
    },
    tick,
    poke() {
      wake?.();
    },
    get running() {
      return active;
    },
  };
}
