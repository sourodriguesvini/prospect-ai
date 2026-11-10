import type { EntityRef, InternalLink } from '@prospector/contracts';
import { strategyRoutes } from './strategy-routes';

/**
 * Tela de cada entidade citada por uma ferramenta do Copiloto (IA-2). A aplicação devolve só a
 * referência; aqui ela vira link interno. Entidade de módulo que ainda não tem tela não ganha link
 * (o Copiloto não manda a pessoa para uma tela que não existe).
 */
export function entityHref(ref: EntityRef): string | null {
  switch (ref.kind) {
    case 'readiness':
      return strategyRoutes.overview;
    case 'offer':
      return ref.id ? strategyRoutes.offer(ref.id) : strategyRoutes.overview;
    case 'icp':
      return ref.id ? strategyRoutes.icp(ref.id) : strategyRoutes.overview;
    case 'proof_asset':
      return ref.id ? strategyRoutes.case(ref.id) : strategyRoutes.cases;
    case 'voice_guide':
      return strategyRoutes.voice;
    case 'compliance':
      return strategyRoutes.compliance;
    case 'audit':
      return '/configuracoes/auditoria';
    case 'conversation':
      return ref.id ? `/copiloto?conversa=${encodeURIComponent(ref.id)}` : '/copiloto';
    default:
      return null;
  }
}

/** Links únicos, na ordem em que as entidades apareceram. */
export function entityLinks(refs: readonly EntityRef[]): InternalLink[] {
  const seen = new Set<string>();
  const links: InternalLink[] = [];
  for (const ref of refs) {
    const href = entityHref(ref);
    if (!href || seen.has(href)) continue;
    seen.add(href);
    links.push({ label: ref.label, href });
  }
  return links;
}
