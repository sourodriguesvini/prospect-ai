/**
 * Servidor Next do Prospector instalado, visto pela janela (ADR-0018): sobe o `server.js` no Node
 * do sistema se a porta estiver livre, reaproveita o servidor do próprio Prospector se ele já
 * estiver no ar, e o encerra quando a janela fecha. Processo de outro programa nunca é tocado.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { win32 } from 'node:path';
import { HOST, PORTA, type Caminhos } from './config.js';
import {
  donoDaPorta,
  ehServidorDoProspector,
  encerrarProcesso,
  encontrarNode,
  portaEmUso,
  processoPorPid,
  processoVivo,
  versaoDoNode,
  type Processo,
} from './processos.js';
import type { Registrar } from './registro.js';
import type { ErroDaJanela } from './telas.js';

const { join } = win32;

export const NODE_MINIMO = 24;
export const ESPERA_MAXIMA_MS = 90_000;
const INTERVALO_MS = 400;
const VIGIA_MS = 3_000;

export type Abertura = { ok: true } | { ok: false; erro: ErroDaJanela };

/** O que a janela usa do processo do servidor (o `ChildProcess` do Node, ou um falso nos testes). */
export type FilhoDoServidor = Pick<ChildProcess, 'pid' | 'exitCode' | 'signalCode' | 'once'>;

/**
 * Tudo o que toca o sistema (rede, processos, disco, relógio). A janela usa `SISTEMA_REAL`; os
 * testes trocam por versões falsas.
 */
export interface Sistema {
  existe(caminho: string): boolean;
  portaEmUso(porta: number, esperaMs?: number): Promise<boolean>;
  donoDaPorta(porta: number): Promise<Processo | null>;
  processoPorPid(pid: number): Promise<Processo | null>;
  processoVivo(pid: number): boolean;
  encerrar(pid: number): boolean;
  encontrarNode(): string | null;
  versaoDoNode(node: string): number | null;
  abrirServidor(node: string, caminhos: Caminhos, env: NodeJS.ProcessEnv): FilhoDoServidor;
  esperar(ms: number): Promise<void>;
  agora(): number;
  /** Repete `tarefa` a cada `ms`; devolve como parar. */
  repetir(tarefa: () => void, ms: number): () => void;
}

export const SISTEMA_REAL: Sistema = {
  existe: existsSync,
  portaEmUso,
  donoDaPorta,
  processoPorPid,
  processoVivo,
  encerrar: encerrarProcesso,
  encontrarNode: () => encontrarNode(),
  versaoDoNode,
  abrirServidor(node, caminhos, env) {
    mkdirSync(caminhos.logs, { recursive: true });
    const saida = openSync(join(caminhos.logs, 'servidor.log'), 'w');
    const erros = openSync(join(caminhos.logs, 'servidor-erros.log'), 'w');
    try {
      // Sem `detached`: se a janela cair, o Windows encerra o servidor junto (job do libuv).
      return spawn(node, [caminhos.servidor], {
        cwd: caminhos.web,
        env,
        windowsHide: true,
        stdio: ['ignore', saida, erros],
      });
    } finally {
      closeSync(saida);
      closeSync(erros);
    }
  },
  esperar: (ms) => new Promise((resolver) => setTimeout(resolver, ms)),
  agora: () => Date.now(),
  repetir(tarefa, ms) {
    const intervalo = setInterval(tarefa, ms);
    return () => clearInterval(intervalo);
  },
};

interface ServidorAtivo {
  pid: number;
  /** `null` quando o servidor já estava no ar e a janela só o reaproveitou. */
  filho: FilhoDoServidor | null;
  pronto: boolean;
}

/**
 * Ambiente do `node server.js`: o do usuário, sem variáveis do Electron, com porta e host fixos e
 * a pasta de dados da instalação (onde ficam as capturas de marca).
 */
export function ambienteDoServidor(base: NodeJS.ProcessEnv, dados: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [chave, valor] of Object.entries(base)) {
    if (!chave.toUpperCase().startsWith('ELECTRON_')) env[chave] = valor;
  }
  env.PORT = String(PORTA);
  env.HOSTNAME = HOST;
  env.NODE_ENV = 'production';
  env.NEXT_TELEMETRY_DISABLED = '1';
  env.PROSPECTOR_DATA_DIR = dados;
  return env;
}

export function mensagemDePortaOcupada(dono: Processo | null): ErroDaJanela {
  const quem = dono?.nome ? `${dono.nome}, processo ${dono.pid}` : null;
  return {
    titulo: `A porta ${PORTA} está ocupada`,
    mensagem: quem
      ? `Outro programa (${quem}) está usando a porta ${PORTA}. Feche esse programa e tente de novo.`
      : `Outro programa está usando a porta ${PORTA}. Feche esse programa e tente de novo.`,
    detalhe: 'O Prospector não encerra outros programas.',
  };
}

