import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Caminhos } from '../src/config';
import type { Processo } from '../src/processos';
import {
  ESPERA_MAXIMA_MS,
  ServidorDoProspector,
  type FilhoDoServidor,
  type Sistema,
} from '../src/servidor';
import type { ErroDaJanela } from '../src/telas';

/** Ciclo de vida do servidor visto pela janela (ADR-0018), com sistema falso: nada sobe de verdade. */

const SERVIDOR_JS = 'D:\\Prospector\\app\\apps\\web\\server.js';
const NODE = 'C:\\Program Files\\nodejs\\node.exe';

function nossoServidor(pid: number): Processo {
  return { pid, nome: 'node.exe', linha: `"${NODE}" ${SERVIDOR_JS}` };
}

class FilhoFalso extends EventEmitter {
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  constructor(readonly pid: number | undefined) {
    super();
  }
  sair(codigo: number): void {
    this.exitCode = codigo;
    this.emit('exit', codigo, null);
  }
}

interface Mundo {
  sistema: Sistema;
  /** Quem ouve na porta 3210 agora (`null` = porta livre). */
  porta: Processo | null;
  vivos: Set<number>;
  encerrados: number[];
  abertos: FilhoFalso[];
  /** Chamado a cada espera (o teste decide quando o servidor "sobe"). */
  aoEsperar: () => void;
  vigias: (() => void)[];
  relogio: number;
  node: string | null;
  versao: number | null;
  proximoPid: number;
  semInstalacao: boolean;
}

function criarMundo(): Mundo {
  const mundo: Mundo = {
    porta: null,
    vivos: new Set(),
    encerrados: [],
    abertos: [],
    aoEsperar: () => undefined,
    vigias: [],
    relogio: 0,
    node: NODE,
    versao: 24,
    proximoPid: 500,
    semInstalacao: false,
    sistema: undefined as unknown as Sistema,
  };
  mundo.sistema = {
    existe: () => !mundo.semInstalacao,
    portaEmUso: async () => mundo.porta !== null,
    donoDaPorta: async () => mundo.porta,
    processoPorPid: async (pid) => (mundo.vivos.has(pid) ? nossoServidor(pid) : null),
    processoVivo: (pid) => mundo.vivos.has(pid),
    encerrar(pid) {
      mundo.encerrados.push(pid);
      mundo.vivos.delete(pid);
      if (mundo.porta?.pid === pid) mundo.porta = null;
      return true;
    },
    encontrarNode: () => mundo.node,
    versaoDoNode: () => mundo.versao,
    abrirServidor() {
      const filho = new FilhoFalso(mundo.proximoPid++);
      mundo.vivos.add(filho.pid!);
      mundo.abertos.push(filho);
      return filho as unknown as FilhoDoServidor;
    },
    esperar: async (ms) => {
      mundo.relogio += ms;
      mundo.aoEsperar();
    },
    agora: () => mundo.relogio,
    repetir(tarefa) {
      mundo.vigias.push(tarefa);
      return () => {
        mundo.vigias = mundo.vigias.filter((item) => item !== tarefa);
      };
    },
  };
  return mundo;
}

