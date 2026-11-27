/**
 * Endereços e pastas do Prospector instalado (ADR-0018). Sem import do Electron: os testes
 * rodam no Node.
 */
import { win32 } from 'node:path';

// O programa só roda no Windows; `win32` deixa os caminhos iguais nos testes do CI (Linux).
const { dirname, join, resolve } = win32;

/** O app só atende este computador (ADR-0007). A mesma porta do `PORT` do instalador. */
export const HOST = '127.0.0.1';
export const PORTA = 3210;
export const ORIGEM_DO_APP = `http://${HOST}:${PORTA}`;
export const URL_DO_APP = `${ORIGEM_DO_APP}/`;

/**
 * Identificador do programa no Windows (AppUserModelID). Os atalhos levam o mesmo, para a barra
 * de tarefas juntar a janela aberta com o ícone fixado.
 */
export const ID_DO_APP = 'Prospector.Desktop';

/** Arquivo que marca a pasta como instalação do Prospector (gravado por `pnpm app:install`). */
export const MARCA_DA_INSTALACAO = '.prospector-instalacao';

export interface Caminhos {
  /** Pasta da instalação (padrão `D:\Prospector`). */
  raiz: string;
  marca: string;
  /** Pasta do servidor Next (cwd do `node server.js`, onde fica o `.env.local`). */
  web: string;
  servidor: string;
  logs: string;
  pid: string;
  icone: string;
  versao: string;
  /** Perfil do Chromium da janela (cache, cookies): fica no disco da instalação, não no C:. */
  dadosDaJanela: string;
  estadoDaJanela: string;
  /**
   * Pasta de dados do usuário (capturas de marca), ao lado da instalação (`D:\Prospector-dados`):
   * atualizar ou desinstalar o programa apaga a pasta dele, nunca esta (diretriz de 2026-11-26,
   * Parte 13.2).
   */
  dados: string;
}

/**
 * O executável fica em `<raiz>\programa\Prospector.exe`; o resto da instalação está na pasta de
 * cima.
 */
export function caminhosDaInstalacao(executavel: string): Caminhos {
  const raiz = resolve(dirname(executavel), '..');
  const web = join(raiz, 'app', 'apps', 'web');
  const dadosDaJanela = join(raiz, 'dados-da-janela');
  return {
    raiz,
    marca: join(raiz, MARCA_DA_INSTALACAO),
    web,
    servidor: join(web, 'server.js'),
    logs: join(raiz, 'logs'),
    pid: join(raiz, 'servidor.pid'),
    icone: join(raiz, 'prospector.ico'),
    versao: join(raiz, 'versao.txt'),
    dadosDaJanela,
    estadoDaJanela: join(dadosDaJanela, 'janela.json'),
    dados: pastaDeDados(raiz),
  };
}

/** `D:\Prospector` → `D:\Prospector-dados`: irmã da instalação, no mesmo disco. */
export function pastaDeDados(raiz: string): string {
  return `${resolve(raiz).replace(/[\\/]+$/, '')}-dados`;
}