export class ServidorDoProspector {
  private ativo: ServidorAtivo | null = null;
  private pararVigiaAtual: (() => void) | null = null;
  private saindo = false;

  constructor(
    private readonly caminhos: Caminhos,
    private readonly registrar: Registrar,
    /** Chamado quando o servidor para com a janela aberta. */
    private readonly aoParar: (erro: ErroDaJanela) => void,
    private readonly sistema: Sistema = SISTEMA_REAL,
  ) {}

  private detalheDosRegistros(arquivo = 'servidor-erros.log'): string {
    return `Detalhes em ${join(this.caminhos.logs, arquivo)}. Menu Ajuda > Abrir a pasta de registros (a tecla Alt mostra o menu).`;
  }

  /** Deixa o servidor no ar e respondendo, ou explica por que não deu. */
  async garantir(): Promise<Abertura> {
    if (this.saindo) {
      return {
        ok: false,
        erro: { titulo: 'O Prospector está fechando', mensagem: 'Abra de novo em instantes.' },
      };
    }
    if (!this.sistema.existe(this.caminhos.marca) || !this.sistema.existe(this.caminhos.servidor)) {
      return {
        ok: false,
        erro: {
          titulo: 'Instalação incompleta',
          mensagem: `Falta o servidor do Prospector em ${this.caminhos.servidor}.`,
          detalhe: 'Rode "pnpm app:install" em C:\\dev\\prospector para instalar de novo.',
          podeTentarDeNovo: false,
        },
      };
    }
    if (
      this.ativo &&
      this.sistema.processoVivo(this.ativo.pid) &&
      (await this.sistema.portaEmUso(PORTA))
    ) {
      return { ok: true };
    }
    if (this.ativo) await this.descartar('o servidor anterior não respondia');

    if (await this.sistema.portaEmUso(PORTA)) {
      const dono = await this.sistema.donoDaPorta(PORTA);
      if (dono && ehServidorDoProspector(dono, this.caminhos.servidor)) {
        this.adotar(dono.pid);
        return { ok: true };
      }
      this.registrar(
        `Porta ${PORTA} ocupada por ${dono ? `${dono.nome} (${dono.pid})` : 'processo desconhecido'}.`,
      );
      return { ok: false, erro: mensagemDePortaOcupada(dono) };
    }
    return this.iniciar();
  }

  private adotar(pid: number): void {
    this.registrar(`Servidor do Prospector já estava no ar (processo ${pid}); reaproveitado.`);
    this.ativo = { pid, filho: null, pronto: true };
    this.gravarPid(pid);
    this.pararVigiaAtual = this.sistema.repetir(() => {
      if (this.ativo?.pid !== pid || this.sistema.processoVivo(pid)) return;
      this.pararVigia();
      this.ativo = null;
      this.apagarPid(pid);
      this.registrar(`Servidor reaproveitado (processo ${pid}) parou.`);
      if (!this.saindo) this.aoParar(this.erroDeParada());
    }, VIGIA_MS);
  }

  private erroDeParada(codigo?: number | null): ErroDaJanela {
    return {
      titulo: 'O servidor do Prospector parou',
      mensagem:
        codigo === undefined || codigo === null
          ? 'As telas não funcionam sem ele. Tente de novo para subir o servidor outra vez.'
          : `Ele saiu com o código ${codigo}. Tente de novo para subir o servidor outra vez.`,
      detalhe: this.detalheDosRegistros(),
    };
  }

