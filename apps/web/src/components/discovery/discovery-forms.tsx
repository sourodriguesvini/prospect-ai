'use client';

import {
  DISCOVERY_DEPTH_LABELS,
  DISCOVERY_DEPTH_LIMITS,
  DISCOVERY_REQUEST_MAX,
  DiscoveryDepth,
  MONITOR_FREQUENCY_LABELS,
  MonitorFrequency,
  SIGNAL_TYPE_HINTS,
  SIGNAL_TYPE_LABELS,
  SignalType,
} from '@prospector/contracts';
import { Button, type ButtonProps } from '@prospector/ui';
import { Check } from 'lucide-react';
import { useId, useRef } from 'react';
import { nextItemFocus, useAnnouncer, type FocusTarget } from './announcers';
import {
  CheckboxGroup,
  FormMessage,
  SelectField,
  TextAreaField,
  TextField,
  fieldId,
} from '@/components/forms/fields';
import { SubmitButton } from '@/components/forms/submit-button';
import { useActionForm, type FormAction } from '@/components/forms/use-action-form';
import type { FormValues } from '@/lib/form-data';

/** Pedidos de exemplo: preenchem o campo (a pessoa revisa antes de pesquisar). */
const SUGGESTIONS = [
  'Clínicas em Ribeirão Preto com sinais de expansão',
  'Construtoras do interior de SP com lançamentos recentes',
  'Restaurantes em Campinas que abriram nova unidade este ano',
  'Empresas de tecnologia em BH contratando marketing',
];

const DEPTH_OPTIONS = [
  { value: '', label: 'Automática (pelo pedido)' },
  // Cada busca nova gasta 1 crédito da Tavily: o rótulo diz o máximo antes de rodar.
  ...DiscoveryDepth.options.map((value) => ({
    value,
    label: `${DISCOVERY_DEPTH_LABELS[value]} (até ${DISCOVERY_DEPTH_LIMITS[value].maxSearches} buscas)`,
  })),
];

const SIGNAL_OPTIONS = SignalType.options.map((value) => ({
  value,
  label: (
    <span>
      {SIGNAL_TYPE_LABELS[value]}
      <span className="sr-only"> ({SIGNAL_TYPE_HINTS[value]})</span>
    </span>
  ),
}));

/**
 * Pedido em linguagem natural, com filtros opcionais. A pesquisa roda em segundo plano (fila):
 * o envio só cria a pesquisa e leva para a tela dela.
 */
