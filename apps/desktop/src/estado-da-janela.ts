/**
 * Tamanho, posição e zoom da janela entre uma abertura e outra (gravados em
 * `dados-da-janela\janela.json`, no disco da instalação).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface Retangulo {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface EstadoDaJanela {
  limites?: Retangulo;
  maximizada: boolean;
  zoom: number;
}

export const TAMANHO_PADRAO = { width: 1440, height: 900 };
export const TAMANHO_MINIMO = { width: 960, height: 600 };
const ZOOM_MAXIMO = 5;

function numero(valor: unknown): valor is number {
  return typeof valor === 'number' && Number.isFinite(valor);
}

export function lerEstado(texto: string | null): EstadoDaJanela {
  const padrao: EstadoDaJanela = { maximizada: false, zoom: 0 };
  if (!texto) return padrao;
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return padrao;
  }
  if (typeof valor !== 'object' || valor === null) return padrao;
  const bruto = valor as Record<string, unknown>;
  const limites = bruto.limites as Record<string, unknown> | undefined;
  const estado: EstadoDaJanela = {
    maximizada: bruto.maximizada === true,
    zoom: numero(bruto.zoom) && Math.abs(bruto.zoom) <= ZOOM_MAXIMO ? bruto.zoom : 0,
  };
  if (
    limites &&
    numero(limites.x) &&
    numero(limites.y) &&
    numero(limites.width) &&
    numero(limites.height)
  ) {
    estado.limites = {
      x: Math.round(limites.x),
      y: Math.round(limites.y),
      width: Math.round(limites.width),
      height: Math.round(limites.height),
    };
  }
  return estado;
}

/**
 * Usa os limites salvos só se a janela couber no mínimo e se ao menos 100×100 px dela aparecerem
 * numa das telas de agora (o monitor pode ter sido desligado).
 */
export function limitesVisiveis(
  limites: Retangulo | undefined,
  telas: readonly Retangulo[],
): Retangulo | undefined {
  if (!limites) return undefined;
  if (limites.width < TAMANHO_MINIMO.width || limites.height < TAMANHO_MINIMO.height) {
    return undefined;
  }
  const aparece = telas.some((tela) => {
    const largura =
      Math.min(limites.x + limites.width, tela.x + tela.width) - Math.max(limites.x, tela.x);
    const altura =
      Math.min(limites.y + limites.height, tela.y + tela.height) - Math.max(limites.y, tela.y);
    return largura >= 100 && altura >= 100;
  });
  return aparece ? limites : undefined;
}

export function carregarEstado(arquivo: string): EstadoDaJanela {
  try {
    return lerEstado(readFileSync(arquivo, 'utf8'));
  } catch {
    return lerEstado(null);
  }
}

export function salvarEstado(arquivo: string, estado: EstadoDaJanela): void {
  try {
    mkdirSync(dirname(arquivo), { recursive: true });
    writeFileSync(arquivo, JSON.stringify(estado, null, 2));
  } catch {
    // Sem gravar o tamanho, a janela só abre no tamanho padrão da próxima vez.
  }
}
