'use client';

import { BrandAssetKind, RUBRIC_SCALE, type RubricContent } from '@prospector/contracts';
import { Button, Checkbox, FieldError, Input, Label, Textarea, cn } from '@prospector/ui';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import { FormMessage, fieldId } from '@/components/forms/fields';
import type { FormAction } from '@/components/forms/use-action-form';
import { errorsFor, IDLE } from '@/lib/form-state';
import { BRAND_ASSET_LABELS } from '@/lib/strategy-labels';
import { WeightTotal, parseWeight } from './weight-total';

interface CriterionDraft {
  uid: number;
  key: string;
  label: string;
  description: string;
  weight: string;
  evidenceRequired: string[];
  /** Identificador já usado numa versão salva: fica fixo (as auditorias o referenciam). */
  keyLocked: boolean;
}

/** Identificador estável a partir do rótulo: minúsculas, sem acento, com _ (ex.: consistencia_canais). */
function keyFromLabel(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, 'c_$1')
    .slice(0, 40);
}

/**
 * Editor da rubrica de auditoria visual (escala fixa de 1 a 5). Pesos inteiros somam 100;
 * a soma fica numa barra fixa junto do botão de salvar, e o servidor confere de novo. Salvar cria
 * nova versão. `saved`: a rubrica inicial já é uma versão salva, então os identificadores dela
 * ficam fixos.
 */
