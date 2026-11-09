import { FieldError, Label } from '@prospector/ui';
import type { ReactNode } from 'react';

/** Rótulo + controle + dica/erro. O controle deve usar `describedBy(id, errors)`. */
export function Field({
  id,
  label,
  hint,
  errors,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  errors: readonly string[] | undefined;
  children: ReactNode;
}) {
  const hasErrors = Boolean(errors && errors.length > 0);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !hasErrors ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      <FieldError id={`${id}-error`} messages={errors} />
    </div>
  );
}

export function describedBy(id: string, errors: readonly string[] | undefined, hasHint = false) {
  const hasErrors = Boolean(errors && errors.length > 0);
  const describedby = hasErrors ? `${id}-error` : hasHint ? `${id}-hint` : undefined;
  return { 'aria-invalid': hasErrors || undefined, 'aria-describedby': describedby } as const;
}
