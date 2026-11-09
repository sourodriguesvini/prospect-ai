import { AiError } from './errors';

export interface LimiterTicket {
  /** 0 = começa já; n = n-ésimo na fila de espera. */
  position: number;
  /** Resolve com a função que devolve a vaga (chame sempre, de preferência num `finally`). */
  ready: Promise<() => void>;
  /**
   * Desiste do pedido: sai da fila ou, se a vaga já foi concedida e ninguém a pegou, devolve
   * na hora. Pode ser chamada mais de uma vez e depois de `release`.
   */
  cancel(): void;
}

export interface Limiter {
  /** Reserva uma vaga ou entra na fila. Fila cheia lança `AiError('busy')` na hora. */
  enqueue(signal?: AbortSignal): LimiterTicket;
  readonly active: number;
  readonly waiting: number;
}

interface Waiter {
  grant: (release: () => void) => void;
}

/** Promessa rejeitada que não vira "rejeição não tratada" se ninguém esperar por ela. */
function quietly<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/**
 * Limite de concorrência da IA local (ADR-0008): no máximo `maxConcurrent` gerações ao mesmo
 * tempo e `maxQueue` esperando. Protege a GPU que o usuário também usa para trabalhar.
 */
export function createLimiter(options: { maxConcurrent: number; maxQueue: number }): Limiter {
  const maxConcurrent = Math.max(1, Math.floor(options.maxConcurrent));
  const maxQueue = Math.max(0, Math.floor(options.maxQueue));
  let active = 0;
  const queue: Waiter[] = [];

  function makeRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = queue.shift();
      if (next) next.grant(makeRelease());
      else active -= 1;
    };
  }

  return {
    get active() {
      return active;
    },
    get waiting() {
      return queue.length;
    },
    enqueue(signal) {
      if (signal?.aborted) {
        return {
          position: 0,
          ready: quietly(Promise.reject(new AiError('cancelled'))),
          cancel: () => undefined,
        };
      }
      if (active < maxConcurrent) {
        active += 1;
        const release = makeRelease();
        return { position: 0, ready: Promise.resolve(release), cancel: release };
      }
      if (queue.length >= maxQueue) throw new AiError('busy');

      let granted: (() => void) | null = null;
      let settled = false;
      let waiter!: Waiter;
      let fail!: (error: AiError) => void;
      const leaveQueue = () => {
        const index = queue.indexOf(waiter);
        if (index !== -1) queue.splice(index, 1);
        signal?.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        leaveQueue();
        fail(new AiError('cancelled'));
      };
      const ready = quietly(
        new Promise<() => void>((resolve, reject) => {
          fail = reject;
          waiter = {
            grant: (release) => {
              signal?.removeEventListener('abort', onAbort);
              settled = true;
              granted = release;
              resolve(release);
            },
          };
        }),
      );
      signal?.addEventListener('abort', onAbort, { once: true });
      queue.push(waiter);
      return {
        position: queue.length,
        ready,
        cancel() {
          if (granted) {
            granted();
            return;
          }
          if (settled) return;
          settled = true;
          leaveQueue();
          fail(new AiError('cancelled'));
        },
      };
    },
  };
}
