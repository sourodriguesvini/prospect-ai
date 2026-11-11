import 'server-only';
import {
  ERROR_MESSAGES,
  isAppError,
  type RelationshipService,
  type RequestContext,
} from '@prospector/application';
import { revalidatePath } from 'next/cache';
import { notFound, redirect, unstable_rethrow } from 'next/navigation';
import { cache } from 'react';
import type { FormValues } from '@/lib/form-data';
import type { FormState } from '@/lib/form-state';
import { relationshipRoutes } from '@/lib/relationship-routes';
import { getServices } from './container';
import type { StorageMode } from './env';
import { userContext } from './context';

export type RelationshipLoad<T> =
  { kind: 'ok'; data: T; storage: StorageMode } | { kind: 'unavailable'; message: string };

/**
 * Leitura do Relacionamento para as telas (ADR-0014). Banco não configurado ou fora do ar vira
 * aviso na tela; id inexistente vira 404; qualquer outra falha sobe para o error.tsx.
 */
export async function loadRelationship<T>(
  read: (relationship: RelationshipService, ctx: RequestContext) => Promise<T>,
): Promise<RelationshipLoad<T>> {
  const { relationship, storage } = getServices();
  if (!relationship) {
    return { kind: 'unavailable', message: ERROR_MESSAGES.database_not_configured };
  }
  try {
    return { kind: 'ok', data: await read(relationship, userContext()), storage };
  } catch (error) {
    if (isAppError(error)) {
      if (error.code === 'unavailable') return { kind: 'unavailable', message: error.message };
      if (error.code === 'not_found') notFound();
    }
    throw error;
  }
}

/** Detalhe memorizado por pedido: a página e o `generateMetadata` leem o banco uma vez só. */
export const opportunityDetail = cache((relationship: RelationshipService, id: string) =>
  relationship.opportunity(userContext(), id),
);

/** Título da aba: o nome da empresa, ou o genérico se a leitura falhar. */
export async function opportunityTitle(id: string, fallback: string): Promise<string> {
  const { relationship } = getServices();
  if (!relationship) return fallback;
  try {
    return (await opportunityDetail(relationship, id)).company.displayName.trim() || fallback;
  } catch (error) {
    unstable_rethrow(error);
    return fallback;
  }
}

export type Option = { value: string; label: string };

/**
 * Ofertas ativas (com versão vigente) para os formulários de abordagem. Estratégia fora do ar
 * vira lista vazia: o formulário diz que falta oferta e o serviço recusa do mesmo jeito.
 */
export async function activeOfferOptions(): Promise<Option[]> {
  const { strategy } = getServices();
  if (!strategy) return [];
  try {
    const { snapshot } = await strategy.overview(userContext());
    return snapshot.offers.flatMap((offer) =>
      offer.status === 'active' && offer.current
        ? [{ value: offer.id, label: offer.current.content.name }]
        : [],
    );
  } catch (error) {
    unstable_rethrow(error);
    return [];
  }
}

export interface CitedClaim {
  statement: string;
  epistemicType: 'fact' | 'inference' | 'hypothesis';
  band: string;
  stale: boolean;
  /** De onde veio (título, endereço ou provedor da fonte mais recente); null para inferências. */
  source: string | null;
  /** Quando a fonte mais recente foi coletada. */
  capturedAt: string | null;
}

/** Nome curto de uma fonte para a tela: título, domínio, provedor ou identificador. */
function sourceName(source: {
  title: string | null;
  url: string | null;
  provider: string | null;
  externalRef: string | null;
}): string | null {
  if (source.title) return source.title;
  if (source.url) {
    try {
      return new URL(source.url).hostname.replace(/^www\./, '');
    } catch {
      return source.url;
    }
  }
  return source.provider ?? source.externalRef;
}

/**
 * Frases do dossiê citadas pela estratégia, por id. Leitura só para exibição: se o dossiê não
 * puder ser lido, a tela mostra os pontos sem o texto das evidências.
 */
export async function citedClaims(companyId: string): Promise<Map<string, CitedClaim>> {
  const { companies } = getServices();
  const index = new Map<string, CitedClaim>();
  if (!companies) return index;
  try {
    const dossier = await companies.dossier(userContext(), companyId);
    for (const view of dossier.claims) {
      const latest = view.evidence
        .flatMap((item) => (item.source ? [item.source] : []))
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt))[0];
      index.set(view.claim.id, {
        statement: view.claim.statement,
        epistemicType: view.claim.epistemicType,
        band: view.band,
        stale: view.status === 'stale',
        source: latest ? sourceName(latest) : null,
        capturedAt: latest?.capturedAt ?? null,
      });
    }
  } catch (error) {
    unstable_rethrow(error);
  }
  return index;
}

/**
 * Resultado de uma escrita: caminho para redirecionar, erro para mostrar no formulário (falha da
 * IA local, que não é exceção), mensagem de confirmação ou nada ("Salvo.").
 */
export type RelationshipOutcome = string | { error: string } | { message: string } | void;

/**
 * Executa uma Server Action do Relacionamento: validação, conflito e indisponibilidade voltam
 * para o formulário com o que foi digitado; sucesso revalida as telas que mostram oportunidades
 * (hub, aprovações, dossiê e início) e redireciona, se houver caminho.
 */
export async function runRelationshipAction(
  values: FormValues,
  write: (relationship: RelationshipService, ctx: RequestContext) => Promise<RelationshipOutcome>,
): Promise<FormState> {
  const { relationship } = getServices();
  if (!relationship) {
    return { status: 'error', message: ERROR_MESSAGES.database_not_configured, values };
  }
  let outcome: RelationshipOutcome;
  try {
    outcome = await write(relationship, userContext());
  } catch (error) {
    unstable_rethrow(error);
    if (isAppError(error) && error.code !== 'unexpected') {
      return {
        status: 'error',
        message: error.message,
        ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
        values,
        at: Date.now(),
      };
    }
    throw error;
  }
  if (outcome && typeof outcome === 'object' && 'error' in outcome) {
    return { status: 'error', message: outcome.error, values, at: Date.now() };
  }
  revalidatePath(relationshipRoutes.hub, 'layout');
  revalidatePath(relationshipRoutes.approvals);
  revalidatePath('/empresas', 'layout');
  revalidatePath('/');
  if (typeof outcome === 'string') redirect(outcome);
  return {
    status: 'saved',
    message: outcome && 'message' in outcome ? outcome.message : 'Salvo.',
    at: Date.now(),
  };
}