export function DiscoverySearchForm({
  action,
  disabledReason,
}: {
  action: FormAction;
  /** Buscador indisponível: o formulário aparece, mas não envia (e diz por quê). */
  disabledReason: string | null;
}) {
  const { state, values, formAction } = useActionForm(action, {});
  const field = { state, values };
  const requestRef = useRef<HTMLFormElement>(null);

  function suggest(text: string) {
    const input = requestRef.current?.elements.namedItem('request');
    if (input instanceof HTMLTextAreaElement) {
      input.value = text;
      input.focus();
    }
  }

  return (
    <form ref={requestRef} action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextAreaField
        name="request"
        label="O que você quer encontrar?"
        hint={`Escreva como falaria com alguém da equipe: setor, cidade ou região e, se quiser, sinais (expansão, vagas, lançamentos, site novo). Até ${DISCOVERY_REQUEST_MAX} caracteres.`}
        required
        rows={3}
        {...field}
      />
      <div className="space-y-2">
        <p id="sugestoes-descoberta" className="text-xs text-muted-foreground">
          Exemplos (preenchem o campo):
        </p>
        <ul aria-labelledby="sugestoes-descoberta" className="flex flex-wrap gap-2">
          {SUGGESTIONS.map((text) => (
            <li key={text} className="min-w-0 max-w-full">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                // Quebra a linha no celular em vez de passar da largura da tela.
                className="h-auto min-h-8 max-w-full whitespace-normal py-1.5 text-left"
                onClick={() => suggest(text)}
              >
                {text}
              </Button>
            </li>
          ))}
        </ul>
      </div>
      <details className="rounded-md border border-border p-4 [&_summary]:cursor-pointer">
        <summary className="text-sm font-medium">Filtros opcionais</summary>
        <div className="mt-4 space-y-5">
          <div className="grid gap-5 md:grid-cols-[1fr_8rem_10rem]">
            <TextField name="city" label="Cidade" maxLength={80} {...field} />
            <TextField name="uf" label="UF" maxLength={2} autoCapitalize="characters" {...field} />
            <TextField
              name="quantity"
              label="Quantas empresas"
              hint={`Até ${DISCOVERY_DEPTH_LIMITS.quick.maxProspects} na rápida, ${DISCOVERY_DEPTH_LIMITS.standard.maxProspects} na padrão e ${DISCOVERY_DEPTH_LIMITS.deep.maxProspects} na aprofundada.`}
              inputMode="numeric"
              maxLength={2}
              {...field}
            />
          </div>
          <SelectField
            name="depth"
            label="Profundidade"
            hint="Rápida: até 3 buscas. Padrão: até 6. Aprofundada: até 10. Cada busca nova gasta 1 crédito da Tavily; buscas repetidas em 24 horas são reaproveitadas, sem gastar crédito."
            options={DEPTH_OPTIONS}
            className="max-w-sm"
            {...field}
          />
          <CheckboxGroup
            name="signals"
            label="Sinais que importam"
            hint="Nenhum marcado: o sistema escolhe pelo pedido e pela sua oferta."
            options={SIGNAL_OPTIONS}
            columns="sm:grid-cols-3"
            {...field}
          />
        </div>
      </details>
      {disabledReason ? (
        <p id="pesquisa-indisponivel" className="text-sm text-warning">
          {disabledReason}
        </p>
      ) : null}
      {disabledReason ? (
        <Button
          type="button"
          aria-disabled="true"
          aria-describedby="pesquisa-indisponivel"
          className="opacity-60"
        >
          Pesquisar
        </Button>
      ) : (
        <SubmitButton pendingLabel="Criando a pesquisa…">Pesquisar</SubmitButton>
      )}
    </form>
  );
}

/**
 * Depois do sucesso: o que anunciar na região de status da lista e para onde vai o foco.
 * `self` = o próprio botão, que continua no lugar (Salvar → "Salva", Pausar → "Retomar");
 * `next` = o título do próximo item, porque este vai sumir (ou o título da lista, sem próximo).
 */
export interface ActionSuccess {
  message: string;
  focus?: 'self' | 'next';
}

/**
 * Embrulha a Server Action: calcula o destino do foco antes (o item pode sumir com a resposta)
 * e, se deu certo, anuncia na lista em volta. Ação que redireciona não chega ao anúncio.
 */
function useAnnouncedAction(
  action: FormAction,
  success: ActionSuccess | undefined,
  elementId: string,
): FormAction {
  const announce = useAnnouncer();
  return async (prev, formData) => {
    const element = document.getElementById(elementId);
    const focus: FocusTarget =
      success?.focus === 'self'
        ? { id: elementId }
        : success?.focus === 'next'
          ? nextItemFocus(element)
          : null;
    const result = await action(prev, formData);
    if (result?.status === 'saved' && success && announce) announce(success.message, focus);
    return result;
  };
}

/**
 * Botão de uma ação só (confirmar, cancelar, salvar, investigar…), com o erro logo abaixo. As
 * decisões são sempre da pessoa: a IA nunca aperta estes botões.
 */
