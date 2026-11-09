import { execFile } from 'node:child_process';
import { win32 } from 'node:path';
import type { GpuSnapshot } from '@prospector/contracts';

/**
 * Leitura pontual da GPU; null quando não há NVIDIA, o driver não responde ou o formato mudou.
 * `invalidate` descarta a leitura guardada (ex.: logo depois de descarregar um modelo).
 */
export type GpuProbe = (() => Promise<GpuSnapshot | null>) & { invalidate?: () => void };

/** Interpreta `nvidia-smi --query-gpu=name,memory.total,memory.used,memory.free --format=csv,noheader,nounits`. */
export function parseNvidiaSmi(output: string): GpuSnapshot | null {
  const line = output.split(/\r?\n/).find((entry) => entry.trim().length > 0);
  if (!line) return null;
  const parts = line.split(',').map((part) => part.trim());
  if (parts.length < 4) return null;
  const [name, total, used, free] = parts as [string, string, string, string];
  const numbers = [total, used, free].map(Number);
  if (!name || numbers.some((value) => !Number.isFinite(value) || value < 0)) return null;
  const [totalMiB, usedMiB, freeMiB] = numbers as [number, number, number];
  return { name, totalMiB, usedMiB, freeMiB };
}

/**
 * Sonda via `nvidia-smi` (vem com o driver NVIDIA). Só lê; nunca altera nem encerra processos.
 * Resultado guardado por `cacheMs` para não abrir um processo a cada pedido.
 */
export function createNvidiaSmiProbe(options?: { timeoutMs?: number; cacheMs?: number }): GpuProbe {
  const timeoutMs = options?.timeoutMs ?? 2500;
  const cacheMs = options?.cacheMs ?? 2000;
  let cached: { at: number; value: Promise<GpuSnapshot | null> } | null = null;

  function read(): Promise<GpuSnapshot | null> {
    return new Promise((resolve) => {
      execFile(
        nvidiaSmiPath(),
        ['--query-gpu=name,memory.total,memory.used,memory.free', '--format=csv,noheader,nounits'],
        { timeout: timeoutMs, windowsHide: true },
        (error, stdout) => resolve(error ? null : parseNvidiaSmi(stdout)),
      );
    });
  }

  const probe = () => {
    const now = performance.now();
    if (!cached || now - cached.at > cacheMs) cached = { at: now, value: read() };
    return cached.value;
  };
  return Object.assign(probe, {
    invalidate: () => {
      cached = null;
    },
  });
}

/**
 * No Windows o driver instala o `nvidia-smi` em System32. O caminho completo evita que um
 * executável com o mesmo nome na pasta atual ou no PATH seja usado no lugar dele.
 */
export function nvidiaSmiPath(
  platform: NodeJS.Platform = process.platform,
  systemRoot: string | undefined = process.env.SystemRoot,
): string {
  if (platform !== 'win32') return 'nvidia-smi';
  return win32.join(systemRoot ?? 'C:\\Windows', 'System32', 'nvidia-smi.exe');
}

/** Sonda nula (testes, máquinas sem NVIDIA). */
export const noGpu: GpuProbe = () => Promise.resolve(null);
