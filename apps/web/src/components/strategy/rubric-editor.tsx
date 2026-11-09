'use client';

import { BrandAssetKind, RUBRIC_SCALE, type RubricContent } from '@prospector/contracts';
import { Button, Checkbox, FieldError, Input, Label, Textarea, cn } from '@prospector/ui';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { startTransition, useActionState, useId, useState, type FormEvent } from 'react';
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
 * a soma aparece enquanto se edita, e o servidor confere de novo. Salvar cria nova versão.
 */
export function RubricEditor({
  action,
  initial,
  cancelHref,
}: {
  action: FormAction;
  initial: RubricContent;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [nextUid, setNextUid] = useState(initial.criteria.length);
  const [criteria, setCriteria] = useState<CriterionDraft[]>(() =>
    initial.criteria.map((c, uid) => ({ ...c, uid, weight: String(c.weight) })),
  );
  const baseId = useId();
  const total = criteria.reduce((sum, c) => sum + (parseWeight(c.weight) ?? 0), 0);

  function update(uid: number, patch: Partial<CriterionDraft>) {
    setCriteria((list) => list.map((c) => (c.uid === uid ? { ...c, ...patch } : c)));
  }

  function add() {
    setCriteria((list) => [
      ...list,
      { uid: nextUid, key: '', label: '', description: '', weight: '0', evidenceRequired: [] },
    ]);
    setNextUid((n) => n + 1);
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
      <p className="text-sm text-muted-foreground">
        Cada critério é avaliado pelo auditor visual de {RUBRIC_SCALE.min} a {RUBRIC_SCALE.max}, com
        base nas capturas marcadas como evidência.
      </p>
      <ol className="space-y-4">
        {criteria.map((c, index) => {
          const path = `criteria.${index}`;
          const id = (field: string) => `${baseId}-${c.uid}-${field}`;
          const errors = (field: string) => errorsFor(state, `${path}.${field}`);
          const weightErrors = errors('weight');
          const which = <span className="sr-only"> do critério {index + 1}</span>;
          return (
            <li key={c.uid} className="space-y-4 rounded-[var(--radius-tile)] border p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">
                  Critério {index + 1}
                  {c.label ? (
                    <span className="font-normal text-muted-foreground"> — {c.label}</span>
                  ) : null}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCriteria((list) => list.filter((x) => x.uid !== c.uid))}
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
                    onChange={(e) => update(c.uid, { key: e.target.value })}
                    aria-invalid={errors('key') ? true : undefined}
                    aria-describedby={`${id('key')}-ajuda${errors('key') ? ` ${id('key')}-erro` : ''}`}
                  />
                  <p id={`${id('key')}-ajuda`} className="text-xs text-muted-foreground">
                    Fixo entre versões; as auditorias usam este nome.
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={add} disabled={criteria.length >= 15}>
          <Plus aria-hidden="true" className="size-4" />
          Adicionar critério
        </Button>
        <WeightTotal total={total} />
      </div>
      <FieldError id={fieldId('criteria')} messages={state.fieldErrors?.criteria} />
      <div className={cn('flex flex-wrap gap-2')}>
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar rubrica'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
