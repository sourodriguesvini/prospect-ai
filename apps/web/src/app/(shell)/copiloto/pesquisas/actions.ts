'use server';

import { isAppError, type ResearchService } from '@prospector/application';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type { FormState } from '@/lib/form-state';
import { researchNoticeHref, researchRoutes, type ResearchNotice } from '@/lib/research-labels';
import { ensureDiscoveryWorker, getServices, pokeDiscoveryWorker } from '@/server/container';
import { userContext } from '@/server/context';

/**
 * Ação na pesquisa a partir da tela. Deu certo: volta à mesma tela com o aviso na URL (o leitor
 * de tela ouve o aviso e o foco vai para o título, já que o botão apertado some). Erro de regra:
 * a mensagem aparece embaixo do botão.
 */
async function runResearchAction(
  id: string,
  write: (service: ResearchService) => Promise<unknown>,
  notice: ResearchNotice,
): Promise<FormState> {
  const { copilotResearch } = getServices();
  if (!copilotResearch) {
    return { status: 'error', message: 'O banco não está configurado.', at: Date.now() };
  }
  try {
    await write(copilotResearch);
  } catch (error) {
    if (isAppError(error) && error.code !== 'unexpected') {
      return { status: 'error', message: error.message, at: Date.now() };
    }
    throw error;
  }
  revalidatePath(researchRoutes.detail(id));
  revalidatePath(researchRoutes.list);
  revalidatePath('/copiloto');
  redirect(researchNoticeHref(id, notice));
}

/** Cancela a pesquisa: o que já foi achado continua guardado para revisão. */
export async function cancelResearchAction(
  id: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runResearchAction(
    id,
    (service) => service.cancel(userContext(), { researchId: id }),
    'cancelada',
  );
}

/**
 * Retoma de onde parou uma pesquisa interrompida (falha ou busca fora do ar): o mesmo que pedir
 * "continue a pesquisa" na conversa.
 */
export async function resumeResearchAction(
  id: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runResearchAction(
    id,
    async (service) => {
      await service.resume(userContext(), { researchId: id });
      ensureDiscoveryWorker();
      pokeDiscoveryWorker();
    },
    'retomada',
  );
}

/**
 * Opt-out de uma pessoa achada (regra 7): definitivo. O contato some, o trecho fica só com o nome
 * e a identidade entra na supressão (ela não volta em pesquisa nenhuma).
 */
export async function optOutResearchPersonAction(
  id: string,
  itemId: string,
  _previous: FormState,
  _formData: FormData,
): Promise<FormState> {
  return runResearchAction(
    id,
    (service) => service.optOutPerson(userContext(), { researchId: id, itemId }),
    'opt-out',
  );
}