  private async iniciar(): Promise<Abertura> {
    const node = this.sistema.encontrarNode();
    if (!node) {
      return {
        ok: false,
        erro: {
          titulo: 'Node.js não encontrado',
          mensagem: `O servidor do Prospector roda no Node ${NODE_MINIMO} deste computador. Instale o Node ${NODE_MINIMO} (nodejs.org) e tente de novo.`,
        },
      };
    }
    const versao = this.sistema.versaoDoNode(node);
    if (versao !== null && versao < NODE_MINIMO) {
      return {
        ok: false,
        erro: {
          titulo: 'Node.js desatualizado',
          mensagem: `O Node em ${node} é a versão ${versao}; o Prospector precisa da ${NODE_MINIMO} ou mais nova.`,
        },
      };
    }

    const filho = this.sistema.abrirServidor(
      node,
      this.caminhos,
      ambienteDoServidor(process.env, this.caminhos.dados),
    );
    const falhaAoAbrir = new Promise<Error>((resolver) => filho.once('error', resolver));
    const pid = filho.pid;
    if (!pid) {
      const erro = await falhaAoAbrir;
      this.registrar(`Não foi possível abrir o Node: ${erro.message}`);
      return {
        ok: false,
        erro: {
          titulo: 'O servidor do Prospector não abriu',
          mensagem: `O Windows não deixou abrir ${node}.`,
        },
      };
    }

    const ativo: ServidorAtivo = { pid, filho, pronto: false };
    this.ativo = ativo;
    this.gravarPid(pid);
    this.registrar(`Servidor iniciado (processo ${pid}, ${node}).`);
    filho.once('exit', (codigo: number | null) => {
      if (this.ativo !== ativo) return;
      this.ativo = null;
      this.apagarPid(pid);
      this.registrar(`Servidor (processo ${pid}) saiu com o código ${codigo ?? '?'}.`);
      if (ativo.pronto && !this.saindo) this.aoParar(this.erroDeParada(codigo));
    });

    const limite = this.sistema.agora() + ESPERA_MAXIMA_MS;
    for (;;) {
      if (this.ativo !== ativo) {
        // Saiu (evento `exit`) ou a janela está fechando e já o encerrou.
        return {
          ok: false,
          erro: {
            titulo: 'O servidor do Prospector parou ao iniciar',
            mensagem:
              filho.exitCode !== null || filho.signalCode !== null
                ? `Ele saiu com o código ${filho.exitCode ?? filho.signalCode}.`
                : 'Ele foi encerrado antes de abrir.',
            detalhe: this.detalheDosRegistros(),
          },
        };
      }
      if (await this.sistema.portaEmUso(PORTA, 500)) {
        // Quem responde precisa ser o processo que acabou de subir: um programa que ocupe a porta
        // nesse intervalo não pode virar "o Prospector" na janela.
        const dono = await this.sistema.donoDaPorta(PORTA);
        if (dono && dono.pid !== pid) {
          this.parar('outro programa ocupou a porta');
          this.registrar(
            `Porta ${PORTA} ocupada por ${dono.nome} (${dono.pid}) durante a abertura.`,
          );
          return { ok: false, erro: mensagemDePortaOcupada(dono) };
        }
        if (!dono) this.registrar('Não deu para conferir quem ouve na porta; seguindo.');
        ativo.pronto = true;
        this.registrar('Servidor respondendo.');
        return { ok: true };
      }
      if (this.sistema.agora() > limite) {
        this.parar('não respondeu em 90 segundos');
        return {
          ok: false,
          erro: {
            titulo: 'O servidor do Prospector não respondeu',
            mensagem: 'Ele não abriu em 90 segundos e foi encerrado.',
            detalhe: this.detalheDosRegistros('servidor.log'),
          },
        };
      }
      await this.sistema.esperar(INTERVALO_MS);
    }
  }

  /** Encerra o servidor que esta janela abriu. */
  private parar(motivo: string): void {
    const ativo = this.ativo;
    if (!ativo) return;
    this.pararVigia();
    this.ativo = null;
    if (ativo.filho && ativo.filho.exitCode === null && ativo.filho.signalCode === null) {
      this.sistema.encerrar(ativo.pid);
    }
    this.apagarPid(ativo.pid);
    this.registrar(`Servidor (processo ${ativo.pid}) encerrado: ${motivo}.`);
  }

  /**
   * Larga o servidor atual. O que a janela abriu é encerrado; o reaproveitado só é encerrado se,
   * conferido de novo, ainda for o servidor desta instalação (o PID pode ter sido reaproveitado).
   */
  private async descartar(motivo: string): Promise<void> {
    const ativo = this.ativo;
    if (!ativo) return;
    if (ativo.filho) {
      this.parar(motivo);
      return;
    }
    this.pararVigia();
    this.ativo = null;
    const processo = await this.sistema.processoPorPid(ativo.pid);
    if (ehServidorDoProspector(processo, this.caminhos.servidor)) {
      this.sistema.encerrar(ativo.pid);
      this.registrar(`Servidor reaproveitado (processo ${ativo.pid}) encerrado: ${motivo}.`);
    }
    this.apagarPid(ativo.pid);
  }

  /** Ao fechar a janela: encerra o servidor do Prospector, conferindo antes se ainda é ele. */
  async encerrar(): Promise<void> {
    this.saindo = true;
    await this.descartar('janela fechada');
  }

  private pararVigia(): void {
    this.pararVigiaAtual?.();
    this.pararVigiaAtual = null;
  }

  /** O `parar.ps1` usa o mesmo arquivo para achar o servidor. */
  private gravarPid(pid: number): void {
    try {
      writeFileSync(this.caminhos.pid, String(pid), 'ascii');
    } catch {
      this.registrar('Não foi possível gravar servidor.pid.');
    }
  }

  private apagarPid(pid: number): void {
    try {
      if (readFileSync(this.caminhos.pid, 'ascii').trim() === String(pid)) {
        rmSync(this.caminhos.pid, { force: true });
      }
    } catch {
      // Sem arquivo: nada a apagar.
    }
  }
}
