'use client';

import type { AiErrorCode, CopilotRequestInput } from '@prospector/contracts';
import { Alert, Button, Label, NativeSelect, Well } from '@prospector/ui';
import { ArrowUp, RotateCcw, Square } from 'lucide-react';
import { useRouter } from 'next/navigation';
import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
} from 'react';
import {
  applyEvent,
  buildHistory,
  createEventDecoder,
  describeUsage,
  historyIsTrimmed,
  httpFailure,
  type Turn,
} from '@/lib/copilot';
import { RichText } from './rich-text';

type Phase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'queued'; position: number }
  | { kind: 'generating' };

const SUGGESTIONS = [
  'O que o Prospector já faz hoje?',
  'Como descrever o cliente ideal de uma agência de branding?',
  'Revise este texto de abordagem e aponte o que soa genérico:\n\n',
];

/** Distância do fim da conversa em que a rolagem automática continua acompanhando. */
const STICK_PX = 96;
const MAX_CHARS = 8000;
/** A partir daqui o campo mostra quantos caracteres faltam (o excesso colado seria cortado). */
const COUNTER_FROM = 7000;
/** Um segundo clique logo depois de enviar cairia no botão Parar, que ocupa o mesmo lugar. */
const STOP_GUARD_MS = 600;
/** Falhas que fazem sentido repetir com o mesmo pedido. */
const RETRYABLE = new Set<AiErrorCode>([
  'busy',
  'insufficient_vram',
  'timeout',
  'runtime_unavailable',
  'provider_error',
  'cancelled',
]);

const integer = new Intl.NumberFormat('pt-BR');

/**
 * Conversa com a IA local (ADR-0008). A resposta chega em streaming de `/api/copiloto`; a
 * conversa vive só nesta aba. Ao terminar, a página atualiza o painel de estado da IA local.
 */
