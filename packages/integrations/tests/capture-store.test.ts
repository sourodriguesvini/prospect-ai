import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFileCaptureStore, isCaptureStoragePath } from '../src/capture-store';

/** Pasta das capturas: caminho opaco, nada fora da pasta, gravação atômica. Dados SINTÉTICOS. */

const COMPANY = '2f1e0d9c-8b7a-4c6d-9e5f-4a3b2c1d0e9f';
const RUN = '7d6c5b4a-3e2f-4a1b-8c9d-0e1f2a3b4c5d';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

let dir = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'prospector-capturas-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createFileCaptureStore', () => {
  it('grava e lê pelo caminho relativo; sem arquivo temporário sobrando', async () => {
    const store = createFileCaptureStore({ dir });
    const stored = await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      viewport: 'desktop',
      image: { bytes: JPEG, mime: 'image/jpeg', width: 1, height: 1, sha256: 'a'.repeat(64) },
      capturedAt: '2026-11-11T12:00:00.000Z',
    });
    expect(stored).toEqual({
      storagePath: `${COMPANY}/${RUN}-desktop.jpg`,
      bytes: JPEG.length,
      sha256: 'a'.repeat(64),
      capturedAt: '2026-11-11T12:00:00.000Z',
    });
    expect(await store.get(stored.storagePath)).toEqual({ bytes: JPEG, mime: 'image/jpeg' });
    expect(await readdir(join(dir, COMPANY))).toEqual([`${RUN}-desktop.jpg`]);
    expect(await store.get(`${COMPANY}/${RUN}-mobile.jpg`)).toBeNull();
  });

  it('caminho fora do formato ou da pasta não é lido', async () => {
    await writeFile(join(dir, 'segredo.txt'), 'não');
    const store = createFileCaptureStore({ dir });
    for (const path of [
      '../segredo.txt',
      `${COMPANY}/../../segredo.txt`,
      `${COMPANY}\\${RUN}-desktop.jpg`,
      `/${COMPANY}/${RUN}-desktop.jpg`,
      `${COMPANY}/${RUN}-desktop.png`,
      'C:/Windows/win.ini',
    ]) {
      expect(isCaptureStoragePath(path)).toBe(false);
      expect(await store.get(path)).toBeNull();
    }
  });

  it('apaga a imagem pelo caminho; caminho inválido ou arquivo ausente não apaga nada nem falha', async () => {
    const store = createFileCaptureStore({ dir });
    const stored = await store.put({
      companyId: COMPANY,
      investigationId: RUN,
      viewport: 'mobile',
      image: { bytes: JPEG, mime: 'image/jpeg', width: 1, height: 1, sha256: 'c'.repeat(64) },
      capturedAt: '2026-11-11T12:00:00.000Z',
    });
    await writeFile(join(dir, 'fica.txt'), 'fica');
    await store.delete('../fica.txt');
    await store.delete(`${COMPANY}/../fica.txt`);
    expect(await readdir(dir)).toContain('fica.txt');

    await store.delete(stored.storagePath);
    expect(await store.get(stored.storagePath)).toBeNull();
    await expect(store.delete(stored.storagePath)).resolves.toBeUndefined();
  });

  it('pasta relativa e imagem vazia são recusadas', async () => {
    expect(() => createFileCaptureStore({ dir: 'capturas' })).toThrow();
    const store = createFileCaptureStore({ dir });
    await expect(
      store.put({
        companyId: COMPANY,
        investigationId: RUN,
        viewport: 'mobile',
        image: {
          bytes: new Uint8Array(),
          mime: 'image/jpeg',
          width: 1,
          height: 1,
          sha256: 'b'.repeat(64),
        },
        capturedAt: '2026-11-11T12:00:00.000Z',
      }),
    ).rejects.toThrow();
  });
});
