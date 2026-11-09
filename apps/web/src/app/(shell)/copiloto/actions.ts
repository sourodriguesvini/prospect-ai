'use server';

import { ModelName } from '@prospector/contracts';
import { revalidatePath } from 'next/cache';
import { getLocalAi } from '@/server/container';

export interface UnloadState {
  error: string | null;
  /** Modelo que acabou de sair da memória, para a tela confirmar. */
  unloaded: string | null;
}

/**
 * Tira um modelo da memória da GPU agora (o Ollama faria sozinho ao fim do `keep_alive`). Só
 * aceita um modelo que está carregado; não mexe em outros programas do computador.
 */
export async function unloadModel(
  _previous: UnloadState,
  formData: FormData,
): Promise<UnloadState> {
  const parsed = ModelName.safeParse(formData.get('model'));
  if (!parsed.success) return { error: 'Modelo inválido.', unloaded: null };
  const ai = getLocalAi();
  const status = await ai.status();
  if (status.state === 'online' && status.loaded.some((model) => model.name === parsed.data)) {
    try {
      await ai.unload(parsed.data);
    } catch {
      return {
        error: 'Não foi possível liberar a memória agora. O Ollama está respondendo?',
        unloaded: null,
      };
    }
  }
  revalidatePath('/copiloto');
  return { error: null, unloaded: parsed.data };
}
