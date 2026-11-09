// Fuso fixo até existir configuração de preferências (ver docs/known-issues.md).
const TIME_ZONE = 'America/Sao_Paulo';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: TIME_ZONE,
});
const dateOnly = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeZone: TIME_ZONE });

export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateTime.format(date);
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : dateOnly.format(date);
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Centavos de real → "R$ 15.000,00". */
export function formatCents(cents: number): string {
  return brl.format(cents / 100);
}

/** Faixa de investimento; null quando nenhum dos valores foi informado. */
export function formatPriceRange(min: number | null, max: number | null): string | null {
  if (min !== null && max !== null) return `${formatCents(min)} a ${formatCents(max)}`;
  if (min !== null) return `A partir de ${formatCents(min)}`;
  if (max !== null) return `Até ${formatCents(max)}`;
  return null;
}
