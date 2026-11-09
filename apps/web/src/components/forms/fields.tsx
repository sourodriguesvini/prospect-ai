import {
  Alert,
  Checkbox,
  FieldError,
  Input,
  Label,
  NativeSelect,
  Textarea,
  cn,
} from '@prospector/ui';
import type { ComponentProps, ReactNode } from 'react';
import { all, text, type FormValues } from '@/lib/form-data';
import { errorsFor, type FormState } from '@/lib/form-state';

/**
 * Campos de formulário com rótulo, ajuda e erro ligados por aria-describedby (WCAG 1.3.1/3.3.1).
 * O nome do campo é o caminho no contrato; os erros do servidor caem no campo pelo nome.
 */

export function fieldId(name: string): string {
  return `campo-${name.replace(/[^a-zA-Z0-9]+/g, '-')}`;
}

interface FieldBase {
  name: string;
  label: ReactNode;
  hint?: ReactNode;
  state: FormState;
  values: FormValues;
  required?: boolean;
  className?: string;
}

function describedBy(id: string, hint: boolean, errors: boolean): string | undefined {
  const ids = [hint ? `${id}-ajuda` : null, errors ? `${id}-erro` : null].filter(Boolean);
  return ids.length > 0 ? ids.join(' ') : undefined;
}

function FieldShell({
  id,
  label,
  hint,
  required,
  errors,
  className,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  errors: string[] | undefined;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {required ? (
          <span className="text-muted-foreground">
            {' '}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </span>
        ) : null}
      </Label>
      {hint ? (
        <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {children}
      <FieldError id={`${id}-erro`} messages={errors} />
    </div>
  );
}

export function TextField({
  name,
  label,
  hint,
  state,
  values,
  required,
  className,
  ...input
}: FieldBase & Omit<ComponentProps<'input'>, 'name' | 'defaultValue' | 'required'>) {
  const id = fieldId(name);
  const errors = errorsFor(state, name);
  return (
    <FieldShell {...{ id, label, hint, required, errors, className }}>
      <Input
        id={id}
        name={name}
        defaultValue={text(values, name)}
        aria-invalid={errors ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(errors))}
        autoComplete="off"
        {...input}
      />
    </FieldShell>
  );
}

export function TextAreaField({
  name,
  label,
  hint,
  state,
  values,
  required,
  className,
  rows = 3,
}: FieldBase & { rows?: number }) {
  const id = fieldId(name);
  const errors = errorsFor(state, name);
  return (
    <FieldShell {...{ id, label, hint, required, errors, className }}>
      <Textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={text(values, name)}
        aria-invalid={errors ? true : undefined}
        aria-required={required || undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(errors))}
      />
    </FieldShell>
  );
}

/** Lista de itens curtos: um por linha. */
export function ListField(props: FieldBase & { rows?: number; example?: string }) {
  const { hint, example } = props;
  return (
    <TextAreaField
      {...props}
      rows={props.rows ?? 4}
      hint={
        <>
          Um item por linha.{example ? ` Ex.: ${example}` : ''}
          {hint ? <> {hint}</> : null}
        </>
      }
    />
  );
}

export function SelectField({
  name,
  label,
  hint,
  state,
  values,
  required,
  className,
  options,
}: FieldBase & { options: readonly { value: string; label: string }[] }) {
  const id = fieldId(name);
  const errors = errorsFor(state, name);
  return (
    <FieldShell {...{ id, label, hint, required, errors, className }}>
      <NativeSelect
        id={id}
        name={name}
        defaultValue={text(values, name)}
        aria-invalid={errors ? true : undefined}
        aria-describedby={describedBy(id, Boolean(hint), Boolean(errors))}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </NativeSelect>
    </FieldShell>
  );
}

/** Grupo de caixas de marcar com o mesmo nome (fieldset + legend). */
export function CheckboxGroup({
  name,
  label,
  hint,
  state,
  values,
  required,
  className,
  options,
  columns = 'sm:grid-cols-2',
}: FieldBase & {
  options: readonly { value: string; label: ReactNode }[];
  columns?: string;
}) {
  const id = fieldId(name);
  const errors = errorsFor(state, name);
  const selected = new Set(all(values, name));
  return (
    <fieldset
      className={cn('space-y-2', className)}
      aria-describedby={describedBy(id, Boolean(hint), Boolean(errors))}
      aria-invalid={errors ? true : undefined}
    >
      <legend className="text-sm font-medium">
        {label}
        {required ? (
          <span className="text-muted-foreground">
            {' '}
            <span aria-hidden="true">*</span>
            <span className="sr-only">(obrigatório)</span>
          </span>
        ) : null}
      </legend>
      {hint ? (
        <p id={`${id}-ajuda`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className={cn('grid gap-x-4 gap-y-2', columns)}>
        {options.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-sm">
            <Checkbox name={name} value={o.value} defaultChecked={selected.has(o.value)} />
            {o.label}
          </label>
        ))}
      </div>
      <FieldError id={`${id}-erro`} messages={errors} />
    </fieldset>
  );
}

/** Caixa única de marcar (enviada como "on"). */
export function CheckboxField({
  name,
  label,
  hint,
  state,
  values,
  className,
}: Omit<FieldBase, 'required'>) {
  const id = fieldId(name);
  const errors = errorsFor(state, name);
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-start gap-2.5">
        <Checkbox
          id={id}
          name={name}
          defaultChecked={all(values, name).includes('on')}
          className="mt-0.5"
          aria-invalid={errors ? true : undefined}
          aria-describedby={describedBy(id, Boolean(hint), Boolean(errors))}
        />
        <Label htmlFor={id} className="font-normal">
          {label}
        </Label>
      </div>
      {hint ? (
        <p id={`${id}-ajuda`} className="pl-6.5 text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <div className="pl-6.5">
        <FieldError id={`${id}-erro`} messages={errors} />
      </div>
    </div>
  );
}

/** Resultado do envio: erro geral (com itens de `_form`) ou confirmação. */
export { FormMessage } from './form-message';

/** Aviso de rascunho sugerido: o conteúdo pré-preenchido é proposta, nada foi salvo. */
export function DraftNotice({ children }: { children: ReactNode }) {
  return (
    <Alert tone="info" role="note" className="border border-dashed border-border">
      <p className="font-medium">Rascunho sugerido — revise antes de salvar</p>
      <p className="mt-0.5 text-muted-foreground">{children}</p>
    </Alert>
  );
}
