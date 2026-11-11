import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { CaptureStore } from '@prospector/application';

/**
 * Imagens das capturas de marca numa pasta local (ADR-0015), enquanto não houver bucket privado
 * aprovado no Supabase. A pasta fica fora do disco do sistema (C: quase cheio, KI-017) e é
 * configurada por `PROSPECTOR_CAPTURES_DIR`. O caminho guardado no ledger é relativo e opaco
 * (`<empresa>/<investigação>-<janela>.jpg`); só este armazenamento o resolve, e nada fora da
 * pasta é lido (caminho conferido por formato e por contenção).
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const STORAGE_PATH = new RegExp(`^${UUID}/${UUID}-(desktop|mobile)\\.jpg$`);

/** Imagem maior que isto não é aceita (a captura já limita altura e qualidade). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function isCaptureStoragePath(value: string): boolean {
  return STORAGE_PATH.test(value);
}

export function createFileCaptureStore(options: { dir: string }): CaptureStore {
  if (!isAbsolute(options.dir)) throw new Error('A pasta das capturas precisa ser absoluta.');
  const root = resolve(options.dir);

  function locate(storagePath: string): string | null {
    if (!isCaptureStoragePath(storagePath)) return null;
    const full = resolve(root, ...storagePath.split('/'));
    const rel = relative(root, full);
    if (!rel || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).length !== 2) return null;
    return full;
  }

  return {
    async put({ companyId, investigationId, viewport, image, capturedAt }) {
      const storagePath = `${companyId.toLowerCase()}/${investigationId.toLowerCase()}-${viewport}.jpg`;
      const full = locate(storagePath);
      if (!full) throw new Error('Caminho de captura inválido.');
      if (image.bytes.length === 0 || image.bytes.length > MAX_IMAGE_BYTES) {
        throw new Error('Imagem de captura fora do tamanho aceito.');
      }
      await mkdir(join(root, companyId.toLowerCase()), { recursive: true });
      // Grava ao lado e renomeia: quem lê nunca vê uma imagem pela metade.
      const temporary = `${full}.${process.pid}.tmp`;
      await writeFile(temporary, image.bytes);
      await rename(temporary, full);
      return { storagePath, bytes: image.bytes.length, sha256: image.sha256, capturedAt };
    },

    async get(storagePath) {
      const full = locate(storagePath);
      if (!full) return null;
      try {
        const bytes = await readFile(full);
        if (bytes.length > MAX_IMAGE_BYTES) return null;
        return { bytes: new Uint8Array(bytes), mime: 'image/jpeg' };
      } catch {
        return null;
      }
    },

    async delete(storagePath) {
      const full = locate(storagePath);
      if (!full) return;
      await rm(full, { force: true });
    },
  };
}
