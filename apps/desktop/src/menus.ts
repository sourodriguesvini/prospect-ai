/**
 * Menu do programa (escondido; a tecla Alt mostra) e menu do botão direito, em pt-BR.
 */
import {
  BrowserWindow,
  Menu,
  clipboard,
  shell,
  type ContextMenuParams,
  type MenuItemConstructorOptions,
  type WebContents,
} from 'electron';
import { classificarEndereco } from './navegacao.js';
import type { Registrar } from './registro.js';
import { abrirFora } from './seguranca.js';

export interface AcoesDoMenu {
  recarregar: () => void;
  abrirRegistros: () => void;
  sobre: () => void;
}

const PASSO_DO_ZOOM = 0.5;

export function mudarZoom(conteudo: WebContents, direcao: 1 | -1 | 0): void {
  conteudo.setZoomLevel(direcao === 0 ? 0 : conteudo.getZoomLevel() + direcao * PASSO_DO_ZOOM);
}

function janelaEmFoco(): BrowserWindow | null {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
}

function noConteudo(acao: (conteudo: WebContents) => void): () => void {
  return () => {
    const janela = janelaEmFoco();
    if (janela) acao(janela.webContents);
  };
}

export function montarMenuDoPrograma(acoes: AcoesDoMenu): Menu {
  const modelo: MenuItemConstructorOptions[] = [
    {
      label: '&Prospector',
      submenu: [
        {
          label: 'Voltar',
          accelerator: 'Alt+Left',
          click: noConteudo((c) => c.navigationHistory.canGoBack() && c.navigationHistory.goBack()),
        },
        {
          label: 'Avançar',
          accelerator: 'Alt+Right',
          click: noConteudo(
            (c) => c.navigationHistory.canGoForward() && c.navigationHistory.goForward(),
          ),
        },
        { label: 'Recarregar', accelerator: 'CommandOrControl+R', click: acoes.recarregar },
        { type: 'separator' },
        { label: 'Sair', accelerator: 'Alt+F4', role: 'quit' },
      ],
    },
    {
      label: '&Editar',
      submenu: [
        { label: 'Desfazer', role: 'undo' },
        { label: 'Refazer', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Colar', role: 'paste' },
        { label: 'Selecionar tudo', role: 'selectAll' },
      ],
    },
    {
      label: 'E&xibir',
      submenu: [
        {
          label: 'Aumentar zoom',
          accelerator: 'CommandOrControl+=',
          click: noConteudo((c) => mudarZoom(c, 1)),
        },
        {
          label: 'Diminuir zoom',
          accelerator: 'CommandOrControl+-',
          click: noConteudo((c) => mudarZoom(c, -1)),
        },
        {
          label: 'Tamanho normal',
          accelerator: 'CommandOrControl+0',
          click: noConteudo((c) => mudarZoom(c, 0)),
        },
        { type: 'separator' },
        { label: 'Tela cheia', role: 'togglefullscreen', accelerator: 'F11' },
        { type: 'separator' },
        {
          label: 'Ferramentas de desenvolvedor',
          accelerator: 'CommandOrControl+Shift+I',
          click: noConteudo((c) => c.toggleDevTools()),
        },
      ],
    },
    {
      label: 'A&juda',
      submenu: [
        { label: 'Abrir a pasta de registros', click: acoes.abrirRegistros },
        { type: 'separator' },
        { label: 'Sobre o Prospector', click: acoes.sobre },
      ],
    },
  ];
  return Menu.buildFromTemplate(modelo);
}

/**
 * Teclas que o menu não cobre: F5 recarrega; Ctrl com o + do teclado numérico ou com Shift
 * (teclado ABNT) também aumenta o zoom.
 */
export function tratarTeclas(conteudo: WebContents, recarregar: () => void): void {
  conteudo.on('before-input-event', (evento, tecla) => {
    if (tecla.type !== 'keyDown' || tecla.alt || tecla.meta) return;
    if (tecla.key === 'F5' && !tecla.control) {
      evento.preventDefault();
      recarregar();
      return;
    }
    if (!tecla.control) return;
    if (tecla.key === '+' || tecla.code === 'NumpadAdd') {
      evento.preventDefault();
      mudarZoom(conteudo, 1);
    } else if (tecla.code === 'NumpadSubtract') {
      evento.preventDefault();
      mudarZoom(conteudo, -1);
    }
  });
}

/** Menu do botão direito, como o do navegador: ortografia, links, imagem e edição. */
export function tratarMenuDeContexto(
  conteudo: WebContents,
  registrar: Registrar,
  recarregar: () => void = () => conteudo.reload(),
): void {
  conteudo.on('context-menu', (_evento, p: ContextMenuParams) => {
    const itens: MenuItemConstructorOptions[] = [];
    const bloco = (novos: MenuItemConstructorOptions[]) => {
      if (novos.length === 0) return;
      if (itens.length > 0) itens.push({ type: 'separator' });
      itens.push(...novos);
    };

    if (p.misspelledWord) {
      const sugestoes: MenuItemConstructorOptions[] = p.dictionarySuggestions
        .slice(0, 5)
        .map((palavra) => ({ label: palavra, click: () => conteudo.replaceMisspelling(palavra) }));
      if (sugestoes.length === 0) sugestoes.push({ label: 'Sem sugestões', enabled: false });
      sugestoes.push({
        label: 'Adicionar ao dicionário',
        click: () => conteudo.session.addWordToSpellCheckerDictionary(p.misspelledWord),
      });
      bloco(sugestoes);
    }

    if (p.linkURL) {
      const destino = classificarEndereco(p.linkURL);
      const link: MenuItemConstructorOptions[] = [];
      if (destino === 'externo') {
        link.push({
          label: 'Abrir link no navegador',
          click: () => abrirFora(p.linkURL, registrar),
        });
      }
      if (destino !== 'recusado') {
        link.push({
          label: 'Copiar endereço do link',
          click: () => clipboard.writeText(p.linkURL),
        });
      }
      bloco(link);
    }

    if (p.mediaType === 'image' && p.hasImageContents) {
      bloco([{ label: 'Copiar imagem', click: () => conteudo.copyImageAt(p.x, p.y) }]);
    }

    if (p.isEditable) {
      bloco([
        { label: 'Desfazer', role: 'undo', enabled: p.editFlags.canUndo },
        { label: 'Refazer', role: 'redo', enabled: p.editFlags.canRedo },
        { type: 'separator' },
        { label: 'Recortar', role: 'cut', enabled: p.editFlags.canCut },
        { label: 'Copiar', role: 'copy', enabled: p.editFlags.canCopy },
        { label: 'Colar', role: 'paste', enabled: p.editFlags.canPaste },
        { label: 'Selecionar tudo', role: 'selectAll', enabled: p.editFlags.canSelectAll },
      ]);
    } else if (p.selectionText.trim()) {
      bloco([{ label: 'Copiar', role: 'copy' }]);
    }

    if (itens.length === 0) {
      const historico = conteudo.navigationHistory;
      bloco([
        { label: 'Voltar', enabled: historico.canGoBack(), click: () => historico.goBack() },
        { label: 'Avançar', enabled: historico.canGoForward(), click: () => historico.goForward() },
        { label: 'Recarregar', click: recarregar },
      ]);
    }

    Menu.buildFromTemplate(itens).popup({
      window: BrowserWindow.fromWebContents(conteudo) ?? undefined,
    });
  });
}

export function abrirPasta(pasta: string, registrar: Registrar): void {
  shell.openPath(pasta).then((erro) => {
    if (erro) registrar(`Não foi possível abrir ${pasta}: ${erro}`);
  });
}
