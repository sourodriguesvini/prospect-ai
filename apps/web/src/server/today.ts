import 'server-only';
import { createTodayService, type TodayOverview } from '@prospector/application';
import { getServices } from './container';
import { userContext } from './context';

/**
 * Leitura da tela Hoje. O serviço só compõe serviços que o container já montou (nada de banco ou
 * IA novos aqui); fica fora do `container.ts` enquanto ele tem mudanças locais de outra frente
 * (e-mail, KI-187/188) — ver docs/decisoes-entrega-1-2026-11-26.md.
 */
export async function loadToday(): Promise<TodayOverview> {
  const { relationship, companies, investigations, discovery, monitoring } = getServices();
  return createTodayService({
    relationship,
    companies,
    investigations,
    discovery,
    monitoring,
  }).overview(userContext());
}
