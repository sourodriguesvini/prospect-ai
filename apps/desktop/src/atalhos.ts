/**
 * Atalhos do Prospector com o identificador do programa (AppUserModelID), para a barra de tarefas
 * juntar a janela aberta com o ícone fixado. Usado só pelo instalador:
 * `Prospector.exe --criar-atalho <...\Prospector.lnk> [--criar-atalho <...>]`.
 */
import { mkdirSync } from 'node:fs';
import { win32 } from 'node:path';

// O programa só roda no Windows; `win32` deixa os caminhos iguais nos testes do CI (Linux).
const { basename, dirname, isAbsolute } = win32;

export const OPCAO_CRIAR_ATALHO = '--criar-atalho';

/** Caminhos pedidos na linha de comando; só aceita arquivos absolutos chamados `Prospector.lnk`. */
export function atalhosPedidos(argumentos: readonly string[]): string[] | null {
  const caminhos: string[] = [];
  let pediu = false;
  argumentos.forEach((argumento, indice) => {
    if (argumento !== OPCAO_CRIAR_ATALHO) return;
    pediu = true;
    const caminho = argumentos[indice + 1];
    if (caminho && isAbsolute(caminho) && basename(caminho).toLowerCase() === 'prospector.lnk') {
      caminhos.push(caminho);
    }
  });
  return pediu ? caminhos : null;
}

export interface DadosDoAtalho {
  executavel: string;
  pastaDeTrabalho: string;
  icone: string;
  idDoApp: string;
}

export function criarAtalhos(
  caminhos: readonly string[],
  dados: DadosDoAtalho,
  escrever: (
    caminho: string,
    opcoes: {
      target: string;
      cwd: string;
      description: string;
      icon: string;
      iconIndex: number;
      appUserModelId: string;
    },
  ) => boolean,
): boolean {
  let tudoCerto = caminhos.length > 0;
  for (const caminho of caminhos) {
    mkdirSync(dirname(caminho), { recursive: true });
    const ok = escrever(caminho, {
      target: dados.executavel,
      cwd: dados.pastaDeTrabalho,
      description: 'Abrir o Prospector',
      icon: dados.icone,
      iconIndex: 0,
      appUserModelId: dados.idDoApp,
    });
    tudoCerto &&= ok;
  }
  return tudoCerto;
}
