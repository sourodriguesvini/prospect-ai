/**
 * Travas da janela (ADR-0018), aplicadas a toda página que o Electron abrir:
 * - navegação só dentro de `http://127.0.0.1:3210`; links da web vão para o navegador do sistema;
 * - `window.open` e `target="_blank"`: páginas do app abrem noutra janela do Prospector, com as
 *   mesmas travas; links da web vão para o navegador; o resto é recusado;
 * - nenhuma permissão do navegador (câmera, microfone, localização, notificações...), exceto
 *   copiar texto para a área de transferência a pedido do próprio app;
 * - sem `<webview>`.
 */
import {
  shell,
  type BrowserWindowConstructorOptions,
  type Session,
  type WebContents,
  type WebPreferences,
} from 'electron';
import { classificarEndereco, quadroPodeIr } from './navegacao.js';
import type { Registrar } from './registro.js';

/** Preferências de toda janela do Prospector: sem Node, contexto isolado, sandbox e sem preload. */
export const PREFERENCIAS_SEGURAS: WebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  nodeIntegrationInSubFrames: false,
  nodeIntegrationInWorker: false,
  sandbox: true,
  webSecurity: true,
  allowRunningInsecureContent: false,
  webviewTag: false,
  navigateOnDragDrop: false,
  spellcheck: true,
};

export function abrirFora(endereco: string, registrar: Registrar): void {
  if (classificarEndereco(endereco) !== 'externo') {
    registrar(`Endereço recusado: ${resumir(endereco)}`);
    return;
  }
  shell.openExternal(endereco).catch(() => registrar('O Windows não abriu o navegador.'));
}

/** Só o esquema e o servidor, para o registro não guardar caminhos nem parâmetros. */
function resumir(endereco: string): string {
  try {
    const url = new URL(endereco);
    return url.host ? `${url.protocol}//${url.host}` : url.protocol;
  } catch {
    return '(inválido)';
  }
}

export interface Ganchos {
  registrar: Registrar;
  /** Opções da janela nova quando o app abre uma página dele em outra janela. */
  opcoesDeJanelaNova: () => BrowserWindowConstructorOptions;
  /**
   * A janela principal está numa tela própria (carregando ou erro) e o usuário clicou em
   * "Tentar de novo": a janela refaz a abertura em vez de navegar.
   */
  interceptarVoltaAoApp: (conteudo: WebContents) => boolean;
}

export function travarConteudo(conteudo: WebContents, ganchos: Ganchos): void {
  const { registrar } = ganchos;

  conteudo.on('will-frame-navigate', (evento) => {
    const { url, isMainFrame } = evento;
    if (!isMainFrame) {
      if (quadroPodeIr(url)) return;
      // Navegação de quadro interno para fora (refresh automático, script) é só bloqueada: abrir o
      // navegador sem um clique seria uma ação que a pessoa não pediu. Os cliques nos links da
      // prévia vão para janela nova (`target="_blank"`) e passam pelo `setWindowOpenHandler`.
      evento.preventDefault();
      registrar(`Quadro interno bloqueado: ${resumir(url)}`);
      return;
    }
    const destino = classificarEndereco(url);
    if (destino === 'app') {
      if (ganchos.interceptarVoltaAoApp(conteudo)) evento.preventDefault();
      return;
    }
    evento.preventDefault();
    abrirFora(url, registrar);
  });

  conteudo.on('will-redirect', (evento) => {
    if (!evento.isMainFrame || classificarEndereco(evento.url) === 'app') return;
    evento.preventDefault();
    abrirFora(evento.url, registrar);
  });

  conteudo.setWindowOpenHandler(({ url }) => {
    if (classificarEndereco(url) === 'app') {
      return { action: 'allow', overrideBrowserWindowOptions: ganchos.opcoesDeJanelaNova() };
    }
    abrirFora(url, registrar);
    return { action: 'deny' };
  });

  conteudo.on('will-attach-webview', (evento) => evento.preventDefault());
}

export function travarSessao(sessao: Session): void {
  const permitida = (permissao: string, origem: string) =>
    permissao === 'clipboard-sanitized-write' && classificarEndereco(origem) === 'app';
  sessao.setPermissionRequestHandler((_conteudo, permissao, responder, detalhes) => {
    responder(permitida(permissao, detalhes.requestingUrl));
  });
  sessao.setPermissionCheckHandler((_conteudo, permissao, origem) => permitida(permissao, origem));
}