export function RubricEditor({
  action,
  initial,
  saved,
  cancelHref,
}: {
  action: FormAction;
  initial: RubricContent;
  saved: boolean;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [nextUid, setNextUid] = useState(initial.criteria.length);
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() =>
    initial.criteria.map((c, uid) => ({ ...c, uid, weight: String(c.weight), keyLocked: saved })),
  );
  // Depois de adicionar ou remover, o foco vai para um lugar previsível (KI-050).
  const focusTarget = useRef<string | null>(null);
  // Os erros do servidor vêm por posição (`criteria.2.weight`): depois de remover um critério,
  // ficam escondidos até o próximo envio, para não aparecerem no critério errado.
  const [errorsHiddenUntil, setErrorsHiddenUntil] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const visibleState =
    errorsHiddenUntil !== null && (state.at ?? 0) <= errorsHiddenUntil
      ? { ...state, fieldErrors: undefined }
      : state;
  const baseId = useId();
  const total = criteria.reduce((sum, c) => sum + (parseWeight(c.weight) ?? 0), 0);
  const addButtonId = `${baseId}-adicionar`;
  const headingId = (uid: number) => `${baseId}-${uid}-titulo`;

  // Roda depois de cada renderização: se adicionar ou remover pediu foco, aplica e limpa o pedido.
  useEffect(() => {
    if (!focusTarget.current) return;
    document.getElementById(focusTarget.current)?.focus();
    focusTarget.current = null;
  });

  function update(uid: number, patch: Partial<CriterionDraft>) {
    setCriteria((list) => list.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  }

  function add() {
    setCriteria((list) => [
      ...list,
      {
        uid: nextUid,
        key: '',
        label: '',
        description: '',
        weight: '0',
        evidenceRequired: [],
        keyLocked: false,
      },
    ]);
    focusTarget.current = `${baseId}-${nextUid}-label`;
    setNextUid((n) => n + 1);
  }

  function remove(uid: number) {
    const index = criteria.findIndex((c) => c.uid === uid);
    const neighbour = criteria[index + 1] ?? criteria[index - 1];
    setCriteria((list) => list.filter((c) => c.uid !== uid));
    setErrorsHiddenUntil(state.at ?? 0);
    const left = criteria.length - 1;
    setAnnouncement(`Critério removido. ${left === 1 ? 'Resta 1.' : `Restam ${left}.`}`);
    focusTarget.current = neighbour ? headingId(neighbour.uid) : addButtonId;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = {
      criteria: criteria.map((c) => ({
        key: c.key || keyFromLabel(c.label),
        label: c.label,
        description: c.description,
        weight: parseWeight(c.weight) ?? c.weight,
        evidenceRequired: c.evidenceRequired,
      })),
    };
    const formData = new FormData();
    formData.set('payload', JSON.stringify(content));
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <FormMessage state={state} />
      <p role="status" className="sr-only">
        {announcement}
      </p>
      <p className="text-sm text-muted-foreground">
        Cada critério é avaliado pelo auditor visual de {RUBRIC_SCALE.min} a {RUBRIC_SCALE.max}, com
        base nas capturas marcadas como evidência.
      </p>
      <ol className="space-y-4">
        {criteria.map((c, index) => {
          const path = `criteria.${index}`;
          const id = (field: string) => `${baseId}-${c.uid}-${field}`;
          const errors = (field: string) => errorsFor(visibleState, `${path}.${field}`);
          const weightErrors = errors('weight');
          const which = <span className="sr-only"> do critério {index + 1}</span>;
          return (
            <li key={c.uid} className="space-y-4 rounded-[var(--radius-tile)] border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3
                  id={headingId(c.uid)}
                  tabIndex={-1}
                  className="rounded-sm text-sm font-semibold outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  Critério {index + 1}
                  {c.label ? (
                    <span className="font-normal text-muted-foreground"> — {c.label}</span>
                  ) : null}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => remove(c.uid)}
                  disabled={criteria.length === 1}
                >
                  <Trash2 aria-hidden="true" className="size-4" />
                  Remover<span className="sr-only"> critério {index + 1}</span>
                </Button>
              </div>
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_8rem]">
                <div className="space-y-1.5">
                  <Label htmlFor={id('label')}>Nome{which}</Label>
                  <Input
                    id={id('label')}
                    value={c.label}
                    maxLength={80}
                    onChange={(e) => update(c.uid, { label: e.target.value })}
                    onBlur={() => (c.key ? null : update(c.uid, { key: keyFromLabel(c.label) }))}
                    aria-invalid={errors('label') ? true : undefined}
                    aria-describedby={errors('label') ? `${id('label')}-erro` : undefined}
                  />
                  <FieldError id={`${id('label')}-erro`} messages={errors('label')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={id('key')}>Identificador{which}</Label>
                  <Input
                    id={id('key')}
                    value={c.key}
                    maxLength={40}
                    readOnly={c.keyLocked}
                    className={c.keyLocked ? 'bg-muted text-muted-foreground' : undefined}
                    onChange={(e) => update(c.uid, { key: e.target.value })}
                    aria-invalid={errors('key') ? true : undefined}
                    aria-describedby={`${id('key')}-ajuda${errors('key') ? ` ${id('key')}-erro` : ''}`}
                  />
                  <p id={`${id('key')}-ajuda`} className="text-xs text-muted-foreground">
                    {c.keyLocked
                      ? 'Já salvo: não muda mais, porque as auditorias usam este nome.'
                      : 'Fica fixo depois de salvo; as auditorias usam este nome.'}
                  </p>
                  <FieldError id={`${id('key')}-erro`} messages={errors('key')} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={id('weight')}>Peso{which}</Label>
                  <Input
                    id={id('weight')}
                    value={c.weight}
                    inputMode="numeric"
                    onChange={(e) => update(c.uid, { weight: e.target.value })}
                    aria-invalid={weightErrors ? true : undefined}
                    aria-describedby={weightErrors ? `${id('weight')}-erro` : undefined}
                  />
                  <FieldError id={`${id('weight')}-erro`} messages={weightErrors} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={id('description')}>O que observar{which}</Label>
                <Textarea
                  id={id('description')}
                  rows={2}
                  value={c.description}
                  maxLength={600}
                  onChange={(e) => update(c.uid, { description: e.target.value })}
                  aria-invalid={errors('description') ? true : undefined}
                  aria-describedby={errors('description') ? `${id('description')}-erro` : undefined}
                />
                <FieldError id={`${id('description')}-erro`} messages={errors('description')} />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Evidências exigidas{which}</legend>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-3">
                  {BrandAssetKind.options.map((kind) => (
                    <label key={kind} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={c.evidenceRequired.includes(kind)}
                        onChange={(e) =>
                          update(c.uid, {
                            evidenceRequired: e.target.checked
                              ? [...c.evidenceRequired, kind]
                              : c.evidenceRequired.filter((k) => k !== kind),
                          })
                        }
                      />
                      {BRAND_ASSET_LABELS[kind]}
                    </label>
                  ))}
                </div>
                <FieldError id={`${id('evidence')}-erro`} messages={errors('evidenceRequired')} />
              </fieldset>
            </li>
          );
        })}
      </ol>
      <Button id={addButtonId} variant="secondary" onClick={add} disabled={criteria.length >= 15}>
        <Plus aria-hidden="true" className="size-4" />
        Adicionar critério
      </Button>
      <FieldError id={fieldId('criteria')} messages={visibleState.fieldErrors?.criteria} />
      {/*
        Barra de ações: fica fixa no rodapé em telas a partir de sm com altura suficiente
        (globals.css, `data-sticky-actions`), com folga de rolagem para o campo focado não ficar
        atrás dela (WCAG 2.4.11). No celular, fica no fim do formulário (KI-050).
      */}
      <div
        data-sticky-actions=""
        className={cn(
          'z-10 flex flex-wrap items-center justify-between gap-3',
          'rounded-[var(--radius-tile)] border bg-surface px-4 py-3 shadow-sm',
        )}
      >
        <WeightTotal total={total} />
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="ghost">
            <Link href={cancelHref}>Cancelar</Link>
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? 'Salvando…' : 'Salvar rubrica'}
          </Button>
        </div>
      </div>
    </form>
  );
}
