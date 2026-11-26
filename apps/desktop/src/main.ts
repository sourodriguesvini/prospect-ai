/**
 * Prospector de desktop (ADR-0018): janela própria do Windows para o app que roda em
 * http://127.0.0.1:3210. Sobe o servidor Next do Prospector se ele não estiver no ar, abre o
 * Ollama se estiver fechado, e encerra o servidor ao fechar a janela. Uma instância só.
 */
import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  nativeTheme,
  screen,
  session,
  shell,
  type BrowserWindowConstructorOptions,
  type WebContents,
} from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atalhosPedidos, criarAtalhos } from './atalhos.js';
import { ID_DO_APP, PORTA, URL_DO_APP, caminhosDaInstalacao } from './config.js';
import {
  TAMANHO_MINIMO,
  TAMANHO_PADRAO,
  carregarEstado,
  limitesVisiveis,
  salvarEstado,
} from './estado-da-janela.js';
import { abrirPasta, montarMenuDoPrograma, tratarMenuDeContexto, tratarTeclas } from './menus.js';
import { abrirOllamaSeFechado } from './ollama.js';
import { portaEmUso } from './processos.js';
import { criarRegistro } from './registro.js';
import { PREFERENCIAS_SEGURAS, travarConteudo, travarSessao } from './seguranca.js';
import { ServidorDoProspector } from './servidor.js';
import { telaDeCarregamento, telaDeErro, type ErroDaJanela } from './telas.js';

/** Marca de ordem de bytes (U+FEFF) que o instalador põe no versao.txt para o Bloco de Notas. */
const BOM_INICIAL = new RegExp('^' + String.fromCharCode(0xfeff));

const caminhos = caminhosDaInstalacao(process.execPath);

// Perfil do Chromium (cache, cookies, armazenamento) no disco da instalação, nunca no C:
// (KI-017). Precisa vir antes de qualquer outra coisa do Electron, inclusive da trava de instância.
app.setPath('userData', caminhos.dadosDaJanela);
app.setAppLogsPath(caminhos.logs);
app.setAppUserModelId(ID_DO_APP);

const pedidos = atalhosPedidos(process.argv.slice(1));
if (pedidos !== null) {
  void app.whenReady().then(() => {
    // Sempre sai, mesmo com erro: o instalador espera este processo terminar (`-Wait`).
    let ok = false;
    try {
      ok = criarAtalhos(
        pedidos,
        {
          executavel: process.execPath,
          pastaDeTrabalho: caminhos.raiz,
          icone: process.execPath,
          idDoApp: ID_DO_APP,
        },
        (caminho, opcoes) => shell.writeShortcutLink(caminho, 'create', opcoes),
      );
    } catch {
      ok = false;
    } finally {
      app.exit(ok ? 0 : 1);
    }
  });
} else if (!app.requestSingleInstanceLock()) {
  // Já está aberto: a outra instância recebe `second-instance` e vem para a frente.
  app.quit();
} else {
  iniciarPrograma();
}