export function CopilotChat({
  models,
  defaultModel,
  unavailable,
}: {
  models: readonly string[];
  defaultModel: string | null;
  /** Aviso mostrado antes da primeira pergunta quando o servidor já sabe que não vai responder. */
  unavailable: string | null;
}) {
  const router = useRouter();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [model, setModel] = useState('');
  const [think, setThink] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  /** Uma frase por vez para leitores de tela, fora do log (que fica quieto durante o streaming). */
  const [announcement, setAnnouncement] = useState('');
  const controllerRef = useRef<AbortController | null>(null);
  const sentAtRef = useRef(0);
  const logRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickRef = useRef(true);
  const inputId = useId();
  const hintId = useId();
  const modelId = useId();
  const counterId = useId();
  const busy = phase.kind !== 'idle';
  // Um modelo que sumiu da lista depois de "Atualizar" volta para o automático.
  const selectedModel = model && models.includes(model) ? model : '';

  useEffect(() => {
    const log = logRef.current;
    if (log && stickRef.current) log.scrollTop = log.scrollHeight;
  }, [turns]);

  // Sair da página no meio de uma resposta interrompe a geração no Ollama.
  useEffect(() => () => controllerRef.current?.abort(), []);

  /** Devolve o foco ao campo só se ele não estava em outro lugar, e nunca em tela de toque. */
  function refocusInput() {
    const active = document.activeElement;
    const wasHere = !active || active === document.body || formRef.current?.contains(active);
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (wasHere && !touch) inputRef.current?.focus({ preventScroll: true });
  }

  async function send(text: string, base: readonly Turn[] = turns) {
    const content = text.trim();
    if (!content || busy) return;
    const user: Turn = { id: crypto.randomUUID(), role: 'user', content };
    const assistantId = crypto.randomUUID();
    const body: CopilotRequestInput = {
      schemaVersion: 1,
      messages: buildHistory([...base, user]),
      think,
      ...(selectedModel ? { model: selectedModel } : {}),
    };
    const update = (change: (turn: Turn) => Turn) =>
      setTurns((current) => current.map((turn) => (turn.id === assistantId ? change(turn) : turn)));

    stickRef.current = true;
    setTurns([...base, user, { id: assistantId, role: 'assistant', content: '' }]);
    setDraft((current) => (current.trim() === content ? '' : current));
    setPhase({ kind: 'sending' });
    setAnnouncement('Enviando a pergunta…');
    sentAtRef.current = performance.now();
    const controller = new AbortController();
    controllerRef.current = controller;
    let settled = false;
    let received = false;
    let failed: AiErrorCode | null = null;
    // Avisos entram no log com aria-live desligado durante a geração: são anunciados por aqui.
    let notices = 0;

    try {
      const response = await fetch('/api/copiloto', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const message = await response
          .json()
          .then((data: { error?: unknown }) =>
            typeof data.error === 'string' ? data.error : undefined,
          )
          .catch(() => undefined);
        const error = httpFailure(response.status, message);
        failed = error?.code ?? 'provider_error';
        update((turn) => ({ ...turn, error }));
        settled = true;
        return;
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      const decoder = createEventDecoder();
      for (;;) {
        const { value, done } = await reader.read();
        const events = done ? decoder.flush() : decoder.push(value);
        for (const event of events) {
          if (event.type === 'queued') {
            setPhase({ kind: 'queued', position: event.position });
            setAnnouncement(`Na fila, posição ${event.position}.`);
          }
          if (event.type === 'start') {
            setPhase({ kind: 'generating' });
            setAnnouncement('O Copiloto está respondendo…');
          }
          if (event.type === 'notice') {
            notices += 1;
            setAnnouncement(event.message);
          }
          if (event.type === 'delta' || event.type === 'thinking') received = true;
          if (event.type === 'done') {
            settled = true;
            setAnnouncement(
              notices === 0
                ? 'Resposta pronta.'
                : `Resposta pronta, com ${notices === 1 ? 'um aviso' : `${notices} avisos`} acima da resposta.`,
            );
          }
          if (event.type === 'error') {
            settled = true;
            failed = event.code;
          }
          update((turn) => applyEvent(turn, event));
        }
        if (done) break;
      }
    } catch {
      settled = true;
      failed = controller.signal.aborted ? 'cancelled' : 'runtime_unavailable';
      update((turn) => ({
        ...turn,
        error: controller.signal.aborted
          ? { code: 'cancelled', message: 'Você interrompeu a resposta.' }
          : {
              code: 'runtime_unavailable',
              message: 'A conexão com o Prospector caiu. O app ainda está rodando no terminal?',
            },
      }));
    } finally {
      if (!settled) {
        failed = 'provider_error';
        update((turn) => ({
          ...turn,
          error: {
            code: 'provider_error',
            message: 'A conexão terminou antes de a resposta ficar completa. Tente de novo.',
          },
        }));
      }
      // Falhou antes de qualquer resposta: a pergunta volta para o campo, sem redigitar.
      if (failed && !received) setDraft((current) => current || content);
      if (failed === 'cancelled') setAnnouncement('Você interrompeu a resposta.');
      else if (failed) setAnnouncement(''); // o alerta na conversa já é anunciado
      controllerRef.current = null;
      setPhase({ kind: 'idle' });
      router.refresh();
      refocusInput();
    }
  }

  /** Reenvia a pergunta que falhou, com o mesmo histórico de antes dela. */
  function retry(assistantId: string) {
    const index = turns.findIndex((turn) => turn.id === assistantId);
    const question = turns[index - 1];
    if (index < 1 || question?.role !== 'user') return;
    void send(question.content, turns.slice(0, index - 1));
  }

  function stop(event?: MouseEvent<HTMLButtonElement>) {
    // Duplo clique em Enviar ou Enter repetido não devem cancelar a resposta que acabou de sair.
    if (event && (event.detail > 1 || performance.now() - sentAtRef.current < STOP_GUARD_MS)) {
      return;
    }
    controllerRef.current?.abort();
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void send(draft);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const composing = event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
    if (event.key === 'Escape' && busy) {
      event.preventDefault();
      controllerRef.current?.abort();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault();
      void send(draft);
    }
  }

  function startOver() {
    setTurns([]);
    setAnnouncement('Conversa apagada.');
    inputRef.current?.focus();
  }

  function pickSuggestion(text: string) {
    setDraft(text);
    const input = inputRef.current;
    if (input) {
      input.focus();
      requestAnimationFrame(() => input.setSelectionRange(text.length, text.length));
    }
  }

  const last = turns.at(-1);
  const trimmed = historyIsTrimmed(turns);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {turns.length === 0 ? (
        <Well className="flex min-h-48 flex-1 flex-col justify-end gap-4 p-5 sm:min-h-72">
          {unavailable ? (
            <Alert tone="warning" role="note">
              {unavailable}
            </Alert>
          ) : null}
          <div className="space-y-1">
            <p className="text-lg">Pergunte em português, do jeito que você falaria.</p>
            <p className="text-pretty text-sm text-muted-foreground">
              O modelo roda nesta máquina. Ele conhece o estado do Prospector, mas ainda não lê
              empresas, dossiês nem a internet: quando não souber, deve dizer que não sabe.
            </p>
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Sugestões de pergunta">
            {SUGGESTIONS.map((text) => (
              <li key={text} className="min-w-0">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-auto min-h-8 whitespace-normal py-1.5 text-left"
                  onClick={() => pickSuggestion(text)}
                >
                  {text.trim()}
                </Button>
              </li>
            ))}
          </ul>
        </Well>
      ) : (
        <div
          ref={logRef}
          role="log"
          aria-label="Conversa com o Copiloto"
          aria-live={busy ? 'off' : 'polite'}
          tabIndex={0}
          onScroll={(event) => {
            const el = event.currentTarget;
            stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX;
          }}
          className="max-h-[62svh] min-h-48 flex-1 overflow-y-auto rounded-[var(--radius-tile)] bg-muted p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:min-h-72 sm:p-4"
        >
          {trimmed ? (
            <p className="mb-4 px-1 text-xs text-muted-foreground">
              A conversa passou do limite desta tela: as mensagens mais antigas já não são enviadas
              ao modelo.
            </p>
          ) : null}
          <ol className="space-y-4">
            {turns.map((turn) =>
              turn.role === 'user' ? (
                <li key={turn.id} className="flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-tile)] bg-primary px-4 py-3 text-sm text-primary-foreground [overflow-wrap:anywhere]">
                    <span className="sr-only">Você: </span>
                    {turn.content}
                  </p>
                </li>
              ) : (
                <li key={turn.id} className="max-w-[92%] space-y-2">
                  <p className="px-1 text-xs text-muted-foreground">Copiloto</p>
                  {turn.notices?.map((notice) => (
                    <Alert key={notice} tone="warning" role="status">
                      {notice}
                    </Alert>
                  ))}
                  {turn.thinking ? (
                    <details className="rounded-[var(--radius-tile)] bg-surface px-4 py-2.5 text-sm">
                      <summary className="cursor-pointer text-muted-foreground">
                        Raciocínio do modelo
                      </summary>
                      <p className="mt-2 whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                        {turn.thinking}
                      </p>
                    </details>
                  ) : null}
                  {turn.content ? (
                    <div className="whitespace-pre-wrap rounded-[var(--radius-tile)] bg-surface px-4 py-3 text-sm leading-relaxed [overflow-wrap:anywhere]">
                      <RichText text={turn.content} />
                    </div>
                  ) : null}
                  {busy && turn === last ? <Progress phase={phase} turn={turn} /> : null}
                  {turn.doneReason === 'length' ? (
                    <Alert tone="warning" role="status">
                      {turn.content
                        ? 'A resposta foi cortada no limite de tamanho. Peça "continue" para ver o resto.'
                        : 'O modelo gastou todo o limite pensando e não chegou a escrever a resposta. Desligue "Pensar antes de responder" e envie de novo.'}
                    </Alert>
                  ) : null}
                  {turn.error?.code === 'cancelled' ? (
                    <p className="px-1 text-xs text-muted-foreground">{turn.error.message}</p>
                  ) : turn.error ? (
                    <Alert tone="danger">{turn.error.message}</Alert>
                  ) : null}
                  {turn.error && RETRYABLE.has(turn.error.code) && turn === last && !busy ? (
                    <Button variant="secondary" size="sm" onClick={() => retry(turn.id)}>
                      <RotateCcw aria-hidden="true" className="size-3.5" />
                      Tentar de novo
                    </Button>
                  ) : null}
                  {turn.usage && turn.model ? (
                    <p className="px-1 text-xs text-muted-foreground">
                      {describeUsage(turn.model, turn.usage)}
                    </p>
                  ) : null}
                </li>
              ),
            )}
          </ol>
        </div>
      )}

      <form ref={formRef} onSubmit={onSubmit} className="mt-4 space-y-3">
        <Label htmlFor={inputId} className="sr-only">
          Mensagem para o Copiloto
        </Label>
        <textarea
          id={inputId}
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
          maxLength={MAX_CHARS}
          placeholder="Escreva sua pergunta"
          aria-describedby={draft.length >= COUNTER_FROM ? `${hintId} ${counterId}` : hintId}
          className="block w-full resize-y rounded-[var(--radius-tile)] border border-input bg-surface px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring"
        />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <p id={hintId}>Enter envia; Shift+Enter quebra a linha; Esc interrompe a resposta.</p>
          <p id={counterId} aria-live="polite">
            {draft.length >= COUNTER_FROM
              ? `${integer.format(draft.length)} de ${integer.format(MAX_CHARS)} caracteres`
              : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex min-w-0 items-center gap-2">
            <Label htmlFor={modelId} className="text-xs font-normal text-muted-foreground">
              Modelo
            </Label>
            <NativeSelect
              id={modelId}
              value={selectedModel}
              onChange={(event) => setModel(event.target.value)}
              disabled={busy}
              className="h-8 w-auto min-w-0 max-w-56 text-xs"
            >
              <option value="">
                {defaultModel ? `Automático (${defaultModel})` : 'Automático'}
              </option>
              {models.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </NativeSelect>
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={think}
              onChange={(event) => setThink(event.target.checked)}
              disabled={busy}
              className="size-4 accent-primary"
            />
            Pensar antes de responder <span className="text-muted-foreground">(mais lento)</span>
          </label>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={startOver}
              disabled={turns.length === 0 || busy}
            >
              Nova conversa
            </Button>
            {busy ? (
              <Button variant="secondary" size="sm" onClick={stop}>
                <Square aria-hidden="true" className="size-3.5" />
                Parar
              </Button>
            ) : (
              <Button type="submit" size="sm" disabled={!draft.trim()}>
                <ArrowUp aria-hidden="true" className="size-4" />
                Enviar
              </Button>
            )}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          A conversa fica só nesta aba: não é salva e some ao recarregar. Nesta versão o Copiloto
          não lê seus dados salvos nem a internet e não envia nada.
        </p>
      </form>
    </div>
  );
}

function Progress({ phase, turn }: { phase: Phase; turn: Turn }) {
  let text: string;
  if (phase.kind === 'queued') {
    text = `Na fila (posição ${phase.position}). Outro pedido está sendo atendido.`;
  } else if (turn.content) {
    text = 'Escrevendo…';
  } else if (turn.thinking) {
    text = 'Pensando…';
  } else if (phase.kind === 'generating') {
    text = 'Gerando. Se o modelo não estava na memória, o primeiro pedido leva alguns segundos.';
  } else {
    text = 'Enviando…';
  }
  return (
    <p className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
      <span
        aria-hidden="true"
        className="size-1.5 rounded-full bg-accent motion-safe:animate-pulse"
      />
      {text}
    </p>
  );
}