describe('ServidorDoProspector', () => {
  let pasta: string;
  let caminhos: Caminhos;
  let mundo: Mundo;
  let registro: string[];
  let paradas: ErroDaJanela[];
  let servidor: ServidorDoProspector;

  beforeEach(() => {
    pasta = mkdtempSync(join(tmpdir(), 'prospector-servidor-'));
    caminhos = {
      raiz: pasta,
      marca: join(pasta, '.prospector-instalacao'),
      web: join(pasta, 'app', 'apps', 'web'),
      servidor: SERVIDOR_JS,
      logs: join(pasta, 'logs'),
      pid: join(pasta, 'servidor.pid'),
      icone: join(pasta, 'prospector.ico'),
      versao: join(pasta, 'versao.txt'),
      dadosDaJanela: join(pasta, 'dados-da-janela'),
      estadoDaJanela: join(pasta, 'dados-da-janela', 'janela.json'),
    };
    mundo = criarMundo();
    registro = [];
    paradas = [];
    servidor = new ServidorDoProspector(
      caminhos,
      (mensagem) => registro.push(mensagem),
      (erro) => paradas.push(erro),
      mundo.sistema,
    );
  });

  afterEach(() => {
    rmSync(pasta, { recursive: true, force: true });
  });

  /** O servidor aberto passa a ouvir na porta na próxima espera. */
  function subirNaProximaEspera(): void {
    mundo.aoEsperar = () => {
      const filho = mundo.abertos.at(-1);
      if (filho?.pid && mundo.vivos.has(filho.pid)) mundo.porta = nossoServidor(filho.pid);
    };
  }

  it('sem a instalação, explica e não abre nada', async () => {
    mundo.semInstalacao = true;
    const abertura = await servidor.garantir();
    expect(abertura).toMatchObject({
      ok: false,
      erro: { titulo: 'Instalação incompleta', podeTentarDeNovo: false },
    });
    expect(mundo.abertos).toHaveLength(0);
  });

  it('sobe o servidor, espera responder e o encerra ao fechar a janela', async () => {
    subirNaProximaEspera();
    expect(await servidor.garantir()).toEqual({ ok: true });
    const pid = mundo.abertos[0]!.pid!;
    expect(readFileSync(caminhos.pid, 'ascii')).toBe(String(pid));
    // Chamar de novo com ele no ar não abre outro.
    expect(await servidor.garantir()).toEqual({ ok: true });
    expect(mundo.abertos).toHaveLength(1);

    await servidor.encerrar();
    expect(mundo.encerrados).toEqual([pid]);
    expect(existsSync(caminhos.pid)).toBe(false);
  });

  it('reaproveita o servidor desta instalação que já estava no ar e o confere antes de encerrar', async () => {
    mundo.porta = nossoServidor(42);
    mundo.vivos.add(42);
    expect(await servidor.garantir()).toEqual({ ok: true });
    expect(mundo.abertos).toHaveLength(0);
    await servidor.encerrar();
    expect(mundo.encerrados).toEqual([42]);
  });

  it('não encerra um PID reaproveitado que deixou de ser o servidor', async () => {
    mundo.porta = nossoServidor(42);
    mundo.vivos.add(42);
    await servidor.garantir();
    // O servidor morreu e o PID 42 agora é outro programa.
    mundo.sistema.processoPorPid = async (pid) => ({ pid, nome: 'ollama.exe', linha: 'ollama' });
    await servidor.encerrar();
    expect(mundo.encerrados).toEqual([]);
  });

  it('porta ocupada por outro programa: avisa quem é e não mexe nele', async () => {
    mundo.porta = { pid: 77, nome: 'java.exe', linha: 'java -jar outro.jar' };
    mundo.vivos.add(77);
    const abertura = await servidor.garantir();
    expect(abertura).toMatchObject({
      ok: false,
      erro: { titulo: 'A porta 3210 está ocupada', mensagem: expect.stringMatching(/java\.exe/) },
    });
    expect(mundo.abertos).toHaveLength(0);
    await servidor.encerrar();
    expect(mundo.encerrados).toEqual([]);
  });

  it('outro programa que ocupa a porta durante a abertura não vira o Prospector', async () => {
    mundo.aoEsperar = () => {
      mundo.porta = { pid: 99, nome: 'intruso.exe', linha: 'intruso' };
    };
    const abertura = await servidor.garantir();
    expect(abertura).toMatchObject({ ok: false, erro: { titulo: 'A porta 3210 está ocupada' } });
    // O servidor que a janela abriu é encerrado; o intruso, não.
    expect(mundo.encerrados).toEqual([mundo.abertos[0]!.pid]);
  });

  it('servidor que sai antes de responder: explica, sem aviso de queda', async () => {
    mundo.aoEsperar = () => mundo.abertos[0]!.sair(1);
    const abertura = await servidor.garantir();
    expect(abertura).toMatchObject({
      ok: false,
      erro: { titulo: 'O servidor do Prospector parou ao iniciar', mensagem: /código 1/ },
    });
    expect(paradas).toEqual([]);
    expect(existsSync(caminhos.pid)).toBe(false);
  });

  it('servidor que não responde em 90 segundos é encerrado', async () => {
    const abertura = await servidor.garantir();
    expect(abertura).toMatchObject({
      ok: false,
      erro: { titulo: 'O servidor do Prospector não respondeu' },
    });
    expect(mundo.relogio).toBeGreaterThan(ESPERA_MAXIMA_MS);
    expect(mundo.encerrados).toEqual([mundo.abertos[0]!.pid]);
  });

  it('queda depois de pronto avisa a janela; ao fechar, não avisa', async () => {
    subirNaProximaEspera();
    await servidor.garantir();
    const primeiro = mundo.abertos[0]!;
    mundo.vivos.delete(primeiro.pid!);
    mundo.porta = null;
    primeiro.sair(3);
    expect(paradas).toHaveLength(1);
    expect(paradas[0]!.mensagem).toMatch(/código 3/);

    subirNaProximaEspera();
    await servidor.garantir();
    await servidor.encerrar();
    mundo.abertos[1]!.sair(1);
    expect(paradas).toHaveLength(1);
  });

  it('servidor reaproveitado que parou é percebido pela vigia', async () => {
    mundo.porta = nossoServidor(42);
    mundo.vivos.add(42);
    await servidor.garantir();
    mundo.vivos.delete(42);
    for (const vigia of mundo.vigias) vigia();
    expect(paradas).toHaveLength(1);
    expect(mundo.vigias).toHaveLength(0);
  });

  it('reaproveitado que parou de responder é encerrado antes de subir outro', async () => {
    mundo.porta = nossoServidor(42);
    mundo.vivos.add(42);
    await servidor.garantir();
    // Continua vivo, mas a porta não responde mais.
    mundo.porta = null;
    subirNaProximaEspera();
    expect(await servidor.garantir()).toEqual({ ok: true });
    expect(mundo.encerrados).toEqual([42]);
    expect(mundo.abertos).toHaveLength(1);
  });

  it('Node ausente ou antigo: explica e não abre nada', async () => {
    mundo.node = null;
    expect(await servidor.garantir()).toMatchObject({
      ok: false,
      erro: { titulo: 'Node.js não encontrado' },
    });
    mundo.node = NODE;
    mundo.versao = 20;
    expect(await servidor.garantir()).toMatchObject({
      ok: false,
      erro: { titulo: 'Node.js desatualizado' },
    });
    expect(mundo.abertos).toHaveLength(0);
  });

  it('depois de fechar, não sobe outro servidor', async () => {
    await servidor.encerrar();
    expect(await servidor.garantir()).toMatchObject({ ok: false });
    expect(mundo.abertos).toHaveLength(0);
  });

  it('só apaga o servidor.pid se ele ainda for do mesmo processo', async () => {
    subirNaProximaEspera();
    await servidor.garantir();
    writeFileSync(caminhos.pid, '12345', 'ascii');
    await servidor.encerrar();
    expect(readFileSync(caminhos.pid, 'ascii')).toBe('12345');
  });
});
