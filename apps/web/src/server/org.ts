import 'server-only';
import type { RequestContext } from '@prospector/application';
import { isAppError } from '@prospector/application';
import type { OrganizationSummary } from '@prospector/contracts';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getServices, type Services } from './container';
import { contextFor, requireUser, type SessionUser } from './session';

export interface OrgScope {
  user: SessionUser;
  org: OrganizationSummary;
  ctx: RequestContext;
  services: Services;
}

/**
 * Carrega a organização do slug para o usuário da sessão. Quem não é membro recebe 404
 * (não revelamos se a organização existe).
 */
export const loadOrgScope = cache(async (slug: string): Promise<OrgScope> => {
  const user = await requireUser(`/o/${slug}`);
  const services = await getServices();
  const ctx = contextFor(user);
  try {
    const org = await services.tenancy.getOrganization(ctx, slug);
    return { user, org, ctx, services };
  } catch (error) {
    if (isAppError(error) && error.code === 'not_found') notFound();
    throw error;
  }
});
