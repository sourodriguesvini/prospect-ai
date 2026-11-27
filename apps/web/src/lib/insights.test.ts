import { describe, expect, it } from 'vitest';
import {
  feedFilterFrom,
  feedFilterHref,
  formatDuration,
  formatShare,
  formatUsdAmount,
  periodFrom,
  periodHref,
  watchDueText,
} from './insights';

/** O Intl usa espaço inseparável entre o símbolo e o número. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('filtros na URL', () => {
  it('origem do feed: valores conhecidos, o resto volta para "tudo"', () => {
    expect(feedFilterFrom('empresas')).toBe('companies');
    expect(feedFilterFrom('buscas')).toBe('discovery');
    expect(feedFilterFrom(['buscas', 'empresas'])).toBe('discovery');
    expect(feedFilterFrom(undefined)).toBe('all');
    expect(feedFilterFrom('companies')).toBe('all');
    expect(feedFilterHref('all')).toBe('/monitoramento');
    expect(feedFilterHref('companies')).toBe('/monitoramento?origem=empresas');
  });

  it('período do funil: só "total" muda o padrão (mês)', () => {
    expect(periodFrom('total')).toBe('all');
    expect(periodFrom('mes')).toBe('month');
    expect(periodFrom(undefined)).toBe('month');
    expect(periodHref('month')).toBe('/inteligencia');
    expect(periodHref('all')).toBe('/inteligencia?periodo=total');
  });
});

describe('textos', () => {
  it('prazo da lista de acompanhamento', () => {
    expect(watchDueText({ state: 'due', days: 0 })).toBe('Venceu hoje');
    expect(watchDueText({ state: 'due', days: 1 })).toBe('Vencida há 1 dia');
    expect(watchDueText({ state: 'due', days: 12 })).toBe('Vencida há 12 dias');
    expect(watchDueText({ state: 'upcoming', days: 1 })).toBe('Próxima em 1 dia');
    expect(watchDueText({ state: 'running', days: 0 })).toBe('Investigação em andamento');
  });

  it('porcentagem, dinheiro e tempo', () => {
    expect(plain(formatShare(0.25))).toBe('25%');
    expect(formatShare(0.001)).toBe('menos de 1%');
    expect(formatUsdAmount(0)).toBe('0,00');
    expect(formatUsdAmount(1_234_567)).toBe('1,23');
    expect(formatUsdAmount(12_345_678_000)).toBe('12.345,68');
    expect(formatUsdAmount(1_000)).toBe('< 0,01');
    expect(formatDuration(45_000)).toBe('45 s');
    expect(formatDuration(12 * 60_000)).toBe('12 min');
    expect(formatDuration(125 * 60_000)).toBe('2 h 05 min');
  });
});
