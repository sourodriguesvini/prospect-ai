import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CaptureStoreError } from '@prospector/application';
import { CaptureKind } from '@prospector/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFileCaptureStore, isCaptureStoragePath } from '../src/capture-store';

/**
 * Pasta das capturas: caminho opaco, nada fora da pasta, gravação atômica, pasta criada sozinha,
 * retenção pelo último uso e conferência de leitura e escrita (diretriz de 2026-11-26, Parte 13).
 * Dados SINTÉTICOS.
 */

const COMPANY = '2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f';
const OTHER_COMPANY = '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d';
const RUN = '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const CAPTURED_AT = '2026-11-11T12:00:00.000Z';

function image(sha: string, bytes: Uint8Array = JPEG) {
  return { bytes, mime: 'image/jpeg' as const, width: 1, height: 1, sha256: sha.repeat(64) };
}

let base = '';
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), 'prospector-capturas-'));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

async function freshDir(name: string): Promise<string> {
  return join(base, name);
}

describe('createFileCaptureStore', () => {
  it('cria a pasta sozinha, grava e lê pelo caminho relativo; sem arquivo temporário sobrando', async () => {
    const dir = join(await freshDir('nova'), 'dados', 'capturas');
    const store = createFileCaptureStore({ dir });
    const stored = await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_desktop',
      image: image('a'),
      capturedAt: CAPTURED_AT,
    });
    expect(stored).toEqual({
      storagePath: `${COMPANY}/${RUN}-desktop.jpg`,
      bytes: JPEG.length,
      sha256: 'a'.repeat(64),
      capturedAt: CAPTURED_AT,
    });
    expect(await store.get(stored.storagePath)).toEqual({ bytes: JPEG, mime: 'image/jpeg' });
    expect(await readdir(join(dir, COMPANY))).toEqual([`${RUN}-desktop.jpg`]);
    expect(await store.get(`${COMPANY}/${RUN}-mobile.jpg`)).toBeNull();
    expect(await store.has(stored.storagePath)).toBe(true);
    expect(await store.has(`${COMPANY}/${RUN}-mobile.jpg`)).toBe(false);
  });

  it('cada parte tem seu arquivo; as primeiras telas mantêm o nome de antes', async () => {
    const dir = await freshDir('partes');
    const store = createFileCaptureStore({ dir });
    const names: string[] = [];
    for (const kind of CaptureKind.options) {
      const stored = await store.put({
        companyId: COMPANY,
        investigationId: RUN,
        kind,
        image: image('b'),
        capturedAt: CAPTURED_AT,
      });
      expect(isCaptureStoragePath(stored.storagePath)).toBe(true);
      names.push(stored.storagePath.split('/')[1] ?? '');
    }
    expect(names).toEqual([
      `${RUN}-desktop.jpg`,
      `${RUN}-mobile.jpg`,
      `${RUN}-desktop-footer.jpg`,
      `${RUN}-mobile-footer.jpg`,
      `${RUN}-mobile-menu.jpg`,
      `${RUN}-desktop-inner.jpg`,
      `${RUN}-mobile-inner.jpg`,
    ]);
    expect((await readdir(join(dir, COMPANY))).sort()).toEqual([...names].sort());
  });

  it('caminho fora do formato ou da pasta não é lido', async () => {
    const dir = await freshDir('fora');
    const store = createFileCaptureStore({ dir });
    await store.check();
    await writeFile(join(dir, 'segredo.txt'), 'não');
    for (const path of [
      '../segredo.txt',
      `${COMPANY}/../../segredo.txt`,
      `${COMPANY}\\${RUN}-desktop.jpg`,
      `/${COMPANY}/${RUN}-desktop.jpg`,
      `${COMPANY}/${RUN}-desktop.png`,
      `${COMPANY}/${RUN}-desktop-header.jpg`,
      `${COMPANY}/${RUN}-tablet.jpg`,
      'C:/Windows/win.ini',
    ]) {
      expect(isCaptureStoragePath(path)).toBe(false);
      expect(await store.get(path)).toBeNull();
      expect(await store.has(path)).toBe(false);
    }
  });

  it('apaga a imagem pelo caminho; caminho inválido ou arquivo ausente não apaga nada nem falha', async () => {
    const dir = await freshDir('apagar');
    const store = createFileCaptureStore({ dir });
    const stored = await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_mobile',
      image: image('c'),
      capturedAt: CAPTURED_AT,
    });
    await writeFile(join(dir, 'fica.txt'), 'fica');
    await store.delete('../fica.txt');
    await store.delete(`${COMPANY}/../fica.txt`);
    expect(await readdir(dir)).toContain('fica.txt');

    await store.delete(stored.storagePath);
    expect(await store.get(stored.storagePath)).toBeNull();
    await expect(store.delete(stored.storagePath)).resolves.toBeUndefined();
  });

  it('pasta relativa é recusada; imagem vazia falha como inválida', async () => {
    expect(() => createFileCaptureStore({ dir: 'capturas' })).toThrow();
    const store = createFileCaptureStore({ dir: await freshDir('vazia') });
    const failure = store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_mobile',
      image: image('d', new Uint8Array()),
      capturedAt: CAPTURED_AT,
    });
    await expect(failure).rejects.toBeInstanceOf(CaptureStoreError);
    await expect(failure).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('pasta que não pode ser criada falha com motivo, sem caminho na mensagem', async () => {
    const blocker = join(base, 'arquivo-no-lugar');
    await writeFile(blocker, 'não é pasta');
    const store = createFileCaptureStore({ dir: join(blocker, 'capturas') });
    const failure = store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_desktop',
      image: image('e'),
      capturedAt: CAPTURED_AT,
    });
    await expect(failure).rejects.toBeInstanceOf(CaptureStoreError);
    const error = (await failure.catch((caught: unknown) => caught)) as CaptureStoreError;
    expect(['unavailable', 'no_permission']).toContain(error.reason);
    expect(error.message).not.toContain(blocker);

    const health = await store.check();
    expect(health.ok).toBe(false);
    expect(health.problem).toBeTruthy();
    expect(health.problem).not.toContain(blocker);
    expect(health.files).toBe(0);
  });

  it('confere leitura e escrita e conta as imagens guardadas', async () => {
    const dir = await freshDir('conferir');
    const store = createFileCaptureStore({ dir });
    const empty = await store.check();
    expect(empty).toEqual({ ok: true, location: dir, problem: null, files: 0, bytes: 0 });
    await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_desktop',
      image: image('f'),
      capturedAt: CAPTURED_AT,
    });
    await store.put({
      companyId: OTHER_COMPANY,
      investigationId: RUN,
      kind: 'site_mobile_menu',
      image: image('f'),
      capturedAt: CAPTURED_AT,
    });
    await writeFile(join(dir, 'outro-arquivo.txt'), 'não conta');
    const health = await store.check();
    expect(health).toMatchObject({ ok: true, files: 2, bytes: JPEG.length * 2 });
    // O arquivo de verificação não fica para trás.
    expect((await readdir(dir)).filter((name) => name.startsWith('.verificacao'))).toEqual([]);
  });

  it('retenção: apaga só o que ficou sem uso desde a data pedida; o uso renova o prazo', async () => {
    const dir = await freshDir('retencao');
    const store = createFileCaptureStore({ dir });
    const old = await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_desktop',
      image: image('1'),
      capturedAt: CAPTURED_AT,
    });
    const reused = await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      kind: 'site_mobile',
      image: image('2'),
      capturedAt: CAPTURED_AT,
    });
    const alone = await store.put({
      companyId: OTHER_COMPANY,
      investigationId: RUN,
      kind: 'site_desktop',
      image: image('3'),
      capturedAt: CAPTURED_AT,
    });
    const longAgo = new Date('2025-01-01T00:00:00.000Z');
    for (const path of [old.storagePath, reused.storagePath, alone.storagePath]) {
      await utimes(join(dir, ...path.split('/')), longAgo, longAgo);
    }
    // Reaproveitada numa análise nova: o prazo conta de agora.
    await store.keep(reused.storagePath);
    const touched = await stat(join(dir, ...reused.storagePath.split('/')));
    expect(touched.mtime.getTime()).toBeGreaterThan(longAgo.getTime());

    const removed = await store.purgeExpired(new Date('2026-01-01T00:00:00.000Z'));
    expect(removed).toBe(2);
    expect(await store.has(old.storagePath)).toBe(false);
    expect(await store.has(reused.storagePath)).toBe(true);
    expect(await store.has(alone.storagePath)).toBe(false);
    // A pasta da empresa que ficou vazia sai junto; a outra continua.
    expect((await readdir(dir)).sort()).toEqual([COMPANY]);
    // Caminho inválido em `keep` não falha nem toca em nada fora da pasta.
    await expect(store.keep('../fora.jpg')).resolves.toBeUndefined();
  });
});
