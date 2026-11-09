/** Relógio injetável: serviços nunca chamam `new Date()` direto, para os testes fixarem "agora". */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** Fuso da agência: "hoje" (prazos de revisão da LIA, datas de calendário) é contado nele. */
export const AGENCY_TIME_ZONE = 'America/Sao_Paulo';

/** Data de calendário AAAA-MM-DD de um instante, no fuso indicado. */
export function calendarDate(at: Date, timeZone: string = AGENCY_TIME_ZONE): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}