function iniciarPrograma(): void {
  const registrar = criarRegistro(join(caminhos.logs, 'janela.log'));
  const estadoSalvo = carregarEstado(caminhos.estadoDaJanela);
  let janela: BrowserWindow | null = null;
  /** O que a janela principal mostra: tela própria (carregando, erro) ou o app. */
  let tela: 'carregando' | 'erro' | 'app' = 'carregando';
  let abrindo = false;
  let saindo = false;
  let encerrado = false;
  /** O atalho foi clicado enquanto o programa fechava: abrir de novo ao terminar. */
  let reabrir = false;
  let zoomAplicado = false;

  registrar(`Janela aberta (Electron ${process.versions.electron}).`);

  const servidor = new ServidorDoProspector(caminhos, registrar, (erro) => mostrarErro(erro));

  const viva = (j: BrowserWindow | null): j is BrowserWindow => j !== null && !j.isDestroyed();

  function opcoesDeJanela(): BrowserWindowConstructorOptions {
    return {
      title: 'Prospector',
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#f3f3f4',
      autoHideMenuBar: true,
      icon: existsSync(caminhos.icone) ? caminhos.icone : undefined,
      minWidth: TAMANHO_MINIMO.width,
      minHeight: TAMANHO_MINIMO.height,
      webPreferences: { ...PREFERENCIAS_SEGURAS },
    };
  }

  function mostrarErro(erro: ErroDaJanela): void {
    tela = 'erro';
    registrar(`Tela de erro: ${erro.titulo}.`);
    if (viva(janela)) void janela.loadURL(telaDeErro(erro)).catch(() => undefined);
  }

  async function abrirApp(): Promise<void> {
    if (!viva(janela) || abrindo || saindo) return;
    abrindo = true;
    try {
      tela = 'carregando';
      await janela.loadURL(telaDeCarregamento()).catch(() => undefined);
      const abertura = await servidor.garantir();
      if (!viva(janela) || saindo) return;
      if (!abertura.ok) {
        mostrarErro(abertura.erro);
        return;
      }
      tela = 'app';
      // Falha ao carregar é tratada em `did-fail-load`.
      await janela.loadURL(URL_DO_APP).catch(() => undefined);
    } finally {
      abrindo = false;
    }
  }

  function recarregar(): void {
    if (!viva(janela)) return;
    if (tela === 'app') janela.webContents.reload();
    else void abrirApp();
  }

  function recarregarConteudo(conteudo: WebContents): void {
    if (viva(janela) && conteudo === janela.webContents) recarregar();
    else conteudo.reload();
  }

  function sobre(): void {
    let versao = 'Versão instalada: desconhecida.';
    try {
      versao = readFileSync(caminhos.versao, 'utf8').replace(BOM_INICIAL, '').trim();
    } catch {
      // versao.txt é gravado pelo instalador; sem ele, fica o texto acima.
    }
    const opcoes = {
      type: 'info' as const,
      title: 'Sobre o Prospector',
      message: 'Prospector',
      detail: `${versao}\n\nJanela: Electron ${process.versions.electron} (Chromium ${process.versions.chrome}).\nServidor: ${URL_DO_APP} (só este computador).\nInstalação: ${caminhos.raiz}`,
      buttons: ['OK'],
    };
    void (viva(janela) ? dialog.showMessageBox(janela, opcoes) : dialog.showMessageBox(opcoes));
  }

  function tamanhoInicial(): { width: number; height: number } {
    const area = screen.getPrimaryDisplay().workAreaSize;
    return {
      width: Math.max(TAMANHO_MINIMO.width, Math.min(TAMANHO_PADRAO.width, area.width - 48)),
      height: Math.max(TAMANHO_MINIMO.height, Math.min(TAMANHO_PADRAO.height, area.height - 48)),
    };
  }

  function criarJanela(): void {
    const limites = limitesVisiveis(
      estadoSalvo.limites,
      screen.getAllDisplays().map((tela) => tela.workArea),
    );
    const nova = new BrowserWindow({
      ...opcoesDeJanela(),
      ...(limites ?? tamanhoInicial()),
      center: !limites,
      show: false,
    });
    janela = nova;

    let mostrada = false;
    const mostrar = () => {
      if (mostrada || nova.isDestroyed()) return;
      mostrada = true;
      if (estadoSalvo.maximizada) nova.maximize();
      nova.show();
    };
    nova.once('ready-to-show', mostrar);
    setTimeout(mostrar, 3000);

    const conteudo = nova.webContents;
    conteudo.on('did-finish-load', () => {
      if (tela !== 'app' || zoomAplicado) return;
      zoomAplicado = true;
      if (estadoSalvo.zoom !== 0) conteudo.setZoomLevel(estadoSalvo.zoom);
    });
    conteudo.on('did-fail-load', (_evento, codigo, descricao, _url, principal) => {
      // -3 = ERR_ABORTED: a navegação foi trocada por outra (clique rápido, redirecionamento).
      if (!principal || codigo === -3 || tela !== 'app') return;
      registrar(`Falha ao carregar a tela (${codigo} ${descricao}).`);
      void portaEmUso(PORTA).then((noAr) =>
        mostrarErro(
          noAr
            ? {
                titulo: 'A tela não abriu',
                mensagem: `O servidor respondeu, mas a página falhou (${descricao}).`,
              }
            : {
                titulo: 'O servidor do Prospector não está respondendo',
                mensagem: 'Tente de novo para subir o servidor outra vez.',
              },
        ),
      );
    });
    conteudo.on('render-process-gone', (_evento, detalhes) => {
      if (detalhes.reason === 'clean-exit' || saindo) return;
      registrar(`A tela parou (${detalhes.reason}).`);
      mostrarErro({
        titulo: 'A tela do Prospector parou',
        mensagem:
          'Tente de novo para abrir a tela outra vez. O que já estava salvo continua no banco.',
      });
    });

    nova.on('close', () => {
      salvarEstado(caminhos.estadoDaJanela, {
        limites: nova.getNormalBounds(),
        maximizada: nova.isMaximized(),
        zoom: tela === 'app' && zoomAplicado ? conteudo.getZoomLevel() : estadoSalvo.zoom,
      });
    });
    // Fechar a janela principal fecha o programa (e as janelas de imagem abertas por ela).
    nova.on('closed', () => {
      janela = null;
      app.quit();
    });
  }

  app.on('web-contents-created', (_evento, conteudo) => {
    travarConteudo(conteudo, {
      registrar,
      opcoesDeJanelaNova: () => ({ ...opcoesDeJanela(), width: 1200, height: 800 }),
      interceptarVoltaAoApp: (alvo) => {
        if (!viva(janela) || alvo !== janela.webContents || tela === 'app') return false;
        void abrirApp();
        return true;
      },
    });
    tratarMenuDeContexto(conteudo, registrar, () => recarregarConteudo(conteudo));
    tratarTeclas(conteudo, () => recarregarConteudo(conteudo));
  });

  app.on('second-instance', () => {
    if (saindo) {
      // A instância nova já saiu (a trava ainda era desta); sem isto, o clique não abriria nada.
      reabrir = true;
      return;
    }
    if (!viva(janela)) return;
    if (janela.isMinimized()) janela.restore();
    janela.show();
    janela.focus();
  });

  app.on('window-all-closed', () => app.quit());

  // Ao sair: encerra o servidor que a janela subiu (ou reaproveitou) antes de terminar.
  app.on('before-quit', (evento) => {
    if (encerrado) return;
    evento.preventDefault();
    if (saindo) return;
    saindo = true;
    for (const aberta of BrowserWindow.getAllWindows()) aberta.hide();
    void servidor.encerrar().finally(() => {
      encerrado = true;
      registrar('Janela fechada.');
      if (reabrir) {
        registrar('Atalho clicado durante o fechamento: abrindo de novo.');
        app.relaunch();
      }
      app.quit();
    });
  });

  process.on('uncaughtException', (erro) => {
    registrar(`Erro inesperado na janela: ${erro.stack ?? erro.message}`);
    dialog.showErrorBox(
      'Prospector',
      `Erro inesperado na janela do Prospector. Detalhes em ${join(caminhos.logs, 'janela.log')}.`,
    );
  });

  void app.whenReady().then(() => {
    travarSessao(session.defaultSession);
    try {
      session.defaultSession.setSpellCheckerLanguages(['pt-BR']);
    } catch {
      // Sem o idioma no Windows: o corretor fica com o padrão do sistema.
    }
    Menu.setApplicationMenu(
      montarMenuDoPrograma({
        recarregar,
        abrirRegistros: () => abrirPasta(caminhos.logs, registrar),
        sobre,
      }),
    );
    criarJanela();
    void abrirOllamaSeFechado().then(registrar);
    void abrirApp();
  });
}