export function ActionButton({
  action,
  children,
  pendingLabel,
  variant = 'secondary',
  size = 'sm',
  hidden,
  done,
  success,
}: {
  action: FormAction;
  children: React.ReactNode;
  pendingLabel: string;
  variant?: ButtonProps['variant'];
  size?: ButtonProps['size'];
  hidden?: Record<string, string>;
  /**
   * Ação já feita (ex.: "Salva"): o botão continua no mesmo lugar, indisponível, mostrando o
   * estado. Some não: o foco de quem acabou de apertar continua nele.
   */
  done?: React.ReactNode;
  success?: ActionSuccess;
}) {
  const buttonId = useId();
  const { state, formAction } = useActionForm(useAnnouncedAction(action, success, buttonId), {});
  return (
    <form action={formAction} className="inline-flex max-w-xs flex-col gap-1">
      {hidden
        ? Object.entries(hidden).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))
        : null}
      <SubmitButton
        id={buttonId}
        variant={variant}
        size={size}
        pendingLabel={pendingLabel}
        {...(done
          ? {
              'aria-disabled': true,
              onClick: (event: React.MouseEvent) => event.preventDefault(),
              className: 'aria-disabled:cursor-default aria-disabled:opacity-100',
            }
          : {})}
      >
        {done ? (
          <>
            <Check aria-hidden="true" className="size-4" />
            {done}
          </>
        ) : (
          children
        )}
      </SubmitButton>
      {state.status === 'error' ? (
        <p role="alert" className="text-xs text-danger">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}

/**
 * Ignorar com motivo opcional (fica na auditoria; a empresa sai das listas). Depois, a lista
 * anuncia "<nome> ignorada." e o foco vai para o próximo item (ou para o título da lista).
 */
export function DismissForm({
  action,
  prospectId,
  name,
}: {
  action: FormAction;
  prospectId: string;
  /** Nome da empresa: contexto do botão para leitor de tela e mensagem depois de ignorar. */
  name: string;
}) {
  const id = fieldId(`reason-${prospectId}`);
  const { state, values, formAction } = useActionForm(
    useAnnouncedAction(action, { message: `${name} ignorada.`, focus: 'next' }, id),
    {},
  );
  return (
    <details className="text-sm">
      <summary className="inline-flex h-8 cursor-pointer items-center rounded-md border border-border px-3.5">
        Ignorar<span className="sr-only">: {name}</span>
      </summary>
      <form action={formAction} noValidate className="mt-3 max-w-sm space-y-3">
        <FormMessage state={state} />
        <div className="space-y-1.5">
          <label htmlFor={id} className="text-sm font-medium">
            Motivo (opcional)
          </label>
          <input
            id={id}
            name="reason"
            maxLength={200}
            defaultValue={typeof values.reason === 'string' ? values.reason : ''}
            className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm"
          />
        </div>
        <SubmitButton variant="destructive" size="sm" pendingLabel="Ignorando…">
          Ignorar esta empresa<span className="sr-only">: {name}</span>
        </SubmitButton>
      </form>
    </details>
  );
}

const FREQUENCY_OPTIONS = MonitorFrequency.options.map((value) => ({
  value,
  label: MONITOR_FREQUENCY_LABELS[value],
}));

/** Monitoramento: o mesmo pedido roda sozinho na frequência escolhida, com teto de buscas. */
export function MonitorForm({ action, initial }: { action: FormAction; initial: FormValues }) {
  const { state, values, formAction } = useActionForm(action, {
    frequency: 'daily',
    maxSearches: '3',
    maxProspects: '15',
    ...initial,
  });
  const field = { state, values };
  return (
    <form action={formAction} noValidate className="space-y-5">
      <FormMessage state={state} />
      <TextField name="name" label="Nome" required maxLength={120} {...field} />
      <TextAreaField
        name="request"
        label="Pedido"
        hint="O mesmo texto de uma pesquisa. Cada execução marca as empresas que ainda não tinham aparecido."
        required
        rows={3}
        {...field}
      />
      <div className="grid gap-5 md:grid-cols-3">
        <SelectField name="frequency" label="Frequência" options={FREQUENCY_OPTIONS} {...field} />
        <TextField
          name="maxSearches"
          label="Buscas por execução"
          hint="De 1 a 6 (cada busca nova gasta 1 crédito)."
          inputMode="numeric"
          maxLength={1}
          {...field}
        />
        <TextField
          name="maxProspects"
          label="Empresas por execução"
          hint="De 1 a 30."
          inputMode="numeric"
          maxLength={2}
          {...field}
        />
      </div>
      <SubmitButton pendingLabel="Criando…">Criar monitoramento</SubmitButton>
    </form>
  );
}
