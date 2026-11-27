import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CaptureStoreError,
  type CaptureStore,
  type CaptureStoreFailure,
} from '@prospector/application';
import { CAPTURE_FILE_PATTERN, captureFileSuffix } from '@prospector/contracts';

/**
 * Imagens das capturas de marca numa pasta local de dados (ADR-0015, emenda de 2026-11-26). A
 * pasta é criada sozinha; o app instalado usa `<instalação>-dados\capturas`, fora da pasta do
 * programa (que a desinstalação apaga) e fora do disco do sistema (C: quase cheio, KI-017). O
 * caminho guardado no ledger é relativo e opaco (`<empresa>/<investigação>-<janela>[-<parte>].jpg`);
 * só este armazenamento o resolve, e nada fora da pasta é lido (formato e contenção conferidos).
 *
 * Retenção: cada imagem fica enquanto for usada; reaproveitar a mesma imagem numa análise nova
 * (`keep`) atualiza a data do arquivo, e `purgeExpired` apaga as que ficaram sem uso desde a data
 * pedida (12 meses, a retenção das fontes). Nada é apagado só porque chegou uma captura nova.
 */

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const COMPANY_DIR = new RegExp(`^${UUID}$`);

/** Imagem maior que isto não é aceita (a captura já limita altura e qualidade). */
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function isCaptureStoragePath(value: string): boolean {
  const [company, file, ...rest] = value.split('/');
  return (
    rest.length === 0 &&
    company !== undefined &&
    file !== undefined &&
    COMPANY_DIR.test(company) &&
    CAPTURE_FILE_PATTERN.test(file)
  );
}

function failureOf(error: unknown): CaptureStoreFailure {
  if (error instanceof CaptureStoreError) return error.reason;
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOSPC' || code === 'EDQUOT') return 'no_space';
  if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'no_permission';
  return 'unavailable';
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

  /** Arquivos de captura que estão na pasta (só o formato conhecido; o resto é ignorado). */
  async function listFiles(): Promise<
    Array<{ full: string; dir: string; bytes: number; mtime: Date }>
  > {
    let companies: string[];
    try {
      companies = await readdir(root);
    } catch {
      return [];
    }
    const found: Array<{ full: string; dir: string; bytes: number; mtime: Date }> = [];
    for (const company of companies) {
      if (!COMPANY_DIR.test(company)) continue;
      const dir = join(root, company);
      let names: string[];
      try {
        names = await readdir(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        if (!CAPTURE_FILE_PATTERN.test(name)) continue;
        const full = join(dir, name);
        try {
          const info = await stat(full);
          if (info.isFile()) found.push({ full, dir, bytes: info.size, mtime: info.mtime });
        } catch {
          // Apagado entre a listagem e a leitura: não conta.
        }
      }
    }
    return found;
  }

  return {
    async put({ companyId, investigationId, kind, image, capturedAt }) {
      const storagePath = `${companyId.toLowerCase()}/${investigationId.toLowerCase()}-${captureFileSuffix(kind)}.jpg`;
      const full = locate(storagePath);
      if (!full) throw new CaptureStoreError('invalid');
      if (image.bytes.length === 0 || image.bytes.length > MAX_IMAGE_BYTES) {
        throw new CaptureStoreError('invalid');
      }
      // Grava ao lado e renomeia: quem lê nunca vê uma imagem pela metade.
      const temporary = `${full}.${process.pid}.tmp`;
      try {
        await mkdir(join(root, companyId.toLowerCase()), { recursive: true });
        await writeFile(temporary, image.bytes);
        await rename(temporary, full);
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        throw new CaptureStoreError(failureOf(error), { cause: error });
      }
      return { storagePath, bytes: image.bytes.length, sha256: image.sha256, capturedAt };
    },

    async get(storagePath) {
      const full = locate(storagePath);
      if (!full) return null;
      try {
        const bytes = await readFile(full);
        if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null;
        return { bytes: new Uint8Array(bytes), mime: 'image/jpeg' };
      } catch {
        return null;
      }
    },

    async has(storagePath) {
      const full = locate(storagePath);
      if (!full) return false;
      try {
        const info = await stat(full);
        return info.isFile() && info.size > 0;
      } catch {
        return false;
      }
    },

    async keep(storagePath) {
      const full = locate(storagePath);
      if (!full) return;
      const now = new Date();
      await utimes(full, now, now).catch(() => undefined);
    },

    async delete(storagePath) {
      const full = locate(storagePath);
      if (!full) return;
      await rm(full, { force: true });
    },

    async purgeExpired(before) {
      let removed = 0;
      const dirs = new Set<string>();
      for (const file of await listFiles()) {
        if (file.mtime >= before) continue;
        try {
          await rm(file.full, { force: true });
          removed += 1;
          dirs.add(file.dir);
        } catch {
          // Arquivo em uso: sai na próxima limpeza.
        }
      }
      // Pasta de empresa vazia sai junto (rmdir falha sozinho se ainda houver arquivo).
      for (const dir of dirs) await rmdir(dir).catch(() => undefined);
      return removed;
    },

    async check() {
      const probe = join(root, `.verificacao-${process.pid}-${Date.now()}.tmp`);
      try {
        await mkdir(root, { recursive: true });
        await writeFile(probe, 'ok');
        const back = await readFile(probe, 'utf8');
        await rm(probe, { force: true });
        if (back !== 'ok') throw new CaptureStoreError('unavailable');
      } catch (error) {
        await rm(probe, { force: true }).catch(() => undefined);
        const reason = failureOf(error);
        return {
          ok: false,
          location: root,
          problem: new CaptureStoreError(reason).message,
          files: 0,
          bytes: 0,
        };
      }
      const files = await listFiles();
      return {
        ok: true,
        location: root,
        problem: null,
        files: files.length,
        bytes: files.reduce((total, file) => total + file.bytes, 0),
      };
    },
  };
}
