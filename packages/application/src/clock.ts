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

/**
 * Dia AAAA-MM-DD de um valor gravado: data pura (`2026-11-24`) fica como está; instante ISO
 * (`2026-11-25T01:19:00Z`) vira o dia no fuso da agência. Cortar o ISO em 10 caracteres dá o dia
 * em UTC, um dia adiantado depois das 21h de Brasília (KI-149).
 */
export function localDay(value: string, timeZone: string = AGENCY_TIME_ZONE): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? value.slice(0, 10) : calendarDate(at, timeZone);
}

/** Diferença (ms) entre o relógio do fuso e o UTC no instante dado (ex.: São Paulo = -3 h). */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part('year'),
    part('month') - 1,
    part('day'),
    part('hour'),
    part('minute'),
    part('second'),
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  return new Date(guess - zoneOffsetMs(new Date(guess), timeZone));
}

/** Início e fim do dia de calendário de `at` no fuso (para "vence hoje" e "vencido"). */
export function calendarDayBounds(
  at: Date,
  timeZone: string = AGENCY_TIME_ZONE,
): { start: Date; end: Date } {
  const [year, month, day] = calendarDate(at, timeZone).split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return {
    start: zonedMidnight(year, month, day, timeZone),
    end: zonedMidnight(year, month, day + 1, timeZone),
  };
}
