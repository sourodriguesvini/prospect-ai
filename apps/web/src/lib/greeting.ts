const hourFormat = new Intl.DateTimeFormat('pt-BR', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: 'America/Sao_Paulo',
});

/** Saudação pelo horário de São Paulo (fuso fixo, KI-016). */
export function greetingFor(now: Date): string {
  const hour = Number(hourFormat.format(now));
  if (hour >= 5 && hour < 12) return 'Bom dia';
  if (hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}
