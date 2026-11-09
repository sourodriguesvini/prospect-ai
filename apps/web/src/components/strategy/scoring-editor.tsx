'use client';

import {
  SCORE_DIMENSIONS,
  type ScoreThresholds,
  type ScoringModelContent,
} from '@prospector/contracts';
import { Button, FieldError, Input, Label } from '@prospector/ui';
import Link from 'next/link';
import { startTransition, useActionState, useState, type FormEvent } from 'react';
import { FormMessage, fieldId } from '@/components/forms/fields';
import type { FormAction } from '@/components/forms/use-action-form';
import { errorsFor, IDLE } from '@/lib/form-state';
import { SCORE_DIMENSION_LABELS, THRESHOLD_LABELS } from '@/lib/strategy-labels';
import { WeightTotal, parseWeight } from './weight-total';

const THRESHOLD_KEYS = Object.keys(THRESHOLD_LABELS) as (keyof ScoreThresholds)[];

function NumberInput({
  path,
  label,
  help,
  value,
  onChange,
  errors,
}: {
  path: string;
  label: string;
  help: string;
  value: string;
  onChange: (value: string) => void;
  errors: string[] | undefined;
}) {
  const id = fieldId(path);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
        {help}
      </p>
      <Input
        id={id}
        value={value}
        inputMode="numeric"
        className="w-28"
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={errors ? true : undefined}
        aria-describedby={`${id}-ajuda${errors ? ` ${id}-erro` : ''}`}
      />
      <FieldError id={`${id}-erro`} messages={errors} />
    </div>
  );
}

/**
 * Modelo de score da oferta (docs/08 §3): pesos das cinco dimensões, que somam 100, e limiares
 * das recomendações. Salvar cria nova versão; avaliações antigas continuam citando a delas.
 */
export function ScoringEditor({
  action,
  initial,
  cancelHref,
}: {
  action: FormAction;
  initial: ScoringModelContent;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, IDLE);
  const [weights, setWeights] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial.weights).map(([k, v]) => [k, String(v)])),
  );
  const [thresholds, setThresholds] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial.thresholds).map(([k, v]) => [k, String(v)])),
  );
  const total = SCORE_DIMENSIONS.reduce((sum, d) => sum + (parseWeight(weights[d] ?? '') ?? 0), 0);
  const asNumbers = (record: Record<string, string>) =>
    Object.fromEntries(Object.entries(record).map(([k, v]) => [k, parseWeight(v) ?? v]));

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData();
    formData.set(
      'payload',
      JSON.stringify({ weights: asNumbers(weights), thresholds: asNumbers(thresholds) }),
    );
    startTransition(() => formAction(formData));
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <FormMessage state={state} />
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">Pesos das dimensões</legend>
        <p className="text-sm text-muted-foreground">
          Potencial = soma de peso × nota de cada dimensão. Use inteiros; o total precisa ser 100.
        </p>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {SCORE_DIMENSIONS.map((d) => (
            <NumberInput
              key={d}
              path={`weights.${d}`}
              label={SCORE_DIMENSION_LABELS[d].label}
              help={SCORE_DIMENSION_LABELS[d].help}
              value={weights[d] ?? ''}
              onChange={(value) => setWeights((w) => ({ ...w, [d]: value }))}
              errors={errorsFor(state, `weights.${d}`)}
            />
          ))}
        </div>
        <WeightTotal total={total} />
        <FieldError id={fieldId('weights')} messages={state.fieldErrors?.weights} />
      </fieldset>
      <fieldset className="space-y-4">
        <legend className="text-base font-semibold">Limiares das recomendações</legend>
        <div className="grid gap-5 sm:grid-cols-2">
          {THRESHOLD_KEYS.map((key) => (
            <NumberInput
              key={key}
              path={`thresholds.${key}`}
              label={THRESHOLD_LABELS[key].label}
              help={THRESHOLD_LABELS[key].help}
              value={thresholds[key] ?? ''}
              onChange={(value) => setThresholds((t) => ({ ...t, [key]: value }))}
              errors={errorsFor(state, `thresholds.${key}`)}
            />
          ))}
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Salvando…' : 'Salvar modelo de score'}
        </Button>
        <Button asChild variant="ghost">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
      </div>
    </form>
  );
}
