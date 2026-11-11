/**
 * Datas dos formulários do Relacionamento. `<input type="datetime-local">` e `type="date"` não
 * têm fuso: o valor é a hora de parede da agência (America/Sao_Paulo, fixo até existir
 * configuração; ver docs/known-issues.md). Aqui ela vira ISO com o deslocamento certo para
 * aquele instante, e o contrato confere o resto.
 */
export const AGENCY_TIME_ZONE = 'America/Sao_Paulo';

/** Hora padrão de um follow-up marcado só com a data. */
const DEFAULT_DUE_HOUR = 9;

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;
const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Deslocamento do fuso naquele instante, em minutos (São Paulo hoje: -180). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const p = partsIn(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

function isoWithOffset(instant: Date, offset: number): string {
  const local = new Date(instant.getTime() + offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `${local.toISOString().slice(0, 19)}${sign}${hh}:${mm}`;
}

function zonedToIso(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): string | null {
  const wall = Date.UTC(year, month - 1, day, hour, minute, second);
  const check = new Date(wall);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }
  // Primeiro palpite com o deslocamento da hora de parede; depois confere no instante achado.
  let offset = offsetMinutes(new Date(wall), timeZone);
  const instant = new Date(wall - offset * 60_000);
  const corrected = offsetMinutes(instant, timeZone);
  if (corrected !== offset) offset = corrected;
  return isoWithOffset(new Date(wall - offset * 60_000), offset);
}

/**
 * "2026-11-11T14:30" (hora da agência) → "2026-11-11T14:30:00-03:00". Vazio → null. Formato
 * irreconhecível segue como veio, para o contrato recusar com a mensagem no campo.
 */
export function localDateTimeToIso(value: string, timeZone = AGENCY_TIME_ZONE): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = LOCAL_DATE_TIME.exec(trimmed);
  if (!match) return trimmed;
  const [, y, mo, d, h, mi, s] = match;
  return (
    zonedToIso(Number(y), Number(mo), Number(d), Number(h), Number(mi), Number(s ?? 0), timeZone) ??
    trimmed
  );
}

/** "2026-11-14" → 14/11/2026 às 9h da agência, em ISO. Vazio → null. */
export function localDateToIso(value: string, timeZone = AGENCY_TIME_ZONE): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const match = LOCAL_DATE.exec(trimmed);
  if (!match) return trimmed;
  const [, y, mo, d] = match;
  return zonedToIso(Number(y), Number(mo), Number(d), DEFAULT_DUE_HOUR, 0, 0, timeZone) ?? trimmed;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO → valor de `datetime-local` na hora da agência ("2026-11-11T14:30"). */
export function isoToLocalDateTime(iso: string, timeZone = AGENCY_TIME_ZONE): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const p = partsIn(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** ISO → valor de `type="date"` na data da agência ("2026-11-11"). */
export function isoToLocalDate(iso: string, timeZone = AGENCY_TIME_ZONE): string {
  return isoToLocalDateTime(iso, timeZone).slice(0, 10);
}

/** Data local daqui a `days` dias (sugestão de follow-up). */
export function localDateInDays(now: Date, days: number, timeZone = AGENCY_TIME_ZONE): string {
  return isoToLocalDate(new Date(now.getTime() + days * 86_400_000).toISOString(), timeZone);
}
