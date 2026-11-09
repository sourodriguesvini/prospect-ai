'use server';

import { ModelName } from '@prospector/contracts';
import { revalidatePath } from 'next/cache';
import { getLocalAi } from '@/server/container';

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
