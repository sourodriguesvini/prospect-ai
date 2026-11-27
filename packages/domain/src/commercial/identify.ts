import type { CommercialProfile } from '@prospector/contracts';
import { COMMERCIAL_PROFILES } from './profiles';
import { fold } from './text';

export interface ProfileIdentification {
  /** Perfil identificado; null quando nenhum ou mais de um se encaixa igualmente. */
  readonly profileId: string | null;
  /** `named`: o pedido cita o perfil; `keywords`: pelas palavras do público e do catálogo. */
  readonly reason: 'named' | 'keywords' | 'ambiguous' | 'none';
  /** Palavras encontradas por perfil (para explicar a escolha). */
  readonly matches: Readonly<Record<string, readonly string[]>>;
}

function hasTerm(text: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

/**
 * Parte 1.5: identifica a operação de prospecção a partir do pedido. O nome do perfil decide;
 * sem nome, vence o perfil com mais palavras do seu público e catálogo. Empate ou nada →
 * `profileId: null` (quem chama pergunta ao usuário — informação essencial, Parte 6.6).
 */
export function identifyCommercialProfile(
  request: string,
  profiles: readonly CommercialProfile[] = COMMERCIAL_PROFILES,
): ProfileIdentification {
  const text = fold(request);
  const matches: Record<string, string[]> = {};
  const named: string[] = [];
  for (const profile of profiles) {
    if (hasTerm(text, fold(profile.name))) named.push(profile.id);
    matches[profile.id] = profile.keywords.filter((keyword) => hasTerm(text, fold(keyword)));
  }
  if (named.length === 1) return { profileId: named[0] ?? null, reason: 'named', matches };
  if (named.length > 1) return { profileId: null, reason: 'ambiguous', matches };
  const ranked = profiles
    .map((profile) => ({ id: profile.id, count: matches[profile.id]?.length ?? 0 }))
    .sort((a, b) => b.count - a.count);
  const [first, second] = ranked;
  if (!first || first.count === 0) return { profileId: null, reason: 'none', matches };
  if (second && second.count === first.count) {
    return { profileId: null, reason: 'ambiguous', matches };
  }
  return { profileId: first.id, reason: 'keywords', matches };
}
