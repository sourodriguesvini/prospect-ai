'use server';

import { isAppError } from '@prospector/application';
import { ModelName, Uuid } from '@prospector/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getLocalAi, getServices } from '@/server/container';
import { userContext } from '@/server/context';

export interface UnloadState {
  error: string | null;
  /** Resultado para a tela anunciar (saiu, já não estava, ou ainda aparece na memória). */
  message: string | null;
  /**
   * Momento da leitura do painel em que o pedido foi feito. Depois de Atualizar a leitura é
   * outra, e um erro antigo deixa de aparecer.
   */
  at: string | null;
}

/**
 * Tira um modelo da memória da GPU agora (o Ollama faria sozinho ao fim do `keep_alive`). Só
 * aceita um modelo que está carregado; não mexe em outros programas do computador.
 */
export async function unloadModel(
  _previous: UnloadState,
  formData: FormData,
): Promise<UnloadState> {
  const rawAt = formData.get('at');
  const at = typeof rawAt === 'string' ? rawAt.slice(0, 40) : null;
  const parsed = ModelName.safeParse(formData.get('model'));
  if (!parsed.success) return { error: 'Modelo inválido.', message: null, at };
  const ai = getLocalAi();
  const status = await ai.status();
  // Sem saber o que está na memória, não dá para confirmar nada à pessoa (regra 8).
  if (status.state !== 'online' || status.loaded === null) {
    return {
      error:
        'Não foi possível ler os modelos na memória agora. Clique em Atualizar e tente de novo.',
      message: null,
      at,
    };
  }
  // Só descarrega o que se sabe carregado: pedir a descarga de um modelo fora da memória faria o
  // Ollama carregá-lo antes. Fora da lista, o modelo já não está na memória.
  let message = `${parsed.data} já não estava na memória.`;
  if (status.loaded.some((model) => model.name === parsed.data)) {
    try {
      message = (await ai.unload(parsed.data))
        ? `${parsed.data} saiu da memória.`
        : `O pedido foi enviado, mas ${parsed.data} ainda aparece na memória. Clique em Atualizar em alguns segundos.`;
    } catch {
      return {
        error: 'Não foi possível liberar a memória agora. O Ollama está respondendo?',
        message: null,
        at,
      };
    }
  }
  revalidatePath('/copiloto');
  return { error: null, message, at };
}

export interface ThreadActionState {
  error: string | null;
  /** Marca de cada resposta, para a mesma mensagem ser anunciada de novo. */
  at: number;
}

function threadError(error: unknown): ThreadActionState {
  if (isAppError(error)) {
    const message =
      error.code === 'validation'
        ? (Object.values(error.fieldErrors ?? {})[0]?.[0] ?? error.message)
        : error.message;
    return { error: message, at: Date.now() };
  }
  throw error;
}

/** Renomeia uma conversa do Copiloto (auditado: copilot.thread.rename). */
export async function renameThread(
  _previous: ThreadActionState,
  formData: FormData,
): Promise<ThreadActionState> {
  const { copilot } = getServices();
  if (!copilot) return { error: 'O banco não está configurado.', at: Date.now() };
  try {
    await copilot.rename(userContext(), {
      threadId: formData.get('threadId'),
      title: formData.get('title'),
    });
  } catch (error) {
    return threadError(error);
  }
  revalidatePath('/copiloto');
  return { error: null, at: Date.now() };
}

/**
 * Arquiva ou restaura uma conversa (nada é apagado). Arquivar a conversa aberta volta para uma
 * conversa nova.
 */
export async function setThreadArchived(formData: FormData): Promise<void> {
  const { copilot } = getServices();
  const id = Uuid.safeParse(formData.get('threadId'));
  if (!copilot || !id.success) return;
  const archived = formData.get('archived') === '1';
  await copilot.setArchived(userContext(), id.data, archived);
  revalidatePath('/copiloto');
  if (archived && formData.get('current') === '1') redirect('/copiloto');
}
